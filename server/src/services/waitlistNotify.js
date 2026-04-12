import Waitlist from "../models/Waitlist.js";
import Event from "../models/Event.js";
import User from "../models/User.js";
import { notifyWaitlistSpotAvailable } from "./transactionalEmail.js";

const NOTIFY_COOLDOWN_MS = Number(process.env.WAITLIST_NOTIFY_COOLDOWN_MS || 2 * 60 * 60 * 1000);
const MAX_NOTIFY_PER_WAVE = Number(process.env.WAITLIST_NOTIFY_BATCH || 15);

/**
 * After tickets are released (e.g. free cancellation), email the next people on the waitlist.
 * @param {import("mongoose").Types.ObjectId|string} eventId
 * @param {{ ticketTypeNames?: string[] }} [opts]
 */
export async function notifyWaitlistAfterTicketsReleased(eventId, opts = {}) {
  if (process.env.WAITLIST_EMAIL_NOTIFY === "false") return;

  const event = await Event.findById(eventId).select("title ticketTypes");
  if (!event || event.cancelledAt) return;

  const typeNames = opts.ticketTypeNames || [];
  const typeIdsForFilter = [];
  for (const name of typeNames) {
    const tt = event.ticketTypes.find((t) => t.name === name);
    if (tt?._id) typeIdsForFilter.push(tt._id);
  }

  const baseFilter = { eventId };
  if (typeIdsForFilter.length) {
    baseFilter.$or = [{ ticketTypeId: null }, { ticketTypeId: { $in: typeIdsForFilter } }];
  }

  const now = Date.now();
  const candidates = await Waitlist.find(baseFilter).sort({ createdAt: 1 }).limit(MAX_NOTIFY_PER_WAVE).populate("userId", "email name");

  const clientPath = `/event/${String(eventId)}`;

  for (const row of candidates) {
    const u = row.userId;
    if (!u?.email) continue;
    if (row.lastNotifiedAt && now - new Date(row.lastNotifiedAt).getTime() < NOTIFY_COOLDOWN_MS) continue;

    let ticketHint = "";
    if (row.ticketTypeId) {
      const tt = event.ticketTypes.id(row.ticketTypeId);
      if (tt?.name) ticketHint = tt.name;
    }

    await notifyWaitlistSpotAvailable({
      toEmail: u.email,
      toName: u.name,
      eventTitle: event.title,
      ticketHint,
      clientPath,
    });

    row.lastNotifiedAt = new Date();
    await row.save();
  }
}

/**
 * Compute 1-based queue position within the same event + ticket type bucket (null type = any).
 */
export async function waitlistPositionForEntry(entryDoc) {
  const eid = entryDoc.eventId;
  const tid = entryDoc.ticketTypeId || null;
  const created = entryDoc.createdAt;

  const filter = { eventId: eid, createdAt: { $lte: created } };
  if (tid) {
    filter.ticketTypeId = tid;
  } else {
    filter.ticketTypeId = null;
  }

  return Waitlist.countDocuments(filter);
}
