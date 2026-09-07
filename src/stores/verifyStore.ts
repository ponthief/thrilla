import { create } from 'zustand';

// State of an email-verification link that opened the app.
//
// The link is an Android App Link on the verify URL, so clicking it in a mail
// client comes straight here instead of to a browser. The token is redeemed by
// hooks/useVerifyLink; this store is what the register and login screens read to
// react to the result.
//
// Two ways it plays out, and the difference is only whether the app survived:
//  - warm: the "check your email" screen is still up and holds the password in
//    memory, so RegisterScreen signs the user straight in.
//  - cold: the app was killed while the user was in their inbox, so there is no
//    password. The account is created either way, and LoginScreen prefills the
//    username the server hands back — one field instead of two.

export type VerifyStatus = 'idle' | 'verifying' | 'done' | 'failed';

interface VerifyState {
  status: VerifyStatus;
  // Set once the server confirms, and read by LoginScreen to prefill.
  username: string | null;
  error: string | null;
  begin: () => void;
  succeed: (username: string) => void;
  fail: (message: string) => void;
  reset: () => void;
}

export const useVerifyStore = create<VerifyState>((set) => ({
  status: 'idle',
  username: null,
  error: null,
  begin: () => set({ status: 'verifying', error: null }),
  succeed: (username) => set({ status: 'done', username, error: null }),
  fail: (message) => set({ status: 'failed', error: message }),
  reset: () => set({ status: 'idle', username: null, error: null }),
}));
