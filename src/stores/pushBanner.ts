import { create } from 'zustand';

// In-app banner for foreground push messages. Android only auto-displays FCM
// notifications when the app is backgrounded/closed; when a message arrives
// while the app is open we surface it ourselves via this store, which the
// app-wide <PushBanner /> renders. Callable outside React (e.g. from the
// messaging onMessage handler) through usePushBanner.getState().show(...).
export interface PushBannerContent {
  title: string;
  body: string;
}

interface PushBannerState {
  banner: PushBannerContent | null;
  show: (content: PushBannerContent) => void;
  clear: () => void;
}

export const usePushBanner = create<PushBannerState>((set) => ({
  banner: null,
  show: (content) => set({ banner: content }),
  clear: () => set({ banner: null }),
}));
