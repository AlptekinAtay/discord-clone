import { useEffect, useState, useRef } from "react";
import {
  Volume2, VolumeX, Mic, MicOff, MonitorUp, PhoneOff, Maximize, X, LogOut, Hash, Plus, Headphones, Trash2, Paperclip
} from "lucide-react";
import { useVoiceStore } from "./store/useVoiceStore";
import { useChatStore } from "./store/useChatStore";
import { useAuthStore } from "./store/useAuthStore";
import { sfu } from "./lib/mediasoup";
import { AudioPlayer } from "./components/AudioPlayer";
import { UserVolumeControl } from "./components/UserVolumeControl";


function VideoPlayer({ track }: { track: MediaStreamTrack }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (videoRef.current && track) videoRef.current.srcObject = new MediaStream([track]);
  }, [track]);
  const toggleFullscreen = () => {
    if (videoRef.current) {
      document.fullscreenElement ? document.exitFullscreen() : videoRef.current.requestFullscreen();
    }
  };
  return (
    <div className="relative w-full bg-black flex justify-center items-center rounded-lg overflow-hidden border border-[#1f2023] mb-4 shadow-xl shrink-0 group">
      <video ref={videoRef} autoPlay playsInline className="w-full max-h-[60vh] object-contain" />
      <div className="absolute top-2 left-2 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded uppercase shadow-sm">LIVE</div>
      <button onClick={() => sfu.stopWatching()} className="absolute top-2 right-2 bg-black/60 text-white p-1 rounded hover:bg-red-500 transition-colors opacity-0 group-hover:opacity-100" title="Stop Watching"><X size={16} /></button>
      <button onClick={toggleFullscreen} className="absolute bottom-2 right-2 bg-black/60 text-white p-1.5 rounded hover:bg-black/80 transition-colors opacity-0 group-hover:opacity-100" title="Fullscreen"><Maximize size={16} /></button>
    </div>
  );
}

function MiniVideoPlayer({ track }: { track: MediaStreamTrack }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (videoRef.current && track) videoRef.current.srcObject = new MediaStream([track]);
  }, [track]);
  return <video ref={videoRef} autoPlay playsInline muted className="w-full h-28 object-cover" />;
}

