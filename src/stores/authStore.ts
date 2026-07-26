import { create } from 'zustand';
import * as api from '@services/api';
import * as deviceTrust from '@services/deviceTrust';
import { DEVICE_TRUST_ENABLED } from '@/theme';
import { resetCatchUp } from '../hooks/useCatchUpScan';
import { useBitmailAlert } from './bitmailAlert';

// Device-trust gate state. 'trusted' when the feature is off (nothing to gate)
// or the device is confirmed; 'untrusted' means the app must show the
// device-confirmation flow before the wallet.
type DeviceStatus = 'trusted' | 'untrusted';

interface AuthState {
  token: string | null;
  inkey: string | null;
  adminkey: string | null;
  walletId: string | null;
  walletName: string | null;
  username: string | null;
  isAuthenticated: boolean;
  deviceStatus: DeviceStatus;
  loading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<boolean>;
  setTrusted: () => void;
  logout: (reason?: string) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  inkey: null,
  adminkey: null,
  walletId: null,
  walletName: null,
  username: null,
  isAuthenticated: false,
  deviceStatus: 'trusted',
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

      // Device-trust check. Login itself uses core LNbits auth (not gated), so
      // an untrusted device gets this far; we then decide whether to show the
      // wallet or the confirmation flow. Everything wallet-facing is gated by
      // deviceStatus in App.tsx, so no trusted-only endpoint is hit until here.
      let deviceStatus: DeviceStatus = 'trusted';
      if (DEVICE_TRUST_ENABLED) {
        await deviceTrust.activate(username);
        try {
          const chk = await api.deviceCheck(w.inkey);
          deviceStatus = chk.status === 'trusted' ? 'trusted' : 'untrusted';
        } catch {
          // Can't confirm trust (backend/network) — fail closed to enrollment.
          deviceStatus = 'untrusted';
        }
      }

      set({
        token,
        inkey: w.inkey,
        adminkey: w.adminkey,
        walletId: w.id,
        walletName: w.name,
        username,
        isAuthenticated: true,
        deviceStatus,
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

  // Called by the device-confirmation flow once a code is verified.
  setTrusted: () => set({ deviceStatus: 'trusted' }),

  // `reason`, when given (e.g. idle timeout), is surfaced on the login screen.
  logout: (reason?: string) => {
    // New session should re-evaluate catch-up scanning for every wallet.
    resetCatchUp();
    useBitmailAlert.getState().clear();
    // Drop the in-memory device id; the keystore entry survives so the same
    // device stays trusted on the next login.
    deviceTrust.clearCurrent();
    set({
      token: null,
      inkey: null,
      adminkey: null,
      walletId: null,
      walletName: null,
      username: null,
      isAuthenticated: false,
      deviceStatus: 'trusted',
      error: reason || null,
    });
  },
}));
