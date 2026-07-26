import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

// User preferences persisted on-device. Currently just the dust threshold: coins
// at or below this many sats are flagged as dust in Coin Control so the user can
// freeze them (excluding them from send selection).
const DUST_KEY = 'thrilla.dustThreshold';
const DEFAULT_DUST = 1000;

interface SettingsState {
  dustThreshold: number;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setDustThreshold: (n: number) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  dustThreshold: DEFAULT_DUST,
  hydrated: false,
  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(DUST_KEY);
      const n = raw != null ? Number(raw) : NaN;
      set({
        dustThreshold: Number.isFinite(n) && n >= 0 ? n : DEFAULT_DUST,
        hydrated: true,
      });
    } catch {
      set({ hydrated: true });
    }
  },
  setDustThreshold: (n) => {
    const v = Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_DUST;
    set({ dustThreshold: v });
    AsyncStorage.setItem(DUST_KEY, String(v)).catch(() => {});
  },
}));
