import { create } from "zustand";

interface User {
  id: string;
  username: string;
  email: string;
  avatarUrl: string | null;
}

interface AuthState {
  token: string | null;
  user: User | null;
  isLoading: boolean;
  setAuth: (token: string, user: User) => void;
  logout: () => void;
  initialize: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem("auth_token"),
  user: null,
  isLoading: true,

  setAuth: (token, user) => {
    localStorage.setItem("auth_token", token);
    set({ token, user });
  },

  logout: () => {
    localStorage.removeItem("auth_token");
    set({ token: null, user: null });
  },

  initialize: async () => {
    const token = localStorage.getItem("auth_token");
    if (!token) {
      set({ isLoading: false });
      return;
    }

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/me`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        set({ user: data.user, token, isLoading: false });
      } else {
        localStorage.removeItem("auth_token");
        set({ token: null, user: null, isLoading: false });
      }
    } catch (err) {
      console.error("Failed to verify token", err);
      set({ isLoading: false });
    }
  }
}));
