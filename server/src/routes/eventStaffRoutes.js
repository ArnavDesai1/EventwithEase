import express from "express";
import mongoose from "mongoose";
import EventStaff from "../models/EventStaff.js";
import Event from "../models/Event.js";
import User from "../models/User.js";
import { hasRole, requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

async function assertOwnsEvent(user, eventId) {
  const event = await Event.findById(eventId).select("organiserId");
  if (!event) return { error: { status: 404, message: "Event not found." } };
  if (hasRole(user, "admin") || String(event.organiserId) === String(user._id)) {
    return { event };
  }
  return { error: { status: 403, message: "Only the event host can manage door staff." } };
}

/** Events where the signed-in user is assigned check-in staff (for gate selection without full dashboard). */
router.get("/mine", requireAuth, async (req, res) => {
  try {
    const rows = await EventStaff.find({ userId: req.user._id })
      .populate("eventId", "title date location cancelledAt city category")
      .sort({ createdAt: -1 });
    const events = rows.map((r) => r.eventId).filter(Boolean);
    res.json(events);
  } catch (error) {
    res.status(500).json({ message: "Unable to load staff assignments.", error: error.message });
  }
});

router.get("/event/:eventId", requireAuth, requireRole("organiser", "admin"), async (req, res) => {
  try {
    const gate = await assertOwnsEvent(req.user, req.params.eventId);
    if (gate.error) return res.status(gate.error.status).json({ message: gate.error.message });

    const rows = await EventStaff.find({ eventId: req.params.eventId })
      .populate("userId", "name email")
      .populate("addedBy", "name")
      .sort({ createdAt: 1 });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Unable to load staff list.", error: error.message });
  }
});

router.post("/event/:eventId", requireAuth, requireRole("organiser", "admin"), async (req, res) => {
  try {
    const gate = await assertOwnsEvent(req.user, req.params.eventId);
    if (gate.error) return res.status(gate.error.status).json({ message: gate.error.message });

    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();
    if (!email) return res.status(400).json({ message: "Staff email is required." });

    const staffUser = await User.findOne({ email });
    if (!staffUser) {
      return res.status(404).json({ message: "No account with that email. They must sign up first." });
    }
    if (String(staffUser._id) === String(gate.event.organiserId)) {
      return res.status(400).json({ message: "The organiser already has full host access." });
    }

    try {
      const row = await EventStaff.create({
        eventId: req.params.eventId,
        userId: staffUser._id,
        role: "checkin",
        addedBy: req.user._id,
      });
      const populated = await EventStaff.findById(row._id).populate("userId", "name email");
      return res.status(201).json({ staff: populated });
    } catch (e) {
      if (e?.code === 11000) {
        return res.status(409).json({ message: "This user is already staff for this event." });
      }
      throw e;
    }
  } catch (error) {
    res.status(500).json({ message: "Unable to add staff.", error: error.message });
  }
});

router.delete("/:staffId", requireAuth, requireRole("organiser", "admin"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.staffId)) {
      return res.status(400).json({ message: "Invalid staff id." });
    }
    const row = await EventStaff.findById(req.params.staffId);
    if (!row) return res.status(404).json({ message: "Staff row not found." });

    const gate = await assertOwnsEvent(req.user, row.eventId);
    if (gate.error) return res.status(gate.error.status).json({ message: gate.error.message });

    await EventStaff.deleteOne({ _id: row._id });
    res.json({ message: "Staff removed." });
  } catch (error) {
    res.status(500).json({ message: "Unable to remove staff.", error: error.message });
  }
});

export default router;
