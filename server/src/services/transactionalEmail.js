import User from "../models/User.js";
import Event from "../models/Event.js";
import Ticket from "../models/Ticket.js";
import { sendAppEmail } from "../utils/mailer.js";
import { clientBaseUrl } from "../config/publicUrls.js";

function transactionalEnabled() {
  return process.env.TRANSACTIONAL_EMAIL !== "false";
}

/**
 * @param {import("mongoose").Types.ObjectId|string} userId
 */
export async function notifyRefundResolved(refund, status) {
  if (!transactionalEnabled()) return;
  const attendee = await User.findById(refund.attendeeId).select("email name");
  const ev = await Event.findById(refund.eventId).select("title date");
  if (!attendee?.email || !ev) return;

  const link = `${clientBaseUrl()}/`;
  const subject =
    status === "approved" ? `Refund approved — ${ev.title}` : `Refund update — ${ev.title}`;
  const body =
    status === "approved"
      ? `<p>Hi ${attendee.name || "there"},</p><p>Your refund request for <strong>${ev.title}</strong> was <strong>approved</strong>. The net amount shown in your account flow may take a few business days to appear, depending on your bank.</p><p><a href="${link}">Open EventwithEase</a></p>`
      : `<p>Hi ${attendee.name || "there"},</p><p>Your refund request for <strong>${ev.title}</strong> was <strong>not approved</strong> at this time. Open the app for details or contact support if you believe this is an error.</p><p><a href="${link}">Open EventwithEase</a></p>`;

  await sendAppEmail({ to: attendee.email, subject, html: body, devLink: link });
}

export async function notifyOrganiserRefundRequested(refund) {
  if (!transactionalEnabled()) return;
  const ev = await Event.findById(refund.eventId).populate("organiserId", "email name");
  const org = ev?.organiserId;
  const email = org && typeof org === "object" ? org.email : null;
  if (!email) return;

  const attendee = await User.findById(refund.attendeeId).select("name email");
  const link = `${clientBaseUrl()}/`;
  await sendAppEmail({
    to: email,
    subject: `New refund request — ${ev.title}`,
    html: `<p>A refund was requested for <strong>${ev.title}</strong>.</p><p>Attendee: ${attendee?.name || "—"} (${attendee?.email || "—"}).</p><p>Status is pending (auto-approve may apply per policy).</p><p><a href="${link}">Open organiser dashboard</a></p>`,
    devLink: link,
  });
}

export async function notifyAttendeesEventCancelled(event) {
  if (!transactionalEnabled()) return;
  const tickets = await Ticket.find({
    eventId: event._id,
    status: { $in: ["booked", "checked-in"] },
  }).distinct("userId");
  const users = await User.find({ _id: { $in: tickets } }).select("email name");
  const link = `${clientBaseUrl()}/`;
  const subject = `Event cancelled — ${event.title}`;
  const html = `<p>Hi,</p><p><strong>${event.title}</strong> has been cancelled by the host. If you purchased tickets, check <em>My tickets</em> and refund options in the app.</p><p><a href="${link}">Open EventwithEase</a></p>`;

  for (const u of users) {
    if (!u.email) continue;
    await sendAppEmail({ to: u.email, subject, html, devLink: link });
  }
}

export async function notifyWaitlistSpotAvailable({ toEmail, toName, eventTitle, ticketHint, clientPath }) {
  if (!transactionalEnabled()) return;
  const url = `${clientBaseUrl()}${clientPath || "/"}`;
  await sendAppEmail({
    to: toEmail,
    subject: `Tickets may be available — ${eventTitle}`,
    html: `<p>Hi ${toName || "there"},</p><p>Capacity may have opened for <strong>${eventTitle}</strong>${ticketHint ? ` (${ticketHint})` : ""}. Book soon before it fills again.</p><p><a href="${url}">Open event</a></p>`,
    devLink: url,
  });
}

export async function notifyCheckInSoon({ toEmail, toName, eventTitle, eventDate, location }) {
  if (!transactionalEnabled()) return;
  const link = `${clientBaseUrl()}/`;
  await sendAppEmail({
    to: toEmail,
    subject: `Tomorrow: ${eventTitle}`,
    html: `<p>Hi ${toName || "there"},</p><p><strong>${eventTitle}</strong> is coming up (${new Date(eventDate).toUTCString()}). Venue: ${location || "see event page"}.</p><p>Have your QR ticket ready for check-in.</p><p><a href="${link}">Open EventwithEase</a></p>`,
    devLink: link,
  });
}
