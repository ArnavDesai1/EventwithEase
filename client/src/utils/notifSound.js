const STORAGE_KEY = "ewe-notif-sound-enabled";
const PUSH_ESSENTIAL_KEY = "ewe-notif-push-essential";

export function isNotifSoundEnabled() {
  if (typeof window === "undefined") return false;
  const v = localStorage.getItem(STORAGE_KEY);
  return v !== "0";
}

export function setNotifSoundEnabled(on) {
  localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
}

/** Browser / OS banner for time-sensitive items only (cancel, doors, refunds, etc.). Opt-out in the panel. */
export function isNotifPushEssentialEnabled() {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(PUSH_ESSENTIAL_KEY) !== "0";
}

export function setNotifPushEssentialEnabled(on) {
  localStorage.setItem(PUSH_ESSENTIAL_KEY, on ? "1" : "0");
}

let lastChimeStandardAt = 0;
let lastChimeEssentialAt = 0;
const CHIME_GAP_STANDARD_MS = 2600;
const CHIME_GAP_ESSENTIAL_MS = 1100;

/**
 * Soft chime when a notification is created (user can mute in the panel).
 * Essentials can ring a little more often than routine milestones.
 */
export function playNotificationChime(opts = {}) {
  if (typeof window === "undefined" || !isNotifSoundEnabled()) return;
  const essential = Boolean(opts.essential);
  const now = Date.now();
  if (essential) {
    if (now - lastChimeEssentialAt < CHIME_GAP_ESSENTIAL_MS) return;
    lastChimeEssentialAt = now;
  } else {
    if (now - lastChimeStandardAt < CHIME_GAP_STANDARD_MS) return;
    lastChimeStandardAt = now;
  }
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = essential ? 880 : 740;
    o.type = "sine";
    g.gain.setValueAtTime(essential ? 0.085 : 0.065, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (essential ? 0.22 : 0.17));
    o.start(ctx.currentTime);
    o.stop(ctx.currentTime + (essential ? 0.22 : 0.17));
    ctx.resume?.();
  } catch {
    /* autoplay policy / older browsers */
  }
}
