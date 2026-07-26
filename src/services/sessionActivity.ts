// Idle-session activity tracking. Mirrors the web app (stores/auth.js): the
// session expires after a period of no genuine user interaction. Kept as a
// plain module-level value (not zustand state) so recording a touch on every
// gesture doesn't trigger app-wide re-renders — the idle checker just reads it.

let lastActivity = Date.now();

// Record genuine user interaction (a touch). Refreshes the idle timer.
export function touchActivity(): void {
  lastActivity = Date.now();
}

// Milliseconds since the last recorded interaction.
export function msSinceActivity(): number {
  return Date.now() - lastActivity;
}

// Reset the timer (e.g. right after login, before any async work).
export function resetActivity(): void {
  lastActivity = Date.now();
}
