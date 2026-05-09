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
  consumerPeerMap: Record<string, string>; // consumerId -> peerId
  peerAudioConsumerMap: Record<string, string>; // peerId -> audio consumerId
  consumerStates: Record<string, { volume: number, isMuted: boolean }>;
  
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
  addConsumer: (consumerId: string, track: MediaStreamTrack, peerId: string) => void;
  removeConsumer: (consumerId: string) => void;
  setConsumerVolume: (consumerId: string, volume: number) => void;
  setConsumerMuted: (consumerId: string, isMuted: boolean) => void;
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
  consumerPeerMap: {},
  peerAudioConsumerMap: {},
  consumerStates: {},
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
      
      const newConsumers = { ...state.consumers };
      const newConsumerPeerMap = { ...state.consumerPeerMap };
      const newConsumerStates = { ...state.consumerStates };
      const newPeerAudioConsumerMap = { ...state.peerAudioConsumerMap };

      // Clean up all consumers related to this peer
      Object.entries(state.consumerPeerMap).forEach(([cid, pid]) => {
        if (pid === peerId) {
          delete newConsumers[cid];
          delete newConsumerPeerMap[cid];
          delete newConsumerStates[cid];
        }
      });
      delete newPeerAudioConsumerMap[peerId];

      return { 
        peers: newPeers, 
        videoProducers: newVideoProducers,
        consumers: newConsumers,
        consumerPeerMap: newConsumerPeerMap,
        consumerStates: newConsumerStates,
        peerAudioConsumerMap: newPeerAudioConsumerMap,
        activeWatchStream: state.activeWatchStream === peerId ? null : state.activeWatchStream
      };
    }),
    
  addConsumer: (consumerId, track, peerId) =>
    set((state) => {
      const isAudio = track.kind === 'audio';
      return { 
        consumers: { ...state.consumers, [consumerId]: track },
        consumerPeerMap: { ...state.consumerPeerMap, [consumerId]: peerId },
        peerAudioConsumerMap: isAudio 
          ? { ...state.peerAudioConsumerMap, [peerId]: consumerId }
          : state.peerAudioConsumerMap,
        consumerStates: {
          ...state.consumerStates,
          [consumerId]: state.consumerStates[consumerId] || { volume: 100, isMuted: false }
        }
      };
    }),
    
  removeConsumer: (consumerId) =>
    set((state) => {
      const newConsumers = { ...state.consumers };
      delete newConsumers[consumerId];
      
      const peerId = state.consumerPeerMap[consumerId];
      const newConsumerPeerMap = { ...state.consumerPeerMap };
      delete newConsumerPeerMap[consumerId];
      
      const newPeerAudioConsumerMap = { ...state.peerAudioConsumerMap };
      if (peerId && newPeerAudioConsumerMap[peerId] === consumerId) {
        delete newPeerAudioConsumerMap[peerId];
      }
      
      return { 
        consumers: newConsumers,
        consumerPeerMap: newConsumerPeerMap,
        peerAudioConsumerMap: newPeerAudioConsumerMap
      };
    }),

  setConsumerVolume: (consumerId, volume) =>
    set((state) => ({
      consumerStates: {
        ...state.consumerStates,
        [consumerId]: { ...(state.consumerStates[consumerId] || { isMuted: false }), volume }
      }
    })),

  setConsumerMuted: (consumerId, isMuted) =>
    set((state) => ({
      consumerStates: {
        ...state.consumerStates,
        [consumerId]: { ...(state.consumerStates[consumerId] || { volume: 100 }), isMuted }
      }
    })),
    
  clearPeers: () => set({ 
    peers: {}, 
    consumers: {}, 
    consumerPeerMap: {}, 
    peerAudioConsumerMap: {}, 
    consumerStates: {}, 
    videoProducers: {}, 
    activeWatchStream: null, 
    globalLivePeers: [], 
    channelUsers: {} 
  }),
  
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

