import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import Stripe from "stripe";
import Event from "../models/Event.js";
import Booking from "../models/Booking.js";
import Ticket from "../models/Ticket.js";
import User from "../models/User.js";
import { sendAppEmail } from "../utils/mailer.js";

const stripeClient = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

export async function backfillTicketTypeSoldCounts() {
  const events = await Event.find();
  for (const ev of events) {
    let dirty = false;
    for (const tt of ev.ticketTypes) {
      const c = await Ticket.countDocuments({ eventId: ev._id, ticketTypeName: tt.name });
      const next = Number(c) || 0;
      if (Number(tt.soldCount) !== next) {
        tt.soldCount = next;
        dirty = true;
      }
    }
    if (dirty) await ev.save();
  }
}

export async function tryIncrementTicketSoldCount(eventId, ticketTypeId, quantity) {
  const oid = new mongoose.Types.ObjectId(String(ticketTypeId));
  const res = await Event.updateOne(
    { _id: eventId },
    { $inc: { "ticketTypes.$[elem].soldCount": quantity } },
    {
      arrayFilters: [
        {
          "elem._id": oid,
          $expr: {
            $lte: [{ $add: [{ $ifNull: ["$elem.soldCount", 0] }, quantity] }, "$elem.quantity"],
          },
        },
      ],
    }
  );
  return res.modifiedCount === 1;
}

export async function decrementTicketSoldCount(eventId, ticketTypeId, quantity) {
  const oid = new mongoose.Types.ObjectId(String(ticketTypeId));
  await Event.updateOne(
    { _id: eventId },
    { $inc: { "ticketTypes.$[elem].soldCount": -quantity } },
    { arrayFilters: [{ "elem._id": oid }] }
  );
}

export async function decrementSoldCountsForDeletedTickets(event, tickets) {
  const byName = {};
  for (const t of tickets) {
    const name = t.ticketTypeName;
    if (!name) continue;
    byName[name] = (byName[name] || 0) + 1;
  }
  for (const [name, n] of Object.entries(byName)) {
    const tt = event.ticketTypes.find((x) => x.name === name);
    if (tt?._id) await decrementTicketSoldCount(event._id, tt._id, n);
  }
}

function resolveDiscount(event, normalizedCode, now) {
  if (!normalizedCode) return null;
  return (
    (event.discountCodes || []).find((code) => {
      if (!code?.code) return false;
      if (code.code.toUpperCase() !== normalizedCode) return false;
      if (code.expiresAt && new Date(code.expiresAt) <= now) return false;
      return true;
    }) || null
  );
}

function buildTicketDocsForCart(event, normalizedItems, now, userId, eventId) {
  let subtotalAmount = 0;
  let totalQuantity = 0;
  const ticketDocs = [];

  for (const item of normalizedItems) {
    const selectedTicket = event.ticketTypes.id(item.ticketTypeId);
    if (!selectedTicket) {
      return { error: { status: 404, message: "Ticket type not found." } };
    }

    const earlyBirdEndsAt = selectedTicket.earlyBirdEndsAt ? new Date(selectedTicket.earlyBirdEndsAt) : null;
    const hasEarlyBirdPrice = selectedTicket.earlyBirdPrice !== undefined && selectedTicket.earlyBirdPrice !== null;
    const earlyBirdPrice = Number(selectedTicket.earlyBirdPrice);
    const isEarlyBirdActive =
      hasEarlyBirdPrice && earlyBirdEndsAt && earlyBirdEndsAt > now && Number.isFinite(earlyBirdPrice);
    const effectivePrice = isEarlyBirdActive ? Math.max(0, earlyBirdPrice) : Number(selectedTicket.price) || 0;

    subtotalAmount += effectivePrice * item.quantity;
    totalQuantity += item.quantity;
    ticketDocs.push(
      ...Array.from({ length: item.quantity }, () => ({
        ticketCode: `EWE-${uuidv4().slice(0, 8).toUpperCase()}`,
        eventId,
        userId,
        ticketTypeName: selectedTicket.name,
        price: effectivePrice,
      }))
    );
  }

  return { subtotalAmount, totalQuantity, ticketDocs };
}

function applyDiscountToSubtotal(subtotalAmount, appliedDiscount) {
  let discountAmount = 0;
  if (appliedDiscount) {
    if (appliedDiscount.type === "percent") {
      discountAmount = Math.min(subtotalAmount, (subtotalAmount * (Number(appliedDiscount.value) || 0)) / 100);
    } else {
      discountAmount = Math.min(subtotalAmount, Number(appliedDiscount.value) || 0);
    }
  }
  const totalAmount = Math.max(0, subtotalAmount - discountAmount);
  return { discountAmount, totalAmount };
}

