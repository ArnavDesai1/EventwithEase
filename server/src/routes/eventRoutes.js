import express from "express";
import Event from "../models/Event.js";
import Ticket from "../models/Ticket.js";
import Booking from "../models/Booking.js";
import Refund from "../models/Refund.js";
import Review from "../models/Review.js";
import { hasRole, requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const { search = "", category = "", city = "" } = req.query;
    const query = {};

    if (search) {
      query.title = { $regex: search, $options: "i" };
    }

    if (category) {
      query.category = category;
    }

    if (city) {
      query.city = { $regex: city, $options: "i" };
    }

    const events = await Event.find(query).populate("organiserId", "name email").sort({ date: 1 });
    res.json(events);
  } catch (error) {
    res.status(500).json({ message: "Unable to fetch events.", error: error.message });
  }
});

router.get("/my-events", requireAuth, requireRole("organiser", "admin"), async (req, res) => {
  try {
    const events = await Event.find({ organiserId: req.user._id }).sort({ date: 1 });
    res.json(events);
  } catch (error) {
    res.status(500).json({ message: "Unable to fetch organiser events.", error: error.message });
  }
});


router.get("/:id/networking", requireAuth, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ message: "Event not found." });

    const hasBooking = await Booking.exists({ eventId: event._id, attendeeId: req.user._id });
    if (!hasBooking) return res.status(403).json({ message: "Book this event to view networking list." });

    const tickets = await Ticket.find({ eventId: event._id })
      .populate("userId", "name linkedinUrl networkingOptIn")
      .sort({ createdAt: 1 });

    const attendees = tickets
      .map((ticket) => ticket.userId)
      .filter((user, index, self) => user && self.findIndex((item) => String(item._id) == String(user._id)) === index)
      .filter((user) => user.networkingOptIn && user.linkedinUrl);

    res.json(attendees);
  } catch (error) {
    res.status(500).json({ message: "Unable to fetch networking list.", error: error.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const event = await Event.findById(req.params.id).populate("organiserId", "name email");
    if (!event) {
      return res.status(404).json({ message: "Event not found." });
    }

    res.json(event);
  } catch (error) {
    res.status(500).json({ message: "Unable to fetch event.", error: error.message });
  }
});

router.post("/", requireAuth, requireRole("organiser", "admin"), async (req, res) => {
  try {
    const { title, description, location, city = "", category, date, coverImage, ticketTypes, discountCodes = [], agenda = [], speakers = [], faq = [], venueMapUrl = "", venueType = "physical" } = req.body;

    if (!title || !description || !location || !date || !Array.isArray(ticketTypes) || !ticketTypes.length) {
      return res.status(400).json({ message: "Missing required event fields." });
    }

    const event = await Event.create({
      title,
      description,
      location,
      city: String(city || "").trim(),
      category,
      date,
      coverImage,
      organiserId: req.user._id,
      venueMapUrl,
      agenda: Array.isArray(agenda) ? agenda.filter(Boolean) : [],
      speakers: Array.isArray(speakers) ? speakers.filter(Boolean) : [],
      faq: Array.isArray(faq)
        ? faq.map((item) => ({
            question: (item.question || "").trim(),
            answer: (item.answer || "").trim(),
          })).filter((item) => item.question || item.answer)
        : [],
            discountCodes: Array.isArray(discountCodes)
        ? discountCodes
            .map((code) => ({
              code: (code.code || "").trim().toUpperCase(),
              type: code.type === "amount" ? "amount" : "percent",
              value: Number(code.value || 0),
              expiresAt: code.expiresAt ? new Date(code.expiresAt) : undefined,
            }))
            .filter((code) => code.code && Number.isFinite(code.value))
        : [],
      ticketTypes: ticketTypes.map((ticket) => ({
        name: ticket.name,
        price: Number(ticket.price),
        earlyBirdPrice: ticket.earlyBirdPrice !== "" && ticket.earlyBirdPrice !== undefined ? Number(ticket.earlyBirdPrice) : undefined,
        earlyBirdEndsAt: ticket.earlyBirdEndsAt ? new Date(ticket.earlyBirdEndsAt) : undefined,
        quantity: Number(ticket.quantity),
      })),
    });

    res.status(201).json(event);
  } catch (error) {
    res.status(500).json({ message: "Unable to create event.", error: error.message });
  }
});

