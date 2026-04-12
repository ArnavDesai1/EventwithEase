import express from "express";
import { v4 as uuidv4 } from "uuid";
import Event from "../models/Event.js";
import Booking from "../models/Booking.js";
import Ticket from "../models/Ticket.js";
import Refund from "../models/Refund.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

router.post("/", requireAuth, async (req, res) => {
  try {
    const { eventId, ticketTypeId, quantity, items = [], discountCode = "" } = req.body;
    const cartItems = Array.isArray(items) && items.length ? items : [{ ticketTypeId, quantity }];

    if (!eventId || !cartItems.length) {
      return res.status(400).json({ message: "Event and at least one ticket selection are required." });
    }

    const event = await Event.findById(eventId);
    const now = new Date();
    const normalizedCode = String(discountCode || "").trim().toUpperCase();

    if (!event) {
      return res.status(404).json({ message: "Event not found." });
    }

    let appliedDiscount = null;
    if (normalizedCode) {
      appliedDiscount = (event.discountCodes || []).find((code) => {
        if (!code?.code) return false;
        if (code.code.toUpperCase() !== normalizedCode) return false;
        if (code.expiresAt && new Date(code.expiresAt) <= now) return false;
        return true;
      });

      if (!appliedDiscount) {
        return res.status(400).json({ message: "Invalid or expired discount code." });
      }
    }

    const normalizedItems = cartItems
      .map((item) => ({ ticketTypeId: item.ticketTypeId, quantity: Number(item.quantity) }))
      .filter((item) => item.ticketTypeId && item.quantity > 0);

    if (!normalizedItems.length) {
      return res.status(400).json({ message: "Select at least one ticket quantity." });
    }

    let totalAmount = 0;
    let totalQuantity = 0;
    const ticketDocs = [];

    for (const item of normalizedItems) {
      const selectedTicket = event.ticketTypes.id(item.ticketTypeId);
      if (!selectedTicket) {
        return res.status(404).json({ message: "Ticket type not found." });
      }

      const bookedCount = await Ticket.countDocuments({
        eventId,
        ticketTypeName: selectedTicket.name,
      });

      if (bookedCount + item.quantity > selectedTicket.quantity) {
        return res.status(400).json({ message: `Not enough ${selectedTicket.name} tickets remaining.` });
      }

      const earlyBirdEndsAt = selectedTicket.earlyBirdEndsAt ? new Date(selectedTicket.earlyBirdEndsAt) : null;
      const hasEarlyBirdPrice = selectedTicket.earlyBirdPrice !== undefined && selectedTicket.earlyBirdPrice !== null;
      const earlyBirdPrice = Number(selectedTicket.earlyBirdPrice);
      const isEarlyBirdActive = hasEarlyBirdPrice && earlyBirdEndsAt && earlyBirdEndsAt > now && Number.isFinite(earlyBirdPrice);
      const effectivePrice = isEarlyBirdActive ? Math.max(0, earlyBirdPrice) : Number(selectedTicket.price) || 0;

      totalAmount += effectivePrice * item.quantity;
      totalQuantity += item.quantity;
      ticketDocs.push(

        ...Array.from({ length: item.quantity }, () => ({
          ticketCode: `EWE-${uuidv4().slice(0, 8).toUpperCase()}`,
          eventId,
          userId: req.user._id,
          ticketTypeName: selectedTicket.name,
          price: effectivePrice,
        }))
      );
    }

    const subtotalAmount = totalAmount;
    let discountAmount = 0;

    if (appliedDiscount) {
      if (appliedDiscount.type === "percent") {
        discountAmount = Math.min(subtotalAmount, (subtotalAmount * (Number(appliedDiscount.value) || 0)) / 100);
      } else {
        discountAmount = Math.min(subtotalAmount, Number(appliedDiscount.value) || 0);
      }
    }

    totalAmount = Math.max(0, subtotalAmount - discountAmount);

    const booking = await Booking.create({
      eventId,
      attendeeId: req.user._id,
      subtotalAmount,
      discountAmount,
      discountCode: appliedDiscount ? appliedDiscount.code : "",
      totalAmount,
      quantity: totalQuantity,
    });

    const tickets = await Ticket.insertMany(
      ticketDocs.map((ticket) => ({ ...ticket, bookingId: booking._id }))
    );

    res.status(201).json({ booking, tickets, eventTitle: event.title, subtotalAmount, discountAmount, totalAmount });
  } catch (error) {
    res.status(500).json({ message: "Unable to complete booking.", error: error.message });
  }
});

router.get("/mine", requireAuth, async (req, res) => {
  try {
    const tickets = await Ticket.find({ userId: req.user._id })
      .populate("eventId", "title date location category coverImage")
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
    if (new Date(event.date) <= new Date()) {
      return res.status(400).json({ message: "Cannot cancel after the event date." });
    }

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
      const refund = await Refund.create({
        eventId: booking.eventId,
        bookingId: booking._id,
        attendeeId: req.user._id,
        reason: req.body.reason || "Booking cancelled by attendee.",
        status: "pending",
      });
      booking.refundStatus = "pending";
      await booking.save();
      return res.json({
        kind: "refund_requested",
        refund,
        message: "Cancellation recorded. The organiser will process your refund.",
      });
    }

    await Ticket.deleteMany({ bookingId: booking._id });
    await Booking.deleteOne({ _id: booking._id });
    return res.json({ kind: "deleted", message: "Booking cancelled and tickets released." });
  } catch (error) {
    res.status(500).json({ message: "Unable to cancel booking.", error: error.message });
  }
});

export default router;
