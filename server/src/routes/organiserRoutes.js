import express from "express";
import mongoose from "mongoose";
import User from "../models/User.js";
import Event from "../models/Event.js";
import Follow from "../models/Follow.js";
import Review from "../models/Review.js";
import { hasRole, requireAuth } from "../middleware/auth.js";
import optionalAuth from "../middleware/optionalAuth.js";

const router = express.Router();

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function publicHostFields(user) {
  return {
    _id: user._id,
    name: user.name,
    hostBio: user.hostBio || "",
    hostTagline: user.hostTagline || "",
    linkedinUrl: user.linkedinUrl || "",
    twitterUrl: user.twitterUrl || "",
    instagramUrl: user.instagramUrl || "",
    websiteUrl: user.websiteUrl || "",
    createdAt: user.createdAt,
  };
}

router.get("/following", requireAuth, async (req, res) => {
  try {
    const follows = await Follow.find({ followerId: req.user._id })
      .populate("organiserId", "name")
      .sort({ createdAt: -1 });
    const list = follows
      .filter((f) => f.organiserId)
      .map((f) => ({ organiserId: String(f.organiserId._id), name: f.organiserId.name }));
    res.json(list);
  } catch (error) {
    res.status(500).json({ message: "Unable to load follows.", error: error.message });
  }
});

router.get("/:userId/profile", optionalAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isValidObjectId(userId)) {
      return res.status(400).json({ message: "Invalid profile id." });
    }

    const user = await User.findById(userId)
      .select("name role roles hostBio hostTagline linkedinUrl twitterUrl instagramUrl websiteUrl createdAt")
      .lean();
    if (!user || (!hasRole(user, "organiser") && !hasRole(user, "admin"))) {
      return res.status(404).json({ message: "Host not found." });
    }

    const [events, followerCount, following] = await Promise.all([
      Event.find({ organiserId: user._id })
        .sort({ date: 1 })
        .populate("organiserId", "name")
        .lean(),
      Follow.countDocuments({ organiserId: user._id }),
      req.user
        ? Follow.exists({ followerId: req.user._id, organiserId: user._id })
        : false,
    ]);

    const eventIds = events.map((e) => e._id);
    let trustScore = { averageRating: null, reviewCount: 0, eventsReviewed: 0 };
    let recentReviews = [];

    if (eventIds.length) {
      const [agg, reviewDocs] = await Promise.all([
        Review.aggregate([
          { $match: { eventId: { $in: eventIds } } },
          {
            $group: {
              _id: null,
              avgRating: { $avg: "$rating" },
              reviewCount: { $sum: 1 },
              eventsReviewed: { $addToSet: "$eventId" },
            },
          },
        ]),
        Review.find({ eventId: { $in: eventIds } })
          .sort({ createdAt: -1 })
          .limit(18)
          .populate("eventId", "title date")
          .populate("attendeeId", "name")
          .lean(),
      ]);

      if (agg[0]) {
        trustScore = {
          averageRating: Math.round(agg[0].avgRating * 10) / 10,
          reviewCount: agg[0].reviewCount,
          eventsReviewed: Array.isArray(agg[0].eventsReviewed) ? agg[0].eventsReviewed.length : 0,
        };
      }

      recentReviews = reviewDocs.map((r) => ({
        _id: r._id,
        rating: r.rating,
        comment: r.comment || "",
        createdAt: r.createdAt,
        eventId: r.eventId?._id,
        eventTitle: r.eventId?.title || "Event",
        attendeeName: r.attendeeId?.name || "Attendee",
      }));
    }

    const now = new Date();
    const upcomingEvents = events.filter((e) => new Date(e.date) >= now);
    const pastEvents = events.filter((e) => new Date(e.date) < now).sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({
      host: publicHostFields(user),
      events,
      upcomingEvents,
      pastEvents,
      trustScore,
      recentReviews,
      followerCount,
      following: Boolean(following),
    });
  } catch (error) {
    res.status(500).json({ message: "Unable to load host profile.", error: error.message });
  }
});

router.post("/:userId/follow", requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isValidObjectId(userId)) {
      return res.status(400).json({ message: "Invalid profile id." });
    }
    if (String(userId) === String(req.user._id)) {
      return res.status(400).json({ message: "You cannot follow yourself." });
    }

    const organiser = await User.findById(userId);
    if (!organiser || (!hasRole(organiser, "organiser") && !hasRole(organiser, "admin"))) {
      return res.status(404).json({ message: "Host not found." });
    }

    try {
      await Follow.create({ followerId: req.user._id, organiserId: organiser._id });
    } catch (e) {
      if (e.code === 11000) {
        return res.json({ following: true, followerCount: await Follow.countDocuments({ organiserId: organiser._id }) });
      }
      throw e;
    }

    const followerCount = await Follow.countDocuments({ organiserId: organiser._id });
    res.status(201).json({ following: true, followerCount });
  } catch (error) {
    res.status(500).json({ message: "Unable to follow host.", error: error.message });
  }
});

router.delete("/:userId/follow", requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isValidObjectId(userId)) {
      return res.status(400).json({ message: "Invalid profile id." });
    }

    await Follow.deleteOne({ followerId: req.user._id, organiserId: userId });
    const followerCount = await Follow.countDocuments({ organiserId: userId });
    res.json({ following: false, followerCount });
  } catch (error) {
    res.status(500).json({ message: "Unable to unfollow host.", error: error.message });
  }
});

export default router;
