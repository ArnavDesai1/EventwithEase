import Event from "../models/Event.js";
import Ticket from "../models/Ticket.js";
import User from "../models/User.js";
import { notifyCheckInSoon } from "../services/transactionalEmail.js";

const SWEEP_MS = Number(process.env.EWE_CHECKIN_REMINDER_SWEEP_MS || 45 * 60 * 1000);

/**
 * Email ticket holders once per event when doors are ~24h away (±45m window per sweep).
 */
export async function runCheckInReminderSweep() {
  const now = new Date();
  const start = new Date(now.getTime() + 23 * 60 * 60 * 1000);
  const end = new Date(now.getTime() + 25 * 60 * 60 * 1000);

  const events = await Event.find({
    cancelledAt: null,
    checkInReminderSentAt: null,
    date: { $gte: start, $lte: end },
  })
    .select("_id title date location")
    .limit(50);

  for (const ev of events) {
    const userIds = await Ticket.distinct("userId", {
      eventId: ev._id,
      status: "booked",
    });
    if (!userIds.length) {
      ev.checkInReminderSentAt = new Date();
      await ev.save();
      continue;
    }

    const users = await User.find({ _id: { $in: userIds } }).select("email name");
    for (const u of users) {
      if (!u.email) continue;
      await notifyCheckInSoon({
        toEmail: u.email,
        toName: u.name,
        eventTitle: ev.title,
        eventDate: ev.date,
        location: ev.location,
      }).catch(() => {});
    }

    ev.checkInReminderSentAt = new Date();
    await ev.save();
  }
}

export function startCheckInReminderScheduler() {
  const tick = () => runCheckInReminderSweep().catch((err) => console.error("[checkin-reminders]", err.message));
  setTimeout(tick, 30_000);
  return setInterval(tick, SWEEP_MS);
}
