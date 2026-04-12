import express from "express";
import mongoose from "mongoose";
import Event from "../models/Event.js";
import User from "../models/User.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { notifyAttendeesEventCancelled } from "../services/transactionalEmail.js";

const router = express.Router();

const organiserBrief = "name email";

router.get("/events", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const events = await Event.find({})
      .sort({ date: -1 })
      .limit(200)
      .populate("organiserId", organiserBrief)
      .select("title date city category cancelledAt organiserId");
    res.json(events);
  } catch (error) {
    res.status(500).json({ message: "Unable to list events.", error: error.message });
  }
});

router.get("/users", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const users = await User.find({})
      .sort({ createdAt: -1 })
      .limit(150)
      .select("name email role roles emailVerified createdAt");
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: "Unable to list users.", error: error.message });
  }
});

/** Force-cancel an event (admin). Sends attendee cancellation emails when configured. */
router.post("/events/:id/cancel", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid event id." });
    }
    const event = await Event.findById(id);
    if (!event) return res.status(404).json({ message: "Event not found." });
    if (event.cancelledAt) {
      return res.json({ message: "Event was already cancelled.", event });
    }

    event.cancelledAt = new Date();
    await event.save();
    await notifyAttendeesEventCancelled(event).catch(() => {});

    res.json({ message: "Event cancelled.", event });
  } catch (error) {
    res.status(500).json({ message: "Unable to cancel event.", error: error.message });
  }
});

export default router;
