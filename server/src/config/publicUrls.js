/** Public web app origin (no trailing slash). */
export function clientBaseUrl() {
  return String(process.env.CLIENT_URL || "http://localhost:5173").replace(/\/$/, "");
}

/** API origin for OG tags (same host as Express in most deploys). */
export function apiPublicOrigin() {
  const raw = process.env.API_PUBLIC_URL || process.env.CLIENT_URL || "http://localhost:5000";
  return String(raw).replace(/\/$/, "");
}
