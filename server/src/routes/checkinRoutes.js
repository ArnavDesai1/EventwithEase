import express from "express";
import Ticket from "../models/Ticket.js";
import Event from "../models/Event.js";
import { hasRole, requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.post("/", requireAuth, requireRole("organiser", "admin"), async (req, res) => {
  try {
    const { ticketCode } = req.body;

    if (!ticketCode) {
      return res.status(400).json({ message: "Ticket code is required." });
    }

    const ticket = await Ticket.findOne({ ticketCode }).populate("eventId").populate("userId", "name email");
    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found." });
    }

    const event = await Event.findById(ticket.eventId._id);
    if (String(event.organiserId) !== String(req.user._id) && !hasRole(req.user, "admin")) {
      return res.status(403).json({ message: "You can only check in attendees for your own events." });
    }

    if (ticket.status === "refunded") {
      return res.status(400).json({ message: "This ticket was refunded and cannot be checked in.", ticket });
    }

    if (ticket.status === "checked-in") {
      return res.status(400).json({ message: "This ticket has already been checked in.", ticket });
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
