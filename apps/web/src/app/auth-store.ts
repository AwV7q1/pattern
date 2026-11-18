import { create } from 'zustand';
import { api, ApiError } from './api';

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: 'admin' | 'user';
}

interface AuthState {
  /** `unknown` until the first check; `offline` = no server (local-only mode). */
  status: 'unknown' | 'offline' | 'anonymous' | 'signed-in';
  user: User | null;
  signupOpen: boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (u: User) => void;
}

export const useAuth = create<AuthState>()((set) => ({
  status: 'unknown',
  user: null,
  signupOpen: false,
  refresh: async () => {
    try {
      const [{ user }, providers] = await Promise.all([
        api<{ user: User | null }>('/auth/me'),
        api<{ signup: boolean }>('/auth/providers'),
      ]);
      set({ user, status: user ? 'signed-in' : 'anonymous', signupOpen: providers.signup });
    } catch (err) {
      set({ user: null, status: err instanceof ApiError && !err.offline ? 'anonymous' : 'offline' });
    }
  },
  login: async (email, password) => {
    const { user } = await api<{ user: User }>('/auth/login', { body: { email, password } });
    set({ user, status: 'signed-in' });
  },
  signup: async (email, password, displayName) => {
    const { user } = await api<{ user: User }>('/auth/signup', { body: { email, password, displayName } });
    set({ user, status: 'signed-in' });
  },
  logout: async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    set({ user: null, status: 'anonymous' });
  },
  setUser: (user) => set({ user }),
}));
