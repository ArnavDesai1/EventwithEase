const STORAGE_KEY = "ewe-notif-sound-enabled";

export function isNotifSoundEnabled() {
  if (typeof window === "undefined") return false;
  const v = localStorage.getItem(STORAGE_KEY);
  return v !== "0";
}

export function setNotifSoundEnabled(on) {
  localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
}

let lastChimeAt = 0;
const CHIME_GAP_MS = 2800;

/** Short soft chime when a milestone notification is created (user can mute). Throttled so bulk alerts do not spam. */
export function playNotificationChime() {
  if (typeof window === "undefined" || !isNotifSoundEnabled()) return;
  const now = Date.now();
  if (now - lastChimeAt < CHIME_GAP_MS) return;
  lastChimeAt = now;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 784;
    o.type = "sine";
    g.gain.setValueAtTime(0.07, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    o.start(ctx.currentTime);
    o.stop(ctx.currentTime + 0.18);
    ctx.resume?.();
  } catch {
    /* autoplay policy / older browsers */
  }
}
