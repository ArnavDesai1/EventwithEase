import express from "express";
import Booking from "../models/Booking.js";
import Event from "../models/Event.js";
import Refund from "../models/Refund.js";
import Ticket from "../models/Ticket.js";
import { hasRole, requireAuth, requireRole } from "../middleware/auth.js";
import { approveRefundDocument, rejectRefundDocument } from "../services/refundLifecycle.js";
import { notifyOrganiserRefundRequested } from "../services/transactionalEmail.js";
import { autoApproveAtFromNow, computeCancellationAmounts } from "../config/cancellationPolicy.js";

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

    const bookingTickets = await Ticket.find({ bookingId: booking._id });
    if (bookingTickets.some((t) => t.status === "checked-in")) {
      return res.status(400).json({ message: "Cannot request a refund after check-in." });
    }

    const now = new Date();
    let extra = {};
    if (booking.totalAmount > 0) {
      try {
        const amounts = computeCancellationAmounts(booking.createdAt, now, booking.totalAmount, event.date);
        extra = {
          bookingTotalAmount: booking.totalAmount,
          cancellationFeeAmount: amounts.fee,
          refundNetAmount: amounts.net,
          policyBand: amounts.policyBand,
          autoApproveAt: autoApproveAtFromNow(now),
        };
      } catch (e) {
        if (e.code === "CANCEL_WINDOW_CLOSED") {
          return res.status(400).json({ message: e.message });
        }
        throw e;
      }
    } else {
      extra = {
        bookingTotalAmount: 0,
        cancellationFeeAmount: 0,
        refundNetAmount: 0,
        autoApproveAt: autoApproveAtFromNow(now),
      };
    }

    const refund = await Refund.create({
      eventId: booking.eventId,
      bookingId: booking._id,
      attendeeId: req.user._id,
      reason,
      status: "pending",
      ...extra,
    });

    booking.refundStatus = "pending";
    await booking.save();

    await notifyOrganiserRefundRequested(refund).catch(() => {});

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

/** All refund rows for events you host (for dashboard + notification polling). */
router.get("/my-events", requireAuth, requireRole("organiser", "admin"), async (req, res) => {
  try {
    const myEventIds = await Event.find({ organiserId: req.user._id }).distinct("_id");
    const refunds = await Refund.find({ eventId: { $in: myEventIds } })
      .populate("attendeeId", "name email")
      .populate("bookingId", "totalAmount")
      .populate("eventId", "title date")
      .sort({ createdAt: -1 });
    res.json(refunds);
  } catch (error) {
    res.status(500).json({ message: "Unable to fetch host refunds.", error: error.message });
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

/** Manual resolve (refunds otherwise auto-approve on a timer). Admin only. */
router.post("/:id/resolve", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { status } = req.body;
    const refund = await Refund.findById(req.params.id);
    if (!refund) return res.status(404).json({ message: "Refund request not found." });

    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ message: "Invalid refund status." });
    }

    const updated =
      status === "approved" ? await approveRefundDocument(refund) : await rejectRefundDocument(refund);
    res.json({ refund: updated });
  } catch (error) {
    res.status(500).json({ message: "Unable to resolve refund.", error: error.message });
  }
});

export default router;
