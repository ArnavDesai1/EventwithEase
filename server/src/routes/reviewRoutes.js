import express from "express";
import Review from "../models/Review.js";
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

router.get("/event/:eventId", async (req, res) => {
  try {
    const reviews = await Review.find({ eventId: req.params.eventId })
      .populate("attendeeId", "name")
      .sort({ createdAt: -1 });
    res.json(reviews);
  } catch (error) {
    res.status(500).json({ message: "Unable to fetch reviews.", error: error.message });
  }
});

router.post("/", requireAuth, async (req, res) => {
  try {
    const { eventId, rating, comment = "" } = req.body;
    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found." });

    const eligible = await hasEligibleTicketForEvent(eventId, req.user._id);
    if (!eligible) {
      return res.status(403).json({ message: "You need a ticket for this event to leave a public review." });
    }

    if (new Date(event.date) > new Date()) {
      return res.status(400).json({ message: "Reviews open after the event start time." });
    }

    const existing = await Review.findOne({ eventId, attendeeId: req.user._id });
    if (existing) {
      existing.rating = rating;
      existing.comment = comment;
      await existing.save();
      return res.json(existing);
    }

    const review = await Review.create({ eventId, attendeeId: req.user._id, rating, comment });
    res.status(201).json(review);
  } catch (error) {
    res.status(500).json({ message: "Unable to submit review.", error: error.message });
  }
});

export default router;
