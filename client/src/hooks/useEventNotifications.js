import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { playNotificationChime } from "../utils/notifSound.js";

const INBOX_KEY = "ewe-notif-inbox-v1";
const FIRED_KEY = "ewe-notif-fired-v1";
const FOLLOW_SNAP_KEY = "ewe-follow-event-snapshot-v1";

function organiserIdFromEvent(ev) {
  const o = ev?.organiserId;
  if (o == null || o === "") return null;
  if (typeof o === "string") return o;
  const id = o._id ?? o.id;
  return id != null ? String(id) : null;
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    /* ignore quota / private mode */
  }
}

function mergedEventForTicket(ticket, events) {
  const id = String(ticket.eventId?._id || ticket.eventId || "");
  const fromList = events.find((e) => String(e._id) === id);
  return fromList || ticket.eventId;
}

export function formatMsAsCountdown(ms, opts = {}) {
  const { withSeconds = false } = opts;
  if (ms <= 0) return "now";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const showSec = withSeconds || d === 0;
  if (d > 0) return showSec ? `${d}d ${h}h ${m}m ${sec}s` : `${d}d ${h}h ${m}m`;
  if (h > 0) return showSec ? `${h}h ${m}m ${sec}s` : `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

const RESOLVED_NOTIF_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function useEventNotifications({
  user,
  myTickets,
  events,
  wishlist,
  followingList = [],
  attendeeRefunds = [],
  hostRefunds = [],
}) {
  const [inbox, setInbox] = useState(() => loadJson(INBOX_KEY, []));
  const firedRef = useRef(new Set(loadJson(FIRED_KEY, [])));

  const addNotif = useCallback((item) => {
    const canDesktop = typeof Notification !== "undefined" && Notification.permission === "granted";
    setInbox((prev) => {
      if (prev.some((x) => x.id === item.id)) return prev;
      const next = [{ ...item, read: false, at: Date.now() }, ...prev].slice(0, 60);
      saveJson(INBOX_KEY, next);
      playNotificationChime();
      if (canDesktop) {
        try {
          new Notification(item.title, { body: item.body, tag: item.id });
        } catch {
          /* ignore */
        }
      }
      return next;
    });
  }, []);

  const fire = useCallback(
    (key, payload) => {
      if (firedRef.current.has(key)) return false;
      firedRef.current.add(key);
      saveJson(FIRED_KEY, [...firedRef.current]);
      addNotif(payload);
      return true;
    },
    [addNotif]
  );

  useEffect(() => {
    if (!user) return undefined;

    const run = () => {
      const now = Date.now();
      const seenEventIds = new Set();

      for (const t of myTickets) {
        if (t.status === "expired") {
          const ev = mergedEventForTicket(t, events);
          const eid = String(ev?._id || t.eventId?._id || t.eventId || "");
          fire(`texp:${t._id}`, {
            id: `texp:${t._id}`,
            title: "Ticket expired",
            body: `${ev?.title || "Your event"} has ended — this pass is no longer valid for entry.`,
            link: eid ? `/event/${eid}` : "/",
          });
        }
      }

      for (const t of myTickets) {
        const ev = mergedEventForTicket(t, events);
        if (!ev?.date) continue;
        const eid = String(ev._id || "");
        if (!eid || seenEventIds.has(eid)) continue;
        seenEventIds.add(eid);

        const start = new Date(ev.date).getTime();
        if (Number.isNaN(start)) continue;
        const delta = start - now;
        if (delta <= 0) continue;

        if (ev.cancelledAt) {
          fire(`cancel:${eid}`, {
            id: `cancel:${eid}`,
            title: "Event cancelled",
            body: `${ev.title} is cancelled. Check your email or request a refund if you paid.`,
            link: `/event/${eid}`,
          });
          continue;
        }

        if (delta <= 60 * 1000) {
          fire(`start:${eid}`, {
            id: `start:${eid}`,
            title: "Event is starting",
            body: ev.title,
            link: `/event/${eid}`,
          });
        } else if (delta <= 15 * 60 * 1000) {
          fire(`m15:${eid}`, {
            id: `m15:${eid}`,
            title: "Starts in under 15 minutes",
            body: ev.title,
            link: `/event/${eid}`,
          });
        } else if (delta <= 60 * 60 * 1000) {
          fire(`h1:${eid}`, {
            id: `h1:${eid}`,
            title: "Starts within 1 hour",
            body: ev.title,
            link: `/event/${eid}`,
          });
        } else if (delta <= 24 * 60 * 60 * 1000) {
          fire(`d1:${eid}`, {
            id: `d1:${eid}`,
            title: "Starts within 24 hours",
            body: `${ev.title} — ${formatMsAsCountdown(delta)} to go.`,
            link: `/event/${eid}`,
          });
        } else if (delta <= 7 * 24 * 60 * 60 * 1000) {
          fire(`w7:${eid}`, {
            id: `w7:${eid}`,
            title: "Event this week",
            body: `${ev.title} — ${formatMsAsCountdown(delta)} until doors.`,
            link: `/event/${eid}`,
          });
        }
      }

      const snap = loadJson(FOLLOW_SNAP_KEY, {});
      let snapDirty = false;
      const followingIds = new Set(followingList.map((f) => String(f.organiserId)));
      const nameByOrganiser = new Map(followingList.map((f) => [String(f.organiserId), f.name || "Host"]));

      for (const oid of followingIds) {
        const futureForHost = events.filter((ev) => {
          const eoid = organiserIdFromEvent(ev);
          if (String(eoid) !== String(oid)) return false;
          const st = ev?.date ? new Date(ev.date).getTime() : NaN;
          return Number.isFinite(st) && st > now;
        });
        const ids = futureForHost.map((ev) => String(ev._id)).sort();
        const prev = snap[oid];
        if (!Array.isArray(prev)) {
          snap[oid] = ids;
          snapDirty = true;
        } else {
          const prevSet = new Set(prev);
          for (const ev of futureForHost) {
            const eid = String(ev._id);
            if (prevSet.has(eid)) continue;
            fire(`follownew:${eid}`, {
              id: `follownew:${eid}`,
              title: `New from ${nameByOrganiser.get(String(oid)) || "a host you follow"}`,
              body: ev.title,
              link: `/event/${eid}`,
            });
          }
          if (ids.length !== prev.length || ids.some((id, i) => id !== prev[i])) {
            snap[oid] = ids;
            snapDirty = true;
          }
        }
      }

      for (const key of Object.keys(snap)) {
        if (!followingIds.has(key)) {
          delete snap[key];
          snapDirty = true;
        }
      }

      if (snapDirty) saveJson(FOLLOW_SNAP_KEY, snap);

      const wishSet = new Set(wishlist.map(String));
      for (const eid of wishSet) {
        const ev = events.find((e) => String(e._id) === eid);
        if (!ev?.ticketTypes?.length) continue;
        for (const tt of ev.ticketTypes) {
          if (!tt.earlyBirdEndsAt || tt.earlyBirdPrice == null) continue;
          const end = new Date(tt.earlyBirdEndsAt).getTime();
          if (Number.isNaN(end) || end <= now) continue;
          const until = end - now;
          if (until > 0 && until <= 48 * 60 * 60 * 1000) {
            fire(`eb:${eid}:${tt.name}`, {
              id: `eb:${eid}:${tt.name}`,
              title: "Early bird ending soon",
              body: `${ev.title} — ${tt.name} promo price ends ${new Date(tt.earlyBirdEndsAt).toLocaleDateString()}.`,
              link: `/event/${eid}`,
            });
          }
        }
      }
    };

    run();
    const id = setInterval(run, 10000);
    return () => clearInterval(id);
  }, [user, myTickets, events, wishlist, followingList, fire]);

  useEffect(() => {
    if (!user) return;
    for (const r of attendeeRefunds) {
      const id = String(r._id);
      const title = r.eventId?.title || "Your booking";
      if (r.status === "pending") {
        const fee = r.cancellationFeeAmount ?? "—";
        const net = r.refundNetAmount ?? "—";
        const when = r.autoApproveAt ? new Date(r.autoApproveAt).toLocaleString() : "soon";
        fire(`arefp:${id}`, {
          id: `arefp:${id}`,
          title: "Refund in progress",
          body: `${title}: fee ${fee}, net ${net}. Auto-approve by ${when}.`,
          link: "/",
        });
      }
      if (r.status === "approved" && r.resolvedAt && Date.now() - new Date(r.resolvedAt).getTime() < RESOLVED_NOTIF_MAX_AGE_MS) {
        fire(`arefa:${id}`, {
          id: `arefa:${id}`,
          title: "Refund approved",
          body: `${title}: net ${r.refundNetAmount ?? ""} marked settled.`,
          link: "/",
        });
      }
      if (r.status === "rejected" && r.resolvedAt && Date.now() - new Date(r.resolvedAt).getTime() < RESOLVED_NOTIF_MAX_AGE_MS) {
        fire(`arefr:${id}`, {
          id: `arefr:${id}`,
          title: "Refund update",
          body: `${title}: request was not approved — check email or support.`,
          link: "/",
        });
      }
    }
  }, [user, attendeeRefunds, fire]);

  useEffect(() => {
    if (!user) return;
    for (const r of hostRefunds) {
      const id = String(r._id);
      const title = r.eventId?.title || "Your event";
      const who = r.attendeeId?.name || "Attendee";
      if (r.status === "pending") {
        fire(`hrefp:${id}`, {
          id: `hrefp:${id}`,
          title: "Refund request",
          body: `${who} · ${title} · net ${r.refundNetAmount ?? "—"} after fee · auto-approves on schedule.`,
          link: "/",
        });
      }
      if (r.status === "approved" && r.resolvedAt && Date.now() - new Date(r.resolvedAt).getTime() < RESOLVED_NOTIF_MAX_AGE_MS) {
        fire(`hrefa:${id}`, {
          id: `hrefa:${id}`,
          title: "Refund finalized",
          body: `${title}: ${who} — net ${r.refundNetAmount ?? ""} left your payout balance.`,
          link: "/",
        });
      }
    }
  }, [user, hostRefunds, fire]);

  const unreadCount = useMemo(() => inbox.filter((x) => !x.read).length, [inbox]);

  const markRead = useCallback((id) => {
    setInbox((prev) => {
      const next = prev.map((x) => (x.id === id ? { ...x, read: true } : x));
      saveJson(INBOX_KEY, next);
      return next;
    });
  }, []);

  const markAllRead = useCallback(() => {
    setInbox((prev) => {
      const next = prev.map((x) => ({ ...x, read: true }));
      saveJson(INBOX_KEY, next);
      return next;
    });
  }, []);

  const requestDesktopPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return "unsupported";
    if (Notification.permission === "granted") return "granted";
    if (Notification.permission === "denied") return "denied";
    return Notification.requestPermission();
  }, []);

  return {
    notifications: inbox,
    unreadCount,
    markRead,
    markAllRead,
    requestDesktopPermission,
    desktopSupported: typeof Notification !== "undefined",
    desktopPermission: typeof Notification !== "undefined" ? Notification.permission : "unsupported",
  };
}