async function maybeSendBookingEmail(attendeeId, eventTitle, ticketCount) {
  if (process.env.SEND_BOOKING_EMAIL !== "true") return;
  const user = await User.findById(attendeeId).select("email name");
  if (!user?.email) return;
  await sendAppEmail({
    to: user.email,
    subject: `Tickets confirmed — ${eventTitle}`,
    html: `<p>Hi ${user.name || "there"},</p><p>Your booking for <strong>${eventTitle}</strong> is confirmed (${ticketCount} ticket(s)). Open EventwithEase to view your QR codes.</p>`,
  });
}

/**
 * Creates booking + tickets after atomic per–ticket-type capacity checks.
 * Rolls back soldCount increments if insert fails.
 */
export async function createBookingFromCart({
  userId,
  eventId,
  normalizedItems,
  discountCode = "",
  stripeCheckoutSessionId = null,
}) {
  const event = await Event.findById(eventId);
  const now = new Date();
  const normalizedCode = String(discountCode || "").trim().toUpperCase();

  if (!event) {
    return { error: { status: 404, message: "Event not found." } };
  }
  if (event.cancelledAt) {
    return { error: { status: 400, message: "This event has been cancelled. New bookings are closed." } };
  }

  let appliedDiscount = null;
  if (normalizedCode) {
    appliedDiscount = resolveDiscount(event, normalizedCode, now);
    if (!appliedDiscount) {
      return { error: { status: 400, message: "Invalid or expired discount code." } };
    }
  }

  const built = buildTicketDocsForCart(event, normalizedItems, now, userId, eventId);
  if (built.error) return built;

  const { subtotalAmount, totalQuantity, ticketDocs } = built;
  const { discountAmount, totalAmount } = applyDiscountToSubtotal(subtotalAmount, appliedDiscount);

  const reserved = [];
  try {
    for (const item of normalizedItems) {
      const ok = await tryIncrementTicketSoldCount(eventId, item.ticketTypeId, item.quantity);
      if (!ok) {
        const selectedTicket = event.ticketTypes.id(item.ticketTypeId);
        const label = selectedTicket?.name || "ticket";
        for (const r of reserved) {
          await decrementTicketSoldCount(eventId, r.ticketTypeId, r.quantity);
        }
        return {
          error: {
            status: 400,
            message: `Not enough ${label} tickets remaining.`,
            code: "SOLD_OUT",
          },
        };
      }
      reserved.push({ ticketTypeId: item.ticketTypeId, quantity: item.quantity });
    }

    let booking;
    try {
      booking = await Booking.create({
        eventId,
        attendeeId: userId,
        subtotalAmount,
        discountAmount,
        discountCode: appliedDiscount ? appliedDiscount.code : "",
        totalAmount,
        quantity: totalQuantity,
        stripeCheckoutSessionId: stripeCheckoutSessionId || undefined,
      });
    } catch (e) {
      if (e?.code === 11000 && stripeCheckoutSessionId) {
        for (const r of reserved) {
          await decrementTicketSoldCount(eventId, r.ticketTypeId, r.quantity);
        }
        const existing = await Booking.findOne({ stripeCheckoutSessionId });
        if (existing) {
          const tickets = await Ticket.find({ bookingId: existing._id })
            .populate("eventId", "title date location category coverImage cancelledAt ticketTypes")
            .populate("userId", "name email");
          return {
            booking: existing,
            tickets,
            eventTitle: event.title,
            subtotalAmount: existing.subtotalAmount,
            discountAmount: existing.discountAmount,
            totalAmount: existing.totalAmount,
            duplicate: true,
          };
        }
      }
      throw e;
    }

    let tickets;
    try {
      tickets = await Ticket.insertMany(ticketDocs.map((ticket) => ({ ...ticket, bookingId: booking._id })));
    } catch (insertErr) {
      await Booking.deleteOne({ _id: booking._id });
      for (const r of reserved) {
        await decrementTicketSoldCount(eventId, r.ticketTypeId, r.quantity);
      }
      throw insertErr;
    }

    await maybeSendBookingEmail(userId, event.title, tickets.length);

    return {
      booking,
      tickets,
      eventTitle: event.title,
      subtotalAmount,
      discountAmount,
      totalAmount,
    };
  } catch (e) {
    for (const r of reserved) {
      await decrementTicketSoldCount(eventId, r.ticketTypeId, r.quantity);
    }
    throw e;
  }
}

