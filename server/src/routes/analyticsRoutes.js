import express from "express";
import PageView from "../models/PageView.js";
import User from "../models/User.js";
import Event from "../models/Event.js";
import Ticket from "../models/Ticket.js";
import Booking from "../models/Booking.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import optionalAuth from "../middleware/optionalAuth.js";

const router = express.Router();

const MAX_PATH_LEN = 512;

router.post("/hit", optionalAuth, async (req, res) => {
  try {
    let path = String(req.body?.path || "").trim();
    if (!path.startsWith("/")) path = `/${path}`;
    if (path.length > MAX_PATH_LEN) path = path.slice(0, MAX_PATH_LEN);
    if (path.length < 1) {
      return res.status(400).json({ message: "path required" });
    }

    await PageView.create({
      path,
      userId: req.user?._id || null,
    });
    res.status(201).json({ ok: true });
  } catch (error) {
    res.status(500).json({ message: "Unable to record visit.", error: error.message });
  }
});

router.get("/stats", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const [users, events, tickets, bookingAgg, byDay, topPaths, byCategory] = await Promise.all([
      User.countDocuments({}),
      Event.countDocuments({}),
      Ticket.countDocuments({}),
      Booking.aggregate([
        {
          $group: {
            _id: null,
            revenue: { $sum: { $ifNull: ["$totalAmount", 0] } },
            count: { $sum: 1 },
          },
        },
      ]),
      PageView.aggregate([
        {
          $match: {
            createdAt: { $gte: new Date(Date.now() - 14 * 86400000) },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      PageView.aggregate([
        {
          $match: {
            createdAt: { $gte: new Date(Date.now() - 30 * 86400000) },
          },
        },
        { $group: { _id: "$path", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 12 },
      ]),
      Ticket.aggregate([
        {
          $lookup: {
            from: "events",
            localField: "eventId",
            foreignField: "_id",
            as: "ev",
          },
        },
        { $unwind: "$ev" },
        { $group: { _id: "$ev.category", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    const revRow = bookingAgg[0] || { revenue: 0, count: 0 };

    res.json({
      totals: {
        users,
        events,
        tickets,
        bookings: revRow.count,
        revenue: Math.round((revRow.revenue || 0) * 100) / 100,
      },
      pageviewsByDay: byDay.map((d) => ({ day: d._id, count: d.count })),
      topPaths: topPaths.map((p) => ({ path: p._id, count: p.count })),
      ticketsByCategory: byCategory.map((c) => ({ category: c._id || "—", count: c.count })),
    });
  } catch (error) {
    res.status(500).json({ message: "Unable to load stats.", error: error.message });
  }
});

export default router;
