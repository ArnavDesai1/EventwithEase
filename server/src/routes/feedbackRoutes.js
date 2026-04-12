import express from "express";
import Feedback from "../models/Feedback.js";
import Ticket from "../models/Ticket.js";
import Event from "../models/Event.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

async function hasEligibleTicketForEvent(eventId, userId) {
  return Ticket.exists({
    eventId,
    userId,
    status: { $in: ["booked", "checked-in", "expired"] },
  });
}

router.post("/", requireAuth, async (req, res) => {
  try {
    const { eventId, rating, feedback = "" } = req.body;
    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found." });

    const eligible = await hasEligibleTicketForEvent(eventId, req.user._id);
    if (!eligible) {
      return res.status(403).json({ message: "You need an active ticket for this event to submit private feedback." });
    }

    if (new Date(event.date) > new Date()) {
      return res.status(400).json({ message: "Private feedback opens after the event start time." });
    }

    const existing = await Feedback.findOne({ eventId, attendeeId: req.user._id });
    if (existing) {
      existing.rating = rating;
      existing.feedback = feedback;
      await existing.save();
      return res.json(existing);
    }

    const entry = await Feedback.create({ eventId, attendeeId: req.user._id, rating, feedback });
    res.status(201).json(entry);
  } catch (error) {
    res.status(500).json({ message: "Unable to submit feedback.", error: error.message });
  }
});

router.get("/event/:eventId", requireAuth, async (req, res) => {
  try {
    const feedback = await Feedback.find({ eventId: req.params.eventId })
      .populate("attendeeId", "name email")
      .sort({ createdAt: -1 });
    res.json(feedback);
  } catch (error) {
    res.status(500).json({ message: "Unable to fetch feedback.", error: error.message });
  }
});

export default router;