function parseCartMetadata(cartJson) {
  let raw;
  try {
    raw = JSON.parse(cartJson || "[]");
  } catch {
    return null;
  }
  if (!Array.isArray(raw) || !raw.length) return null;
  const normalizedItems = [];
  for (const row of raw) {
    if (Array.isArray(row) && row.length >= 2) {
      normalizedItems.push({ ticketTypeId: row[0], quantity: Number(row[1]) });
    } else if (row && typeof row === "object") {
      normalizedItems.push({
        ticketTypeId: row.ticketTypeId || row.i,
        quantity: Number(row.quantity ?? row.q),
      });
    }
  }
  return normalizedItems.filter((item) => item.ticketTypeId && item.quantity > 0);
}

/**
 * Idempotent Stripe fulfillment: verifies payment + metadata, optional user match, amount vs server pricing.
 */
export async function fulfillStripeCheckoutSession(sessionId, { assertUserId = null } = {}) {
  if (!stripeClient) {
    return { error: { status: 503, message: "Stripe is not configured on the server." } };
  }

  const existing = await Booking.findOne({ stripeCheckoutSessionId: sessionId });
  if (existing) {
    const tickets = await Ticket.find({ bookingId: existing._id })
      .populate("eventId", "title date location category coverImage cancelledAt ticketTypes")
      .populate("userId", "name email");
    const ev = await Event.findById(existing.eventId).select("title");
    return {
      duplicate: true,
      booking: existing,
      tickets,
      eventTitle: ev?.title || "",
      subtotalAmount: existing.subtotalAmount,
      discountAmount: existing.discountAmount,
      totalAmount: existing.totalAmount,
    };
  }

  const session = await stripeClient.checkout.sessions.retrieve(sessionId);
  if (session.payment_status !== "paid") {
    return { error: { status: 400, message: "Checkout is not paid yet.", code: "STRIPE_UNPAID" } };
  }

  const meta = session.metadata || {};
  const userId = meta.userId;
  const eventId = meta.eventId;
  if (!userId || !eventId) {
    return { error: { status: 400, message: "Checkout session is missing booking metadata." } };
  }
  if (assertUserId && String(userId) !== String(assertUserId)) {
    return { error: { status: 403, message: "This payment belongs to a different signed-in user." } };
  }

  const normalizedItems = parseCartMetadata(meta.cart);
  if (!normalizedItems?.length) {
    return { error: { status: 400, message: "Checkout session is missing cart metadata." } };
  }

  const event = await Event.findById(eventId);
  if (!event) {
    return { error: { status: 404, message: "Event not found." } };
  }

  const built = buildTicketDocsForCart(
    event,
    normalizedItems,
    new Date(),
    userId,
    eventId
  );
  if (built.error) return built;

  const appliedDiscount = resolveDiscount(event, String(meta.discountCode || "").trim().toUpperCase(), new Date());
  if (String(meta.discountCode || "").trim() && !appliedDiscount) {
    return { error: { status: 400, message: "Discount on session is invalid or expired." } };
  }

  const { discountAmount, totalAmount } = applyDiscountToSubtotal(built.subtotalAmount, appliedDiscount);
  if (Math.abs(Number(totalAmount) * 100 - Number(session.amount_total || 0)) > 5) {
    return {
      error: {
        status: 400,
        message: "Paid amount does not match current ticket pricing. Request a new checkout.",
        code: "STRIPE_AMOUNT_MISMATCH",
      },
    };
  }

  const result = await createBookingFromCart({
    userId,
    eventId,
    normalizedItems,
    discountCode: meta.discountCode || "",
    stripeCheckoutSessionId: sessionId,
  });

  if (result.error) return result;

  if (result.duplicate) {
    return {
      duplicate: true,
      booking: result.booking,
      tickets: result.tickets,
      eventTitle: result.eventTitle,
      subtotalAmount: result.subtotalAmount,
      discountAmount: result.discountAmount,
      totalAmount: result.totalAmount,
    };
  }

  return {
    duplicate: false,
    booking: result.booking,
    tickets: result.tickets,
    eventTitle: result.eventTitle,
    subtotalAmount: result.subtotalAmount,
    discountAmount: result.discountAmount,
    totalAmount: result.totalAmount,
  };
}
