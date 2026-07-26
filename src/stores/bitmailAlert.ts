import { create } from 'zustand';

// Shared BitMail tamper state. Set when a wallet's own BitMail resolves over DNS
// to an SP address that doesn't match the wallet's — surfaced as a warning on the
// Wallet screen (from anywhere) and in the BitMail card. The admin is notified
// server-side (send-time block + the backend's periodic tamper sweep + ntfy).
export interface TamperInfo {
  bitmail: string;
  expected: string; // the wallet's real SP address
  resolved: string; // what DNS currently returns
}

interface BitmailAlertState {
  tamper: TamperInfo | null;
  setTamper: (info: TamperInfo | null) => void;
  clear: () => void;
}

export const useBitmailAlert = create<BitmailAlertState>((set) => ({
  tamper: null,
  setTamper: (info) => set({ tamper: info }),
  clear: () => set({ tamper: null }),
}));
