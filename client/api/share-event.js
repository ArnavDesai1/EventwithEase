/**
 * Vercel serverless: proxies OG HTML from your API so you can rewrite
 * `/share/e/:id` → this handler and set `OG_API_ORIGIN` to the API root (no /api).
 */
export default async function handler(req, res) {
  const id = req.query.id;
  if (!id || typeof id !== "string" || id.length !== 24) {
    res.status(400).send("Bad id");
    return;
  }
  const origin = process.env.OG_API_ORIGIN || process.env.VITE_API_URL?.replace(/\/api\/?$/i, "") || "http://localhost:5000";
  const url = `${origin.replace(/\/$/, "")}/og/event/${id}`;
  try {
    const r = await fetch(url);
    const text = await r.text();
    res.status(r.ok ? 200 : r.status);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(text);
  } catch (e) {
    res.status(502).send("Upstream OG fetch failed");
  }
}
