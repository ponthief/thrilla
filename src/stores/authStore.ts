import { create } from 'zustand';

interface AuthState {
  token: string | null;
  walletId: string | null;
  isAuthenticated: boolean;
  setToken: (token: string) => void;
  setWalletId: (id: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  walletId: null,
  isAuthenticated: false,
  setToken: (token) => set({ token, isAuthenticated: !!token }),
  setWalletId: (walletId) => set({ walletId }),
  logout: () => set({ token: null, walletId: null, isAuthenticated: false }),
}));
