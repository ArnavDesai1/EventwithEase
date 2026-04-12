import mongoose from "mongoose";
import Event from "../models/Event.js";
import User from "../models/User.js";
import { clientBaseUrl } from "../config/publicUrls.js";

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ogPage({ title, description, imageUrl, canonicalPath }) {
  const client = clientBaseUrl();
  const canonical = `${client}${canonicalPath.startsWith("/") ? canonicalPath : `/${canonicalPath}`}`;
  const img = imageUrl || `${client}/favicon.svg`;
  const desc = (description || "").slice(0, 300);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(desc)}" />
  <link rel="canonical" href="${escapeHtml(canonical)}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(desc)}" />
  <meta property="og:image" content="${escapeHtml(img)}" />
  <meta property="og:url" content="${escapeHtml(canonical)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(desc)}" />
  <meta name="twitter:image" content="${escapeHtml(img)}" />
</head>
<body style="font-family:system-ui,sans-serif;padding:2rem;background:#0c0e12;color:#e8eaef;">
  <p><a href="${escapeHtml(canonical)}" style="color:#3ecfbf;">Open in EventwithEase →</a></p>
  <h1 style="font-size:1.25rem;">${escapeHtml(title)}</h1>
  <p style="opacity:.85;max-width:42rem;">${escapeHtml(desc)}</p>
</body>
</html>`;
}

export async function handleOgEvent(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).type("text/plain").send("Invalid id");
    }
    const event = await Event.findById(id).populate("organiserId", "name hostTagline");
    if (!event) return res.status(404).type("text/plain").send("Event not found");

    const host = event.organiserId && typeof event.organiserId === "object" ? event.organiserId.name : "";
    const title = `${event.title} · EventwithEase`;
    const description =
      (event.description || "").replace(/\s+/g, " ").trim().slice(0, 220) +
      (host ? ` — Hosted by ${host}.` : "");

    const html = ogPage({
      title,
      description,
      imageUrl: event.coverImage || "",
      canonicalPath: `/event/${id}`,
    });
    res.type("text/html; charset=utf-8").send(html);
  } catch (e) {
    res.status(500).type("text/plain").send("Error");
  }
}

export async function handleOgHost(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).type("text/plain").send("Invalid id");
    }
    const user = await User.findById(id).select("name hostTagline hostBio");
    if (!user) return res.status(404).type("text/plain").send("Host not found");

    const title = `${user.name || "Host"} · EventwithEase`;
    const description = (user.hostTagline || user.hostBio || "Host on EventwithEase.").replace(/\s+/g, " ").trim().slice(0, 240);

    const html = ogPage({
      title,
      description,
      imageUrl: "",
      canonicalPath: `/host/${id}`,
    });
    res.type("text/html; charset=utf-8").send(html);
  } catch (e) {
    res.status(500).type("text/plain").send("Error");
  }
}