router.get("/:id/dashboard", requireAuth, requireRole("organiser", "admin"), async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ message: "Event not found." });
    }

    if (String(event.organiserId) !== String(req.user._id) && !hasRole(req.user, "admin")) {
      return res.status(403).json({ message: "You can only view your own event dashboard." });
    }

    const [bookings, tickets, refunds, reviewDocs] = await Promise.all([
      Booking.find({ eventId: event._id }).populate("attendeeId", "name email"),
      Ticket.find({ eventId: event._id }).populate("userId", "name email linkedinUrl networkingOptIn"),
      Refund.find({ eventId: event._id }),
      Review.find({ eventId: event._id }).select("rating").lean(),
    ]);

    const revenue = bookings.reduce((sum, booking) => sum + booking.totalAmount, 0);
    const checkedInCount = tickets.filter((ticket) => ticket.status === "checked-in").length;
    const approvedRefunds = refunds.filter((refund) => refund.status === "approved");
    const pendingRefunds = refunds.filter((refund) => refund.status === "pending");
    const refundedAmount = approvedRefunds.reduce((sum, refund) => {
      const net = Number(refund.refundNetAmount);
      if (Number.isFinite(net) && net >= 0) return sum + net;
      const booking = bookings.find((item) => String(item._id) === String(refund.bookingId));
      return sum + (Number(booking?.refundedAmount) || booking?.totalAmount || 0);
    }, 0);
    const payoutEstimate = Math.max(0, revenue - refundedAmount);

    const ticketStatusBreakdown = {
      booked: tickets.filter((t) => t.status === "booked").length,
      checkedIn: tickets.filter((t) => t.status === "checked-in").length,
      refunded: tickets.filter((t) => t.status === "refunded").length,
      expired: tickets.filter((t) => t.status === "expired").length,
    };

    const registrationsByDayMap = new Map();
    for (const t of tickets) {
      const created = t.createdAt ? new Date(t.createdAt) : null;
      if (!created || Number.isNaN(created.getTime())) continue;
      const key = created.toISOString().slice(0, 10);
      registrationsByDayMap.set(key, (registrationsByDayMap.get(key) || 0) + 1);
    }
    const registrationsByDay = [...registrationsByDayMap.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const checkInByDayMap = new Map();
    for (const t of tickets) {
      if (t.status !== "checked-in" || !t.checkedInAt) continue;
      const at = new Date(t.checkedInAt);
      if (Number.isNaN(at.getTime())) continue;
      const key = at.toISOString().slice(0, 10);
      checkInByDayMap.set(key, (checkInByDayMap.get(key) || 0) + 1);
    }
    const checkInByDay = [...checkInByDayMap.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const registrations = tickets.length;
    const checkInRate =
      registrations > 0 ? Math.round((checkedInCount / registrations) * 1000) / 10 : null;

    let reviewAverage = null;
    let reviewCount = reviewDocs.length;
    if (reviewCount > 0) {
      reviewAverage = Math.round((reviewDocs.reduce((s, r) => s + (Number(r.rating) || 0), 0) / reviewCount) * 10) / 10;
    }

    res.json({
      event,
      stats: {
        registrations: tickets.length,
        bookings: bookings.length,
        revenue,
        checkedInCount,
        refundedAmount,
        pendingRefunds: pendingRefunds.length,
        payoutEstimate,
        checkInRate,
        reviewAverage,
        reviewCount,
      },
      analytics: {
        ticketStatusBreakdown,
        registrationsByDay,
        checkInByDay,
        checkInRate,
        reviewAverage,
        reviewCount,
      },
      attendees: tickets,
      refunds,
    });
  } catch (error) {
    res.status(500).json({ message: "Unable to load dashboard.", error: error.message });
  }
});

export default router;
