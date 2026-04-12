import express from "express";
import mongoose from "mongoose";
import Waitlist from "../models/Waitlist.js";
import Event from "../models/Event.js";
import { hasRole, requireAuth, requireRole } from "../middleware/auth.js";
import { waitlistPostLimiter } from "../middleware/rateLimits.js";
import { waitlistPositionForEntry } from "../services/waitlistNotify.js";

const router = express.Router();

router.post("/", requireAuth, waitlistPostLimiter, async (req, res) => {
  try {
    const { eventId, ticketTypeId = null } = req.body;
    if (!eventId) {
      return res.status(400).json({ message: "eventId is required." });
    }

    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found." });
    if (event.cancelledAt) {
      return res.status(400).json({ message: "This event is cancelled — waitlist is closed." });
    }

    let typeOid = null;
    if (ticketTypeId) {
      typeOid = new mongoose.Types.ObjectId(String(ticketTypeId));
      const tt = event.ticketTypes.id(typeOid);
      if (!tt) return res.status(404).json({ message: "Ticket type not found." });
    }

    try {
      const entry = await Waitlist.create({
        eventId,
        userId: req.user._id,
        ticketTypeId: typeOid,
      });
      return res.status(201).json({ entry, message: "You are on the waitlist. We will email if spots open." });
    } catch (e) {
      if (e?.code === 11000) {
        return res.status(409).json({ message: "You are already on the waitlist for this selection." });
      }
      throw e;
    }
  } catch (error) {
    res.status(500).json({ message: "Unable to join waitlist.", error: error.message });
  }
});

router.delete("/:eventId", requireAuth, waitlistPostLimiter, async (req, res) => {
  try {
    const { eventId } = req.params;
    const ticketTypeId = req.query.ticketTypeId ? String(req.query.ticketTypeId) : null;
    const base = { eventId, userId: req.user._id };

    if (ticketTypeId) {
      const result = await Waitlist.deleteOne({
        ...base,
        ticketTypeId: new mongoose.Types.ObjectId(ticketTypeId),
      });
      if (!result.deletedCount) {
        return res.status(404).json({ message: "Waitlist entry not found." });
      }
    } else {
      const result = await Waitlist.deleteMany(base);
      if (!result.deletedCount) {
        return res.status(404).json({ message: "Waitlist entry not found." });
      }
    }

    res.json({ message: "Removed from waitlist." });
  } catch (error) {
    res.status(500).json({ message: "Unable to leave waitlist.", error: error.message });
  }
});

router.get("/mine", requireAuth, async (req, res) => {
  try {
    const rows = await Waitlist.find({ userId: req.user._id })
      .populate("eventId", "title date location cancelledAt ticketTypes")
      .sort({ createdAt: -1 });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Unable to load waitlist.", error: error.message });
  }
});

router.get("/event/:eventId", requireAuth, requireRole("organiser", "admin"), async (req, res) => {
  try {
    const event = await Event.findById(req.params.eventId);
    if (!event) return res.status(404).json({ message: "Event not found." });

    const isAdmin = hasRole(req.user, "admin");
    if (!isAdmin && String(event.organiserId) !== String(req.user._id)) {
      return res.status(403).json({ message: "You can only view waitlists for your own events." });
    }

    const rows = await Waitlist.find({ eventId: req.params.eventId })
      .populate("userId", "name email")
      .sort({ createdAt: 1 });
    const withPosition = [];
    for (const row of rows) {
      const plain = row.toObject();
      plain.position = await waitlistPositionForEntry(row);
      withPosition.push(plain);
    }
    res.json(withPosition);
  } catch (error) {
    res.status(500).json({ message: "Unable to load event waitlist.", error: error.message });
  }
});

export default router;
