import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const INBOX_KEY = "ewe-notif-inbox-v1";
const FIRED_KEY = "ewe-notif-fired-v1";

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

export function formatMsAsCountdown(ms) {
  if (ms <= 0) return "now";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function useEventNotifications({ user, myTickets, events, wishlist }) {
  const [inbox, setInbox] = useState(() => loadJson(INBOX_KEY, []));
  const firedRef = useRef(new Set(loadJson(FIRED_KEY, [])));

  const addNotif = useCallback((item) => {
    const canDesktop = typeof Notification !== "undefined" && Notification.permission === "granted";
    setInbox((prev) => {
      if (prev.some((x) => x.id === item.id)) return prev;
      const next = [{ ...item, read: false, at: Date.now() }, ...prev].slice(0, 60);
      saveJson(INBOX_KEY, next);
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
        }
      }

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
    const id = setInterval(run, 30000);
    return () => clearInterval(id);
  }, [user, myTickets, events, wishlist, fire]);

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
