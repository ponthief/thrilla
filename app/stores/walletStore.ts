import { create } from 'zustand';

interface WalletState {
  balance: number;
  address: string | null;
  network: 'mainnet' | 'testnet' | 'signet' | 'regtest';
  lnbitsUrl: string;
  setBalance: (balance: number) => void;
  setAddress: (address: string) => void;
  setNetwork: (network: WalletState['network']) => void;
  setLnbitsUrl: (url: string) => void;
}

export const useWalletStore = create<WalletState>((set) => ({
  balance: 0,
  address: null,
  network: 'mainnet',
  lnbitsUrl: process.env.EXPO_PUBLIC_LNBITS_URL || '',
  setBalance: (balance) => set({ balance }),
  setAddress: (address) => set({ address }),
  setNetwork: (network) => set({ network }),
  setLnbitsUrl: (lnbitsUrl) => set({ lnbitsUrl }),
}));