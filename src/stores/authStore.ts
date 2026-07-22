import { create } from 'zustand';
import * as api from '@services/api';

interface AuthState {
  token: string | null;
  inkey: string | null;
  adminkey: string | null;
  walletId: string | null;
  walletName: string | null;
  username: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  inkey: null,
  adminkey: null,
  walletId: null,
  walletName: null,
  username: null,
  isAuthenticated: false,
  loading: false,
  error: null,

  login: async (username, password) => {
    set({ loading: true, error: null });
    try {
      const data = await api.login(username, password);
      const token = data.access_token || data.token;
      if (!token) {
        throw new Error('Login succeeded but no access token was returned');
      }
      const wallets = await api.getLnbitsWallets(token);
      if (!wallets?.length) {
        throw new Error('No wallets found for this account');
      }
      // Use the first wallet's keys (wallet switching can come later).
      const w = wallets[0];
      set({
        token,
        inkey: w.inkey,
        adminkey: w.adminkey,
        walletId: w.id,
        walletName: w.name,
        username,
        isAuthenticated: true,
        loading: false,
        error: null,
      });
      return true;
    } catch (e: any) {
      set({
        loading: false,
        isAuthenticated: false,
        error: e?.message || 'Login failed',
      });
      return false;
    }
  },

  logout: () =>
    set({
      token: null,
      inkey: null,
      adminkey: null,
      walletId: null,
      walletName: null,
      username: null,
      isAuthenticated: false,
      error: null,
    }),
}));
