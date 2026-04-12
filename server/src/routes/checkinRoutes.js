import express from "express";
import Ticket from "../models/Ticket.js";
import Event from "../models/Event.js";
import { hasRole, requireAuth, requireRole } from "../middleware/auth.js";
import { checkInWindowForEvent } from "../config/checkInPolicy.js";

const router = express.Router();

function normalizeTicketCode(raw) {
  const s = String(raw ?? "").trim();
  const embedded = s.match(/EWE-[A-F0-9]{8}/i);
  if (embedded) return embedded[0].toUpperCase();
  return s.replace(/\s+/g, "").toUpperCase();
}

/**
 * Organiser (or admin) checks in one ticket. Each ticket QR is unique; once status is
 * checked-in it cannot be reused. Organisers must pass eventId matching the gate they
 * selected in the dashboard so a code cannot be applied to the wrong event context.
 */
router.post("/", requireAuth, requireRole("organiser", "admin"), async (req, res) => {
  try {
    const ticketCode = normalizeTicketCode(req.body.ticketCode);
    const eventIdRaw = req.body.eventId != null ? String(req.body.eventId).trim() : "";

    if (!ticketCode) {
      return res.status(400).json({ message: "Ticket code is required.", code: "CODE_REQUIRED" });
    }

    const ticket = await Ticket.findOne({ ticketCode }).populate("eventId").populate("userId", "name email");
    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found.", code: "NOT_FOUND" });
    }

    const ticketEventId = String(ticket.eventId?._id || ticket.eventId);
    const ticketEvent = await Event.findById(ticketEventId);
    if (!ticketEvent) {
      return res.status(404).json({ message: "Event for this ticket is missing.", code: "EVENT_MISSING" });
    }

    const isAdmin = hasRole(req.user, "admin");

    if (!isAdmin && String(ticketEvent.organiserId) !== String(req.user._id)) {
      return res.status(403).json({ message: "You can only check in attendees for your own events.", code: "NOT_YOUR_EVENT" });
    }

    if (eventIdRaw) {
      const selected = await Event.findById(eventIdRaw);
      if (!selected) {
        return res.status(404).json({ message: "Selected event not found.", code: "GATE_NOT_FOUND" });
      }
      if (!isAdmin && String(selected.organiserId) !== String(req.user._id)) {
        return res.status(403).json({
          message: "You can only run check-in for your own events.",
          code: "NOT_YOUR_GATE",
        });
      }
      if (String(selected._id) !== String(ticketEvent._id)) {
        return res.status(400).json({
          message:
            "This ticket is not for the event you have open in the dashboard. Select the correct event under Managed events, then try again.",
          code: "WRONG_EVENT",
        });
      }
    } else if (!isAdmin) {
      return res.status(400).json({
        message: "Select which event you are checking people into (Managed events), then scan or paste the code.",
        code: "EVENT_REQUIRED",
      });
    }

    if (ticketEvent.cancelledAt) {
      return res.status(400).json({ message: "This event was cancelled — tickets cannot be checked in.", code: "EVENT_CANCELLED" });
    }

    const window = checkInWindowForEvent(ticketEvent.date);
    if (!window.ok) {
      return res.status(400).json({ message: window.message, code: "OUTSIDE_CHECKIN_WINDOW" });
    }

    if (ticket.status === "refunded") {
      return res.status(400).json({ message: "This ticket was refunded and cannot be checked in.", code: "REFUNDED", ticket });
    }

    if (ticket.status === "expired") {
      return res.status(400).json({ message: "This ticket has expired (event ended).", code: "EXPIRED", ticket });
    }

    if (ticket.status === "checked-in") {
      return res.status(409).json({
        message: "This ticket was already scanned at entry. Each QR works once per person.",
        code: "ALREADY_CHECKED_IN",
        ticket,
      });
    }

    ticket.status = "checked-in";
    ticket.checkedInAt = new Date();
    await ticket.save();

    res.json({
      message: "Attendee checked in successfully.",
      ticket,
    });
  } catch (error) {
    res.status(500).json({ message: "Unable to check in ticket.", error: error.message });
  }
});

export default router;
