import express from "express";
import Booking from "../models/Booking.js";
import Event from "../models/Event.js";
import Refund from "../models/Refund.js";
import Ticket from "../models/Ticket.js";
import { hasRole, requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.post("/", requireAuth, async (req, res) => {
  try {
    const { bookingId, reason = "" } = req.body;

    const booking = await Booking.findById(bookingId);
    if (!booking || String(booking.attendeeId) != String(req.user._id)) {
      return res.status(404).json({ message: "Booking not found." });
    }

    if (booking.refundStatus && booking.refundStatus !== "none") {
      return res.status(400).json({ message: "Refund already requested for this booking." });
    }

    const event = await Event.findById(booking.eventId);
    if (!event) {
      return res.status(404).json({ message: "Event not found." });
    }

    const refund = await Refund.create({
      eventId: booking.eventId,
      bookingId: booking._id,
      attendeeId: req.user._id,
      reason,
      status: "pending",
    });

    booking.refundStatus = "pending";
    await booking.save();

    res.status(201).json({ refund });
  } catch (error) {
    res.status(500).json({ message: "Unable to request refund.", error: error.message });
  }
});

router.get("/mine", requireAuth, async (req, res) => {
  try {
    const refunds = await Refund.find({ attendeeId: req.user._id })
      .populate("eventId", "title date")
      .sort({ createdAt: -1 });
    res.json(refunds);
  } catch (error) {
    res.status(500).json({ message: "Unable to fetch refunds.", error: error.message });
  }
});

router.get("/event/:eventId", requireAuth, requireRole("organiser", "admin"), async (req, res) => {
  try {
    const event = await Event.findById(req.params.eventId);
    if (!event) return res.status(404).json({ message: "Event not found." });
    if (String(event.organiserId) !== String(req.user._id) && !hasRole(req.user, "admin")) {
      return res.status(403).json({ message: "Not allowed." });
    }

    const refunds = await Refund.find({ eventId: event._id })
      .populate("attendeeId", "name email")
      .populate("bookingId", "totalAmount")
      .sort({ createdAt: -1 });

    res.json(refunds);
  } catch (error) {
    res.status(500).json({ message: "Unable to fetch refund requests.", error: error.message });
  }
});

router.post("/:id/resolve", requireAuth, requireRole("organiser", "admin"), async (req, res) => {
  try {
    const { status } = req.body;
    const refund = await Refund.findById(req.params.id);
    if (!refund) return res.status(404).json({ message: "Refund request not found." });

    const event = await Event.findById(refund.eventId);
    if (!event) return res.status(404).json({ message: "Event not found." });
    if (String(event.organiserId) !== String(req.user._id) && !hasRole(req.user, "admin")) {
      return res.status(403).json({ message: "Not allowed." });
    }

    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ message: "Invalid refund status." });
    }

    refund.status = status;
    refund.resolvedAt = new Date();
    await refund.save();

    const booking = await Booking.findById(refund.bookingId);
    if (booking) {
      booking.refundStatus = status;
      booking.refundedAmount = status === "approved" ? booking.totalAmount : 0;
      await booking.save();
    }

    if (status === "approved") {
      await Ticket.updateMany({ bookingId: refund.bookingId }, { status: "refunded" });
    }

    res.json({ refund });
  } catch (error) {
    res.status(500).json({ message: "Unable to resolve refund.", error: error.message });
  }
});

export default router;
