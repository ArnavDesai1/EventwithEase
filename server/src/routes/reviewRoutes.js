import express from "express";
import Review from "../models/Review.js";
import Booking from "../models/Booking.js";
import Event from "../models/Event.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

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

    const hasBooking = await Booking.exists({ eventId, attendeeId: req.user._id });
    if (!hasBooking) {
      return res.status(403).json({ message: "Book this event before reviewing." });
    }

    if (new Date(event.date) > new Date()) {
      return res.status(400).json({ message: "Reviews open after the event ends." });
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