function App() {
  const { token, user, logout } = useAuthStore();
  const [channels, setChannels] = useState<{ id: string; name: string; type: string }[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelType, setNewChannelType] = useState<"text" | "voice">("text");

  const {
    isConnected, activeChannel, myMicMuted, peers, channelPeers, channelUsers,
    myPeerId, toggleMic, videoProducers, isScreenSharing, consumers,
    activeWatchStream, globalLivePeers, localScreenTrack,
    isDeafened, toggleDeafen, globalOnlineUsers,
    peerAudioConsumerMap, consumerStates
  } = useVoiceStore();

  const { activeTextChannel, messages, setActiveTextChannel } = useChatStore();
  const [chatInput, setChatInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingFilePreview, setPendingFilePreview] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    sfu.onChannelsUpdated = (newChannels) => setChannels(newChannels);

    const doConnect = () => {
      sfu.connect(`${import.meta.env.VITE_WS_URL}?token=${token}`)
        .then(() => sfu.requestPresence())
        .catch(err => console.warn("[App] WS connect failed:", err));
    };

    doConnect();
    // Reconnect when window regains focus (handles Safari background tab disconnect)
    window.addEventListener("focus", doConnect);
    return () => window.removeEventListener("focus", doConnect);
  }, [token]);

  useEffect(() => {
    if (!pendingFile) {
      setPendingFilePreview(null);
      return;
    }
    if (pendingFile.type.startsWith("image/")) {
      const url = URL.createObjectURL(pendingFile);
      setPendingFilePreview(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setPendingFilePreview(null);
    }
  }, [pendingFile]);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleJoinVoice = async (channelId: string) => {
    if (activeChannel === channelId) return;
    setErrorMessage(null);
    try {
      await sfu.joinRoom(channelId);
      await sfu.produceAudio();
    } catch (error: any) {
      setErrorMessage("Hata: " + (error.message || error.toString()));
    }
  };

  const handleJoinText = (channelId: string) => {
    setActiveTextChannel(channelId);
    sfu.fetchChannelMessages(channelId);
  };

  const handleCreateChannel = async () => {
    if (!newChannelName.trim()) return;
    try {
      await sfu.createChannel(newChannelName.trim(), newChannelType);
      setNewChannelName("");
      setIsModalOpen(false);
    } catch (err: any) {
      alert(err.message || "Kanal oluşturulamadı.");
    }
  };

  useEffect(() => {
    if (!activeTextChannel && channels.length > 0) {
      const general = channels.find(c => c.name === "general" && c.type === "text");
      const firstText = channels.find(c => c.type === "text");
      if (general) handleJoinText(general.id);
      else if (firstText) handleJoinText(firstText.id);
    }
  }, [channels, activeTextChannel]);

  const handleDeleteChannel = async (e: React.MouseEvent, channelId: string, name: string) => {
    e.stopPropagation();
    if (name === "general" || name === "voice-lounge") { alert("Varsayılan kanallar silinemez."); return; }
    if (window.confirm(`'${name}' kanalını silmek istediğinize emin misiniz?`)) {
      try {
        await sfu.deleteChannel(channelId);
        if (activeTextChannel === channelId) setActiveTextChannel(null); 
        if (activeChannel === channelId) sfu.leaveRoom();
      } catch (err) { alert("Kanal silinemedi."); }
    }
  };

  useEffect(() => {
    if (activeTextChannel && sfu.isConnected()) sfu.fetchChannelMessages(activeTextChannel);
  }, [activeTextChannel]);

  const handleSendMessage = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const content = chatInput.trim();
      if (content === "" && !pendingFile) return;
      if (!activeTextChannel) return;

      let fileUrl = undefined;
      let fileType = undefined;

      if (pendingFile) {
        setIsUploading(true);
        const formData = new FormData();
        formData.append("file", pendingFile);
        try {
          const resp = await fetch(`${import.meta.env.VITE_API_URL}/api/upload`, { method: "POST", body: formData });
          const data = await resp.json();
          fileUrl = data.url;
          fileType = data.type;
        } catch (err) {
          alert("Dosya yüklenemedi.");
          setIsUploading(false);
          return;
        }
      }

      sfu.sendChatMessage(activeTextChannel, content, fileUrl, fileType);
      setChatInput("");
      setPendingFile(null);
      setIsUploading(false);
    }
  };

  const handleFileClick = () => fileInputRef.current?.click();
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setPendingFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        const file = items[i].getAsFile();
        if (file) setPendingFile(file);
      }
    }
  };

  const handleLogout = () => {
    if (window.confirm("Çıkış yapmak istediğinize emin misiniz?")) {
      sfu.leaveRoom();
      logout();
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeTextChannel]);

  const activeVideoTrack = Object.values(consumers).find(t => t.kind === 'video');
  const isMeSpeaking = myPeerId ? !!peers[myPeerId]?.isSpeaking : false;

  const onlineMembers = globalOnlineUsers.map(u => {
    const isMe = u.id === user?.id;
    const muted = isMe ? (myMicMuted || isDeafened) : u.micMuted;
    const deaf = isMe ? isDeafened : u.deafened;
    return { ...u, micMuted: muted, deafened: deaf, status: isMe ? "You" : (deaf ? "Deafened" : (muted ? "Muted" : "Online")) };
  });

  const currentTextChannel = channels.find(c => c.id === activeTextChannel);
  const currentMessages = activeTextChannel ? (messages[activeTextChannel] || []) : [];

  return (
    <div className="flex h-screen w-full bg-[#1e1f22] text-[#dbdee1] overflow-hidden font-sans select-none relative">
      <AudioPlayer isDeafened={isDeafened} />
      <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileChange} />

      {/* 1. SERVER LIST */}
      <div className="w-[72px] bg-[#1e1f22] flex flex-col items-center py-3 gap-2 shrink-0 z-20 pt-8">
        <div className="relative group flex justify-center w-full">
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-10 bg-white rounded-r-lg transition-all duration-200"></div>
          <div className="w-12 h-12 rounded-[16px] bg-[#5865F2] flex items-center justify-center cursor-pointer text-white shadow-sm transition-all duration-200 hover:rounded-[12px]">
            <svg className="w-7 h-7" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><path fill="currentColor" d="M19.73 4.87a18.2 18.2 0 0 0-4.6-1.44c-.21.4-.4.8-.58 1.21-1.69-.25-3.4-.25-5.1 0-.18-.41-.37-.82-.59-1.2-1.6.27-3.14.75-4.6 1.43A19.04 19.04 0 0 0 .96 17.7a18.43 18.43 0 0 0 5.63 2.87c.46-.62.86-1.28 1.22-1.98-.65-.25-1.27-.55-1.88-.89l.46-.48c3.53 1.63 7.38 1.63 10.91 0l.46.48c-.6.34-1.23.64-1.88.89.36.7.76 1.36 1.22 1.98a18.45 18.45 0 0 0 5.63-2.87 19.32 19.32 0 0 0-3.02-12.83ZM8.3 15.12c-1.1 0-2-.94-2-2.1 0-1.16.89-2.11 2-2.11 1.12 0 2.02.95 2 2.11 0-1.16-.89-2.1-2-2.1Zm7.4 0c-1.1 0-2-.94-2-2.1 0-1.16.89-2.11 2-2.11 1.12 0 2.02.95 2 2.11 0 1.16-.88 2.1-2 2.1Z"/></svg>
          </div>
        </div>
        <div className="w-8 h-[2px] bg-[#35363c] rounded-full my-1"></div>
      </div>

      {/* 2. CHANNEL LIST */}
      <div className="w-60 bg-[#2b2d31] flex flex-col shrink-0 z-10">
        <div className="h-12 border-b border-[#1f2023] flex items-center px-4 font-bold text-gray-100 shadow-sm hover:bg-[#35373c] cursor-pointer transition-colors duration-150 shrink-0">Antigravity Server</div>
        <div className="flex-1 overflow-y-auto p-2 space-y-4 custom-scrollbar">
          <div>
            <div className="group flex items-center justify-between px-1 mb-1">
              <div className="text-xs font-bold text-[#949ba4] uppercase hover:text-[#dbdee1] cursor-pointer">Text Channels</div>
              <Plus size={14} className="text-[#949ba4] hover:text-[#dbdee1] cursor-pointer" onClick={() => { setNewChannelType("text"); setIsModalOpen(true); }} />
            </div>
            {channels.filter(c => c.type === 'text').map(c => (
              <div key={c.id} onClick={() => handleJoinText(c.id)} className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-[4px] cursor-pointer transition-colors duration-100 ${activeTextChannel === c.id ? 'bg-[#35373c] text-[#dbdee1]' : 'text-[#949ba4] hover:bg-[#35373c] hover:text-[#dbdee1]'}`}>
                <Hash size={18} className="shrink-0" /><span className="flex-1 truncate">{c.name}</span>
                {c.name !== "general" && <Trash2 size={14} className="opacity-0 group-hover:opacity-100 text-[#949ba4] hover:text-red-400 transition-opacity" onClick={(e) => handleDeleteChannel(e, c.id, c.name)} />}
              </div>
            ))}
          </div>
          <div>
            <div className="group flex items-center justify-between px-1 mb-1">
              <div className="text-xs font-bold text-[#949ba4] uppercase hover:text-[#dbdee1] cursor-pointer">Voice Channels</div>
              <Plus size={14} className="text-[#949ba4] hover:text-[#dbdee1] cursor-pointer" onClick={() => { setNewChannelType("voice"); setIsModalOpen(true); }} />
            </div>
            {channels.filter(c => c.type === 'voice').map(c => {
              const occupants = channelPeers[c.id] || [];
              return (
                <div key={c.id} onClick={() => handleJoinVoice(c.id)} className={`group flex flex-col gap-1 px-2 py-1.5 rounded-[4px] cursor-pointer transition-colors duration-100 ${activeChannel === c.id ? 'bg-[#35373c] text-[#dbdee1]' : 'hover:bg-[#35373c] text-[#949ba4] hover:text-[#dbdee1]'}`}>
                  <div className="flex items-center gap-1.5 w-full"><Mic size={18} className="shrink-0" /><span className="flex-1 truncate font-medium">{c.name}</span>{c.name !== "voice-lounge" && <Trash2 size={14} className="opacity-0 group-hover:opacity-100 text-[#949ba4] hover:text-red-400 transition-opacity" onClick={(e) => handleDeleteChannel(e, c.id, c.name)} />}</div>
                  <div className="ml-6 flex flex-col gap-1 mt-0.5">
                    {activeChannel === c.id && (
                      <div className="flex items-center gap-2 group/me relative">
                        <img src={user?.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user?.username || 'me')}`} alt="me" className={`w-6 h-6 rounded-full shrink-0 border-2 transition-all ${isMeSpeaking ? 'border-green-500' : 'border-transparent'}`} />
                        <span className={`text-[13px] flex-1 truncate ${isMeSpeaking ? 'text-white' : 'text-[#949ba4]'}`}>{user?.username || 'Sen'}</span>
                        <div className="flex items-center gap-1">{isDeafened && <Headphones size={12} className="text-red-500" />}{myMicMuted && !isDeafened && <MicOff size={12} className="text-red-500" />}{isScreenSharing && <span className="text-[9px] font-bold bg-red-500 text-white px-1 py-0.5 rounded uppercase leading-none">Live</span>}</div>
                      </div>
                    )}
                    {occupants.filter(id => id !== myPeerId).map((pid) => {
                      const isSpeaking = peers[pid]?.isSpeaking;
                      const isLive = !!videoProducers[pid] || globalLivePeers.includes(pid);
                      const pu = channelUsers[pid];
                      
                      const audioConsumerId = peerAudioConsumerMap[pid];
                      const isLocallyMuted = audioConsumerId ? consumerStates[audioConsumerId]?.isMuted : false;

                      return (
                        <div key={pid} className="flex items-center gap-2 group/peer relative">
                          <img src={pu?.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${pu?.username || pid}`} alt="peer" className={`w-6 h-6 rounded-full shrink-0 border-2 transition-all ${isSpeaking ? 'border-green-500' : 'border-transparent'}`} />
                          <span className={`text-[13px] flex-1 truncate ${isSpeaking ? 'text-white' : 'text-[#949ba4]'}`}>{pu?.username || `User ${pid.substring(0,4)}`}</span>
                          <div className="flex items-center gap-1">
                            {isLocallyMuted && <VolumeX size={12} className="text-red-500" />}
                            {pu?.deafened && <Headphones size={12} className="text-red-500" />}
                            {pu?.micMuted && !pu?.deafened && <MicOff size={12} className="text-red-500" />}
                            <UserVolumeControl peerId={pid} />
                            {isLive && activeWatchStream === pid && (<button onClick={(e) => { e.stopPropagation(); sfu.stopWatching(); }} className="text-[9px] font-bold border border-red-500 text-red-500 px-1 py-0.5 rounded uppercase hover:bg-red-500 hover:text-white transition-colors leading-none">Stop</button>)}
                            {isLive && activeWatchStream !== pid && (<button onClick={async (e) => { e.stopPropagation(); if (activeChannel !== c.id) { await handleJoinVoice(c.id); setTimeout(() => sfu.watchStream(pid), 600); } else sfu.watchStream(pid); }} className="text-[9px] font-bold bg-red-500 text-white px-1 py-0.5 rounded uppercase hover:bg-red-600 transition-colors leading-none">Watch</button>)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="shrink-0 bg-[#232428] flex flex-col">
          {localScreenTrack && (<div className="bg-black relative"><MiniVideoPlayer track={localScreenTrack} /><div className="absolute top-1 left-1 bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded uppercase">Sen (Live)</div><button onClick={() => sfu.stopScreenShare()} className="absolute top-1 right-1 bg-black/60 text-white p-1 rounded hover:bg-red-500 transition-colors"><X size={12} /></button></div>)}
          {isConnected && activeChannel && (<div className="px-2 py-1.5 border-b border-[#1e1f22]"><div className="flex items-center justify-between"><div className="flex flex-col cursor-pointer"><div className="text-[#23a559] text-[13px] font-bold leading-tight flex items-center gap-1"><Volume2 size={14} /> Voice Connected</div><div className="text-[#949ba4] text-[11px] truncate">{channels.find(c => c.id === activeChannel)?.name}</div></div><button onClick={() => sfu.leaveRoom()} className="text-[#b5bac1] hover:text-red-400 p-1.5 rounded hover:bg-[#35373c] transition-colors"><PhoneOff size={18} /></button></div></div>)}
          <div className="h-[52px] flex items-center px-2 gap-1">
            <div className="flex items-center gap-2 hover:bg-[#35373c] rounded-md p-1 cursor-pointer transition-colors min-w-0 flex-1 group">
              <div className="w-8 h-8 rounded-full bg-indigo-500 relative shrink-0 overflow-hidden"><img src={user?.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user?.username || '')}`} className="w-full h-full object-cover" /><div className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-[#23a559] rounded-full border-[3px] border-[#232428] group-hover:border-[#35373c] transition-colors"></div></div>
              <div className="flex-1 text-sm min-w-0 pr-1"><div className="font-bold text-gray-100 truncate text-[13px] leading-tight">{user?.username || 'User'}</div><div className="text-[#b5bac1] truncate text-[11px] leading-tight">{isDeafened ? "Deafened" : "Online"}</div></div>
            </div>
            <div className="flex items-center gap-0.5 ml-auto text-[#b5bac1]">
              <button onClick={() => isScreenSharing ? sfu.stopScreenShare() : sfu.startScreenShare()} className={`p-1.5 hover:bg-[#35373c] hover:text-[#dbdee1] rounded-md transition-colors ${isScreenSharing ? 'text-green-400' : ''}`} title="Go Live"><MonitorUp size={18} /></button>
              <button onClick={toggleMic} className={`p-1.5 hover:bg-[#35373c] hover:text-[#dbdee1] rounded-md transition-colors ${myMicMuted || isDeafened ? 'text-red-400' : ''}`} title="Toggle Mute">{myMicMuted || isDeafened ? <MicOff size={18} /> : <Mic size={18} />}</button>
              <button onClick={toggleDeafen} className={`p-1.5 hover:bg-[#35373c] hover:text-[#dbdee1] rounded-md transition-colors ${isDeafened ? 'text-red-400' : ''}`} title="Deafen"><Headphones size={18} /></button>
              <button onClick={handleLogout} className="p-1.5 hover:bg-[#35373c] hover:text-[#dbdee1] rounded-md transition-colors" title="Log Out"><LogOut size={18} className="text-red-400" /></button>
            </div>
          </div>
        </div>
      </div>

      {/* 3. CHAT AREA */}
      <div className="flex-1 bg-[#313338] flex flex-col min-w-0">
        <div className="h-12 border-b border-[#1f2023] flex items-center px-4 shadow-sm z-10 gap-3 shrink-0"><Hash size={24} className="text-[#80848e]" /><div className="font-bold text-gray-100 text-[15px]">{currentTextChannel?.name || 'general'}</div></div>
        {activeVideoTrack && (<div className="px-4 pt-4 shrink-0 bg-[#313338] z-20"><VideoPlayer track={activeVideoTrack} /></div>)}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="flex flex-col min-h-full p-4">
            {errorMessage && (<div className="mb-4 bg-red-500/20 border border-red-500 text-red-100 p-4 rounded-md shrink-0"><strong>Bağlantı Hatası:</strong> {errorMessage}</div>)}
            {currentMessages.length === 0 && (<div className="mt-4 mb-8 text-left"><div className="w-[68px] h-[68px] rounded-full bg-[#41434a] flex items-center justify-center mb-4"><Hash size={40} className="text-white" /></div><h1 className="text-[32px] font-extrabold mb-2 text-white">Welcome to #{currentTextChannel?.name || 'general'}!</h1><p className="text-[#b5bac1] text-[15px]">This is the start of the #{currentTextChannel?.name || 'general'} channel.</p></div>)}
            <div className="flex flex-col gap-0 mt-auto">
              {currentMessages.map((msg, index) => {
                const isConsecutive = index > 0 && currentMessages[index - 1].authorId === msg.authorId;
                return (
                  <div key={msg.id} className={`hover:bg-[#2e3035] px-4 py-0.5 -mx-4 flex group relative ${!isConsecutive ? 'mt-4' : ''}`}>
                    {!isConsecutive ? (
                      <><div className="w-[52px] shrink-0 pt-0.5 cursor-pointer"><img src={msg.author?.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(msg.author?.username || msg.authorId)}`} alt="Avatar" className="w-10 h-10 rounded-full hover:shadow-md transition-shadow" /></div><div className="flex flex-col min-w-0 flex-1"><div className="flex items-baseline gap-2"><span className="font-medium text-[15px] text-white hover:underline cursor-pointer">{msg.author?.username || 'Unknown'}</span><span className="text-xs text-[#949ba4] font-medium">{new Date(msg.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span></div>{msg.content && <div className="text-[#dbdee1] text-[15px] leading-[1.375rem] whitespace-pre-wrap mt-0.5">{msg.content}</div>}{msg.fileUrl && msg.fileType?.startsWith("image/") && (<div className="mt-2 rounded-lg overflow-hidden border border-[#232428] max-sm shadow-lg"><img src={msg.fileUrl} alt="uploaded" className="max-w-full h-auto cursor-pointer hover:opacity-90 transition-opacity" onClick={() => window.open(msg.fileUrl, '_blank')} /></div>)}{msg.fileUrl && !msg.fileType?.startsWith("image/") && (<a href={msg.fileUrl} target="_blank" rel="noopener noreferrer" className="mt-2 flex items-center gap-3 p-3 bg-[#2b2d31] rounded-md border border-[#1e1f22] hover:bg-[#35373c] transition-colors w-fit"><Paperclip size={20} className="text-[#b5bac1]" /><div className="flex flex-col min-w-0"><span className="text-blue-400 hover:underline text-[14px] font-medium truncate max-w-xs">{msg.fileUrl.split('/').pop()?.split('-').slice(1).join('-')}</span><span className="text-[11px] text-[#949ba4] uppercase">{msg.fileType?.split('/')[1] || 'FILE'}</span></div></a>)}</div></>
                    ) : (
                      <><div className="w-[52px] shrink-0 opacity-0 group-hover:opacity-100 text-[10px] text-[#949ba4] text-right pr-2 pt-1 select-none font-medium">{new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div><div className="flex flex-col flex-1">{msg.content && <div className="text-[#dbdee1] text-[15px] leading-[1.375rem] whitespace-pre-wrap">{msg.content}</div>}{msg.fileUrl && msg.fileType?.startsWith("image/") && (<div className="mt-1 rounded-lg overflow-hidden border border-[#232428] max-w-sm shadow-lg"><img src={msg.fileUrl} alt="uploaded" className="max-w-full h-auto cursor-pointer hover:opacity-90 transition-opacity" onClick={() => window.open(msg.fileUrl, '_blank')} /></div>)}{msg.fileUrl && !msg.fileType?.startsWith("image/") && (<a href={msg.fileUrl} target="_blank" rel="noopener noreferrer" className="mt-1 flex items-center gap-3 p-3 bg-[#2b2d31] rounded-md border border-[#1e1f22] hover:bg-[#35373c] transition-colors w-fit"><Paperclip size={20} className="text-[#b5bac1]" /><div className="flex flex-col min-w-0"><span className="text-blue-400 hover:underline text-[14px] font-medium truncate max-w-xs">{msg.fileUrl.split('/').pop()?.split('-').slice(1).join('-')}</span><span className="text-[11px] text-[#949ba4] uppercase">{msg.fileType?.split('/')[1] || 'FILE'}</span></div></a>)}</div></>
                    )}
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          </div>
        </div>

        <div className="px-4 pb-6 pt-2 shrink-0">
          {pendingFile && (
            <div className="bg-[#2b2d31] border border-[#1e1f22] rounded-t-lg p-3 relative flex items-center gap-4 mb-[-8px] mx-2 shadow-inner z-0 animate-in slide-in-from-bottom-2 duration-200">
               {pendingFilePreview ? (
                 <div className="w-16 h-16 rounded overflow-hidden border border-[#232428] shrink-0"><img src={pendingFilePreview} className="w-full h-full object-cover" alt="preview" /></div>
               ) : (
                 <div className="w-16 h-16 rounded bg-[#313338] flex items-center justify-center shrink-0 border border-[#232428]"><Paperclip size={24} className="text-[#b5bac1]" /></div>
               )}
               <div className="flex flex-col min-w-0"><span className="text-white text-sm font-medium truncate max-w-xs">{pendingFile.name}</span><span className="text-[#949ba4] text-xs uppercase">{pendingFile.type.split('/')[1]}</span></div>
               <button onClick={() => setPendingFile(null)} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-lg hover:bg-red-600 transition-colors"><X size={14} /></button>
            </div>
          )}
          <div className={`bg-[#383a40] rounded-lg px-4 py-3 flex items-center gap-3 transition-opacity relative z-10 ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}>
            <button onClick={handleFileClick} className="bg-[#b5bac1] hover:bg-[#dbdee1] text-[#383a40] rounded-full p-0.5 transition-colors shrink-0"><Plus size={18} /></button>
            <input
              type="text"
              placeholder={isUploading ? "Uploading file..." : `Message #${currentTextChannel?.name || 'general'}`}
              className="bg-transparent border-none outline-none w-full text-[#dbdee1] placeholder-[#5c5e66] text-[15px]"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={handleSendMessage}
              onPaste={handlePaste}
              disabled={isUploading}
            />
          </div>
        </div>
      </div>

      <div className="w-60 bg-[#2b2d31] border-l border-[#1f2023] flex flex-col shrink-0 overflow-hidden">
        <div className="h-12 border-b border-[#1f2023] flex items-center px-3 shrink-0"><span className="text-xs font-bold text-[#949ba4] uppercase tracking-wide">Members — {onlineMembers.length}</span></div>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-3">
          <div className="text-[10px] font-bold text-[#949ba4] uppercase tracking-wide mb-2 px-1">Online — {onlineMembers.length}</div>
          <div className="flex flex-col gap-0.5">
            {onlineMembers.map(member => (
              <div key={member.id} className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-[#35373c] cursor-pointer group transition-colors"><div className="relative shrink-0"><img src={member.avatarUrl} alt={member.username} className="w-8 h-8 rounded-full" /><div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 border-2 border-[#2b2d31] group-hover:border-[#35373c] rounded-full transition-colors"></div></div><div className="min-w-0 flex-1"><div className="flex items-center justify-between"><div className="text-[13px] font-medium text-[#dbdee1] truncate">{member.username}</div><div className="flex items-center gap-1">{member.deafened && <Headphones size={12} className="text-red-500" />}{member.micMuted && !member.deafened && <MicOff size={12} className="text-red-500" />}</div></div><div className="text-[11px] text-[#949ba4] truncate">{member.status}</div></div></div>
            ))}
          </div>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 animate-in fade-in duration-200">
          <div className="bg-[#313338] w-full max-w-md rounded-lg shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6">
               <h2 className="text-2xl font-bold text-white mb-2">Kanal Oluştur</h2>
               <p className="text-[#b5bac1] text-[15px] mb-6">Sunucuna yeni bir kanal ekle ve arkadaşlarınla sohbete başla.</p>
               <div className="space-y-4">
                  <div>
                    <label className="text-xs font-bold text-[#b5bac1] uppercase mb-2 block">Kanal Tipi</label>
                    <div className="flex flex-col gap-2">
                       <div onClick={() => setNewChannelType("text")} className={`flex items-center gap-3 p-3 rounded-md cursor-pointer transition-colors ${newChannelType === 'text' ? 'bg-[#404249] text-white' : 'bg-[#2b2d31] text-[#949ba4] hover:bg-[#35373c]'}`}><Hash size={24} /><div><div className="font-bold text-[15px]">Text</div><div className="text-xs opacity-70">Mesaj, görsel, emoji ve gif gönderin.</div></div>{newChannelType === 'text' && <div className="ml-auto w-4 h-4 rounded-full border-4 border-[#5865f2]"></div>}</div>
                       <div onClick={() => setNewChannelType("voice")} className={`flex items-center gap-3 p-3 rounded-md cursor-pointer transition-colors ${newChannelType === 'voice' ? 'bg-[#404249] text-white' : 'bg-[#2b2d31] text-[#949ba4] hover:bg-[#35373c]'}`}><Mic size={24} /><div><div className="font-bold text-[15px]">Voice</div><div className="text-xs opacity-70">Sesli, görüntülü ve ekran paylaşımıyla sohbet edin.</div></div>{newChannelType === 'voice' && <div className="ml-auto w-4 h-4 rounded-full border-4 border-[#5865f2]"></div>}</div>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[#b5bac1] uppercase mb-2 block">Kanal Adı</label>
                    <div className="relative"><div className="absolute left-3 top-1/2 -translate-y-1/2 text-[#949ba4]">{newChannelType === 'text' ? '#' : <Volume2 size={16}/>}</div><input type="text" className="w-full bg-[#1e1f22] text-[#dbdee1] p-2 pl-9 rounded-md border-none outline-none" placeholder="yeni-kanal" value={newChannelName} onChange={(e) => setNewChannelName(e.target.value.toLowerCase().replace(/\s+/g, '-'))} autoFocus /></div>
                  </div>
               </div>
            </div>
            <div className="bg-[#2b2d31] p-4 flex justify-end gap-3"><button onClick={() => setIsModalOpen(false)} className="text-white hover:underline text-[14px] px-4">İptal</button><button onClick={handleCreateChannel} className="bg-[#5865f2] hover:bg-[#4752c4] text-white font-bold py-2 px-6 rounded-md transition-colors text-[14px]">Kanal Oluştur</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
