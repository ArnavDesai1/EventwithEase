import express from "express";
import mongoose from "mongoose";
import User from "../models/User.js";
import Event from "../models/Event.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

router.get("/", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("wishlistEventIds");
    const ids = (user?.wishlistEventIds || []).map((id) => String(id));
    res.json({ eventIds: ids });
  } catch (error) {
    res.status(500).json({ message: "Unable to load wishlist.", error: error.message });
  }
});

/** Merge client-stored ids (e.g. from localStorage before login) into the account wishlist. */
router.post("/sync", requireAuth, async (req, res) => {
  try {
    const raw = req.body.eventIds;
    if (!Array.isArray(raw)) {
      return res.status(400).json({ message: "eventIds must be an array." });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found." });

    const set = new Set((user.wishlistEventIds || []).map((id) => String(id)));
    for (const id of raw) {
      const sid = String(id);
      if (!isValidObjectId(sid)) continue;
      const exists = await Event.exists({ _id: sid });
      if (exists) set.add(sid);
    }

    user.wishlistEventIds = [...set].map((sid) => new mongoose.Types.ObjectId(sid));
    await user.save();
    res.json({ eventIds: [...set] });
  } catch (error) {
    res.status(500).json({ message: "Unable to sync wishlist.", error: error.message });
  }
});

router.post("/:eventId", requireAuth, async (req, res) => {
  try {
    const { eventId } = req.params;
    if (!isValidObjectId(eventId)) {
      return res.status(400).json({ message: "Invalid event id." });
    }
    const exists = await Event.exists({ _id: eventId });
    if (!exists) return res.status(404).json({ message: "Event not found." });

    await User.findByIdAndUpdate(req.user._id, { $addToSet: { wishlistEventIds: eventId } });
    const user = await User.findById(req.user._id).select("wishlistEventIds");
    res.json({ eventIds: (user.wishlistEventIds || []).map((id) => String(id)) });
  } catch (error) {
    res.status(500).json({ message: "Unable to save event.", error: error.message });
  }
});

router.delete("/:eventId", requireAuth, async (req, res) => {
  try {
    const { eventId } = req.params;
    if (!isValidObjectId(eventId)) {
      return res.status(400).json({ message: "Invalid event id." });
    }
    await User.findByIdAndUpdate(req.user._id, { $pull: { wishlistEventIds: eventId } });
    const user = await User.findById(req.user._id).select("wishlistEventIds");
    res.json({ eventIds: (user.wishlistEventIds || []).map((id) => String(id)) });
  } catch (error) {
    res.status(500).json({ message: "Unable to remove event.", error: error.message });
  }
});

export default router;
