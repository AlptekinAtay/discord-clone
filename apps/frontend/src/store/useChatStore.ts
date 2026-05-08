import { create } from "zustand";

export interface ChatUser {
  id: string;
  username: string;
  avatarUrl: string;
}

export interface ChatMessage {
  id: string;
  channelId: string;
  authorId: string;
  content: string;
  fileUrl?: string;
  fileType?: string;
  createdAt: string;
  author?: ChatUser;
}

interface ChatState {
  activeTextChannel: string | null;
  messages: Record<string, ChatMessage[]>; // channelId -> messages
  
  setActiveTextChannel: (channelId: string | null) => void;
  addMessage: (message: ChatMessage) => void;
  setMessages: (channelId: string, messages: ChatMessage[]) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  activeTextChannel: null,
  messages: {},

  setActiveTextChannel: (channelId) => set({ activeTextChannel: channelId }),
  
  addMessage: (msg) => set((state) => {
    const channelMsgs = state.messages[msg.channelId] || [];
    // Check if message already exists (prevent duplicate rendering if server and local both add it)
    if (channelMsgs.some(m => m.id === msg.id)) return state;
    
    return {
      messages: {
        ...state.messages,
        [msg.channelId]: [...channelMsgs, msg]
      }
    };
  }),

  setMessages: (channelId, messages) => set((state) => ({
    messages: {
      ...state.messages,
      [channelId]: messages
    }
  }))
}));
