import express from "express";
import Ticket from "../models/Ticket.js";
import Event from "../models/Event.js";
import EventStaff from "../models/EventStaff.js";
import { hasRole, requireAuth } from "../middleware/auth.js";
import { checkInWindowForEvent } from "../config/checkInPolicy.js";
import { checkinPostLimiter } from "../middleware/rateLimits.js";

const router = express.Router();

async function requireCheckInAccess(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: "Authentication required." });
  }
  if (hasRole(req.user, "admin") || hasRole(req.user, "organiser")) {
    return next();
  }
  const ok = await EventStaff.exists({ userId: req.user._id });
  if (ok) return next();
  return res.status(403).json({ message: "Check-in is limited to hosts and assigned door staff." });
}

function normalizeTicketCode(raw) {
  const s = String(raw ?? "").trim();
  const embedded = s.match(/EWE-[A-F0-9]{8}/i);
  if (embedded) return embedded[0].toUpperCase();
  return s.replace(/\s+/g, "").toUpperCase();
}

/**
 * Shared validation for check-in and verify-only flows.
 * @returns {Promise<{ error?: { status: number, body: object }, ticket?: import("mongoose").Document, ticketEvent?: import("mongoose").Document }>}
 */
async function validateCheckInRequest(req) {
  const ticketCode = normalizeTicketCode(req.body.ticketCode);
  const eventIdRaw = req.body.eventId != null ? String(req.body.eventId).trim() : "";

  if (!ticketCode) {
    return { error: { status: 400, body: { message: "Ticket code is required.", code: "CODE_REQUIRED" } } };
  }

  const ticket = await Ticket.findOne({ ticketCode }).populate("eventId").populate("userId", "name email");
  if (!ticket) {
    return { error: { status: 404, body: { message: "Ticket not found.", code: "NOT_FOUND" } } };
  }

  const ticketEventId = String(ticket.eventId?._id || ticket.eventId);
  const ticketEvent = await Event.findById(ticketEventId);
  if (!ticketEvent) {
    return { error: { status: 404, body: { message: "Event for this ticket is missing.", code: "EVENT_MISSING" } } };
  }

  const isAdmin = hasRole(req.user, "admin");
  const isTicketHost = String(ticketEvent.organiserId) === String(req.user._id);
  const isTicketStaff = await EventStaff.exists({
    eventId: ticketEvent._id,
    userId: req.user._id,
    role: "checkin",
  });

  if (!isAdmin && !isTicketHost && !isTicketStaff) {
    return {
      error: {
        status: 403,
        body: { message: "You can only check in attendees for your own events.", code: "NOT_YOUR_EVENT" },
      },
    };
  }

  if (eventIdRaw) {
    const selected = await Event.findById(eventIdRaw);
    if (!selected) {
      return { error: { status: 404, body: { message: "Selected event not found.", code: "GATE_NOT_FOUND" } } };
    }
    const isGateHost = String(selected.organiserId) === String(req.user._id);
    const isGateStaff = await EventStaff.exists({
      eventId: selected._id,
      userId: req.user._id,
      role: "checkin",
    });
    if (!isAdmin && !isGateHost && !isGateStaff) {
      return {
        error: {
          status: 403,
          body: { message: "You can only run check-in for your own events.", code: "NOT_YOUR_GATE" },
        },
      };
    }
    if (String(selected._id) !== String(ticketEvent._id)) {
      return {
        error: {
          status: 400,
          body: {
            message:
              "This ticket is not for the event you have open in the dashboard. Select the correct event under Managed events, then try again.",
            code: "WRONG_EVENT",
          },
        },
      };
    }
  } else if (!isAdmin) {
    return {
      error: {
        status: 400,
        body: {
          message: "Select which event you are checking people into (Managed events), then scan or paste the code.",
          code: "EVENT_REQUIRED",
        },
      },
    };
  }

  if (ticketEvent.cancelledAt) {
    return {
      error: {
        status: 400,
        body: { message: "This event was cancelled — tickets cannot be checked in.", code: "EVENT_CANCELLED" },
      },
    };
  }

  const window = checkInWindowForEvent(ticketEvent.date);
  if (!window.ok) {
    return { error: { status: 400, body: { message: window.message, code: "OUTSIDE_CHECKIN_WINDOW" } } };
  }

  if (ticket.status === "refunded") {
    return {
      error: { status: 400, body: { message: "This ticket was refunded and cannot be checked in.", code: "REFUNDED", ticket } },
    };
  }

  if (ticket.status === "expired") {
    return {
      error: { status: 400, body: { message: "This ticket has expired (event ended).", code: "EXPIRED", ticket } },
    };
  }

  return { ticket, ticketEvent };
}

/**
 * Organiser (or admin) checks in one ticket. Each ticket QR is unique; once status is
 * checked-in it cannot be reused. Organisers must pass eventId matching the gate they
 * selected in the dashboard so a code cannot be applied to the wrong event context.
 *
 * Body: `verifyOnly: true` returns the same validation outcome without mutating the ticket.
 */
router.post("/", requireAuth, requireCheckInAccess, checkinPostLimiter, async (req, res) => {
  try {
    const verifyOnly = Boolean(req.body.verifyOnly);
    const step = await validateCheckInRequest(req);
    if (step.error) {
      return res.status(step.error.status).json(step.error.body);
    }

    const { ticket, ticketEvent } = step;

    if (ticket.status === "checked-in") {
      return res.status(409).json({
        message: "This ticket was already scanned at entry. Each QR works once per person.",
        code: "ALREADY_CHECKED_IN",
        ticket,
        verifyOnly,
      });
    }

    if (verifyOnly) {
      return res.json({
        message: "Ticket is valid for this event — not checked in (verify only).",
        code: "VERIFIED_OK",
        verifyOnly: true,
        ticket,
        eventTitle: ticketEvent.title,
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
