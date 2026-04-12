/**
 * Link crawlers (LinkedIn, Slack, iMessage) should fetch for rich previews.
 * Expects API base without `/api` suffix, e.g. `https://your-api.onrender.com`.
 */
export function ogEventUrl(eventId) {
  const raw = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
  const base = String(raw).replace(/\/api\/?$/i, "");
  return `${base}/og/event/${eventId}`;
}

export function ogHostUrl(userId) {
  const raw = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
  const base = String(raw).replace(/\/api\/?$/i, "");
  return `${base}/og/host/${userId}`;
}
