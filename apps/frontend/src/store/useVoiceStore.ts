import { create } from "zustand";
import { sfu } from "../lib/mediasoup";

interface VoiceState {
  isConnected: boolean;
  myPeerId: string | null;
  activeChannel: string | null;
  myMicMuted: boolean;
  isDeafened: boolean;
  isScreenSharing: boolean;
  localScreenTrack: MediaStreamTrack | null;
  
  peers: Record<string, { isSpeaking: boolean }>;
  consumers: Record<string, MediaStreamTrack>;
  channelPeers: Record<string, string[]>; // channelId -> array of peerIds
  channelUsers: Record<string, { username: string, avatarUrl: string, micMuted?: boolean, deafened?: boolean }>; // peerId -> userInfo
  
  videoProducers: Record<string, string>; // peerId -> producerId
  activeWatchStream: string | null; // peerId we are watching
  globalLivePeers: string[];
  globalOnlineUsers: { id: string; username: string; avatarUrl: string, micMuted?: boolean, deafened?: boolean }[]; // all peers globally who are live
  
  setConnected: (connected: boolean) => void;
  setMyPeerId: (id: string) => void;
  setActiveChannel: (channelId: string | null) => void;
  toggleMic: () => void;
  toggleDeafen: () => void;
  setScreenSharing: (isSharing: boolean, track?: MediaStreamTrack | null) => void;
  
  setPeerSpeaking: (peerId: string, isSpeaking: boolean) => void;
  addPeer: (peerId: string) => void;
  removePeer: (peerId: string) => void;
  addConsumer: (consumerId: string, track: MediaStreamTrack) => void;
  removeConsumer: (consumerId: string) => void;
  clearPeers: () => void;
  setChannelPeers: (newState: Record<string, string[]>) => void;
  setChannelUsers: (users: Record<string, { username: string, avatarUrl: string, micMuted?: boolean, deafened?: boolean }>) => void;
  setGlobalLivePeers: (peers: string[]) => void;
  setGlobalOnlineUsers: (users: { id: string; username: string; avatarUrl: string; micMuted?: boolean; deafened?: boolean }[]) => void;
  
  addVideoProducer: (peerId: string, producerId: string) => void;
  removeVideoProducer: (peerId: string) => void;
  setActiveWatchStream: (peerId: string | null) => void;
}

export const useVoiceStore = create<VoiceState>((set) => ({
  isConnected: false,
  myPeerId: null,
  activeChannel: null,
  myMicMuted: false,
  isDeafened: false,
  isScreenSharing: false,
  localScreenTrack: null,
  peers: {},
  consumers: {},
  channelPeers: {},
  channelUsers: {},
  videoProducers: {},
  activeWatchStream: null,
  globalLivePeers: [],
  globalOnlineUsers: [],

  setConnected: (connected) => set({ isConnected: connected }),
  setMyPeerId: (id) => set({ myPeerId: id }),
  setActiveChannel: (channelId) => set({ activeChannel: channelId }),
  toggleMic: () => set((state) => {
    const newState = { myMicMuted: !state.myMicMuted };
    sfu.updateStatus(newState.myMicMuted, state.isDeafened);
    return newState;
  }),
  toggleDeafen: () => set((state) => {
    const newDeaf = !state.isDeafened;
    const newMute = newDeaf ? true : state.myMicMuted;
    sfu.updateStatus(newMute, newDeaf);
    return { isDeafened: newDeaf, myMicMuted: newMute };
  }),
  setScreenSharing: (isSharing, track = null) => set({ isScreenSharing: isSharing, localScreenTrack: track }),
  
  setPeerSpeaking: (peerId, isSpeaking) =>
    set((state) => ({
      peers: { ...state.peers, [peerId]: { isSpeaking } },
    })),
    
  addPeer: (peerId) =>
    set((state) => ({
      peers: { ...state.peers, [peerId]: state.peers[peerId] || { isSpeaking: false } },
    })),
    
  removePeer: (peerId) =>
    set((state) => {
      const newPeers = { ...state.peers };
      delete newPeers[peerId];
      const newVideoProducers = { ...state.videoProducers };
      delete newVideoProducers[peerId];
      return { 
        peers: newPeers, 
        videoProducers: newVideoProducers,
        activeWatchStream: state.activeWatchStream === peerId ? null : state.activeWatchStream
      };
    }),
    
  addConsumer: (consumerId, track) =>
    set((state) => ({ consumers: { ...state.consumers, [consumerId]: track } })),
    
  removeConsumer: (consumerId) =>
    set((state) => {
      const newConsumers = { ...state.consumers };
      delete newConsumers[consumerId];
      return { consumers: newConsumers };
    }),
    
  clearPeers: () => set({ peers: {}, consumers: {}, videoProducers: {}, activeWatchStream: null, globalLivePeers: [], channelUsers: {} }),
  
  setChannelPeers: (newState) => set({ channelPeers: newState }),
  setChannelUsers: (users) => set({ channelUsers: users }),
  setGlobalLivePeers: (peers) => set({ globalLivePeers: peers }),
  setGlobalOnlineUsers: (users) => set({ globalOnlineUsers: users }),

  addVideoProducer: (peerId, producerId) => set((state) => ({
    videoProducers: { ...state.videoProducers, [peerId]: producerId }
  })),

  removeVideoProducer: (peerId) => set((state) => {
    const newVp = { ...state.videoProducers };
    delete newVp[peerId];
    return { 
      videoProducers: newVp,
      activeWatchStream: state.activeWatchStream === peerId ? null : state.activeWatchStream
    };
  }),

  setActiveWatchStream: (peerId) => set({ activeWatchStream: peerId })
}));
