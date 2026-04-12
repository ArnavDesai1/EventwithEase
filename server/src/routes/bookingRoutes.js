import express from "express";
import Booking from "../models/Booking.js";
import Ticket from "../models/Ticket.js";
import Refund from "../models/Refund.js";
import Event from "../models/Event.js";
import { requireAuth } from "../middleware/auth.js";
import { bookingPostLimiter } from "../middleware/rateLimits.js";
import {
  AUTO_APPROVE_HOURS,
  autoApproveAtFromNow,
  computeCancellationAmounts,
} from "../config/cancellationPolicy.js";
import {
  createBookingFromCart,
  fulfillStripeCheckoutSession,
  decrementSoldCountsForDeletedTickets,
} from "../services/bookingCreation.js";
import { notifyWaitlistAfterTicketsReleased } from "../services/waitlistNotify.js";

const router = express.Router();

router.post("/", requireAuth, bookingPostLimiter, async (req, res) => {
  try {
    const stripeSessionId = String(req.body.stripeCheckoutSessionId || "").trim();
    if (stripeSessionId) {
      const result = await fulfillStripeCheckoutSession(stripeSessionId, { assertUserId: req.user._id });
      if (result.error) {
        return res.status(result.error.status).json({
          message: result.error.message,
          code: result.error.code,
        });
      }
      const status = result.duplicate ? 200 : 201;
      return res.status(status).json({
        booking: result.booking,
        tickets: result.tickets,
        eventTitle: result.eventTitle,
        subtotalAmount: result.subtotalAmount,
        discountAmount: result.discountAmount,
        totalAmount: result.totalAmount,
        duplicate: Boolean(result.duplicate),
      });
    }

    const { eventId, ticketTypeId, quantity, items = [], discountCode = "" } = req.body;
    const cartItems = Array.isArray(items) && items.length ? items : [{ ticketTypeId, quantity }];

    if (!eventId || !cartItems.length) {
      return res.status(400).json({ message: "Event and at least one ticket selection are required." });
    }

    const normalizedItems = cartItems
      .map((item) => ({ ticketTypeId: item.ticketTypeId, quantity: Number(item.quantity) }))
      .filter((item) => item.ticketTypeId && item.quantity > 0);

    if (!normalizedItems.length) {
      return res.status(400).json({ message: "Select at least one ticket quantity." });
    }

    const result = await createBookingFromCart({
      userId: req.user._id,
      eventId,
      normalizedItems,
      discountCode,
    });

    if (result.error) {
      return res.status(result.error.status).json({
        message: result.error.message,
        code: result.error.code,
      });
    }

    res.status(201).json({
      booking: result.booking,
      tickets: result.tickets,
      eventTitle: result.eventTitle,
      subtotalAmount: result.subtotalAmount,
      discountAmount: result.discountAmount,
      totalAmount: result.totalAmount,
    });
  } catch (error) {
    res.status(500).json({ message: "Unable to complete booking.", error: error.message });
  }
});

router.get("/mine", requireAuth, async (req, res) => {
  try {
    const tickets = await Ticket.find({ userId: req.user._id })
      .populate("eventId", "title date location category coverImage cancelledAt ticketTypes")
      .sort({ createdAt: -1 });

    res.json(tickets);
  } catch (error) {
    res.status(500).json({ message: "Unable to fetch your tickets.", error: error.message });
  }
});

/** Free bookings: delete tickets + booking. Paid: create pending refund (organiser approves). */
router.post("/:bookingId/cancel", requireAuth, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.bookingId);
    if (!booking || String(booking.attendeeId) !== String(req.user._id)) {
      return res.status(404).json({ message: "Booking not found." });
    }

    if (booking.refundStatus && booking.refundStatus !== "none") {
      return res.status(400).json({ message: "This booking already has a refund request." });
    }

    const existingRefund = await Refund.findOne({ bookingId: booking._id });
    if (existingRefund) {
      return res.status(400).json({ message: "This booking already has a refund request." });
    }

    const event = await Event.findById(booking.eventId);
    if (!event) return res.status(404).json({ message: "Event not found." });
    const now = new Date();

    const tickets = await Ticket.find({ bookingId: booking._id });
    if (!tickets.length) {
      return res.status(400).json({ message: "No tickets for this booking." });
    }
    if (tickets.some((t) => t.status === "checked-in")) {
      return res.status(400).json({ message: "Cannot cancel after check-in." });
    }
    if (tickets.some((t) => t.status === "refunded")) {
      return res.status(400).json({ message: "These tickets were already refunded." });
    }

    if (booking.totalAmount > 0) {
      let amounts;
      try {
        amounts = computeCancellationAmounts(booking.createdAt, now, booking.totalAmount, event.date);
      } catch (e) {
        if (e.code === "CANCEL_WINDOW_CLOSED") {
          return res.status(400).json({ message: e.message });
        }
        throw e;
      }

      const autoApproveAt = autoApproveAtFromNow(now);
      const refund = await Refund.create({
        eventId: booking.eventId,
        bookingId: booking._id,
        attendeeId: req.user._id,
        reason: req.body.reason || "Booking cancelled by attendee.",
        status: "pending",
        bookingTotalAmount: booking.totalAmount,
        cancellationFeeAmount: amounts.fee,
        refundNetAmount: amounts.net,
        policyBand: amounts.policyBand,
        autoApproveAt,
      });
      booking.refundStatus = "pending";
      await booking.save();
      return res.json({
        kind: "refund_requested",
        refund,
        message: `Cancellation recorded. A ${amounts.fee} fee applies (${amounts.policyBand === "grace" ? "grace window" : "standard"} tier). Net refund ${amounts.net} is scheduled to auto-approve after ${AUTO_APPROVE_HOURS} hours unless disputed by support.`,
        summary: {
          cancellationFee: amounts.fee,
          refundNet: amounts.net,
          policyBand: amounts.policyBand,
          autoApproveAt,
        },
      });
    }

    await decrementSoldCountsForDeletedTickets(event, tickets);
    const releasedNames = [...new Set(tickets.map((t) => t.ticketTypeName).filter(Boolean))];
    await Ticket.deleteMany({ bookingId: booking._id });
    await Booking.deleteOne({ _id: booking._id });
    notifyWaitlistAfterTicketsReleased(booking.eventId, { ticketTypeNames: releasedNames }).catch(() => {});
    return res.json({ kind: "deleted", message: "Booking cancelled and tickets released." });
  } catch (error) {
    res.status(500).json({ message: "Unable to cancel booking.", error: error.message });
  }
});

export default router;
