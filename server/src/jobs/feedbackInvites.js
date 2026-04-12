import Event from "../models/Event.js";
import Ticket from "../models/Ticket.js";
import Feedback from "../models/Feedback.js";
import User from "../models/User.js";
import { sendAppEmail } from "../utils/mailer.js";

const SWEEP_MS = Number(process.env.FEEDBACK_INVITE_SWEEP_MS || 6 * 60 * 60 * 1000);

export async function runFeedbackInviteSweep() {
  const now = new Date();
  const recentCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const events = await Event.find({
    date: { $lt: now, $gte: recentCutoff },
  }).select("_id title date");

  const clientBase = process.env.CLIENT_URL || "http://localhost:5173";

  for (const event of events) {
    const attendeeIds = await Ticket.distinct("userId", { eventId: event._id });
    for (const userId of attendeeIds) {
      const hasFeedback = await Feedback.exists({ eventId: event._id, attendeeId: userId });
      if (hasFeedback) continue;

      const pendingTickets = await Ticket.find({
        eventId: event._id,
        userId,
        feedbackInviteSentAt: null,
      });

      if (!pendingTickets.length) continue;

      const user = await User.findById(userId).select("email name");
      if (!user?.email) continue;

      const subject = `How was "${event.title}"? Share quick feedback`;
      const html = `
        <p>Hi ${user.name || "there"},</p>
        <p>Thanks for joining <strong>${event.title}</strong>. The organiser would love a short private rating and any notes to improve the next edition.</p>
        <p><a href="${clientBase}">Open EventwithEase</a>, sign in, open the event, and use the <strong>Private feedback</strong> section.</p>
        <p>— EventwithEase</p>
      `;

      try {
        await sendAppEmail({
          to: user.email,
          subject,
          html,
          devLink: `${clientBase} (feedback for ${event._id})`,
        });

        await Ticket.updateMany(
          { _id: { $in: pendingTickets.map((t) => t._id) } },
          { $set: { feedbackInviteSentAt: new Date() } }
        );
      } catch (err) {
        console.error("[feedbackInvites] send failed", user.email, err.message);
      }
    }
  }
}

export function startFeedbackInviteScheduler() {
  const tick = () => {
    runFeedbackInviteSweep().catch((err) => console.error("[feedbackInvites]", err.message));
  };
  setTimeout(tick, 15_000);
  return setInterval(tick, SWEEP_MS);
}
