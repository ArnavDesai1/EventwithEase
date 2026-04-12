import express from "express";
import Event from "../models/Event.js";
import Ticket from "../models/Ticket.js";
import Booking from "../models/Booking.js";
import Refund from "../models/Refund.js";
import { hasRole, requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const { search = "", category = "" } = req.query;
    const query = {};

    if (search) {
      query.title = { $regex: search, $options: "i" };
    }

    if (category) {
      query.category = category;
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
    const { title, description, location, category, date, coverImage, ticketTypes, discountCodes = [], agenda = [], speakers = [], faq = [], venueMapUrl = "", venueType = "physical" } = req.body;

    if (!title || !description || !location || !date || !Array.isArray(ticketTypes) || !ticketTypes.length) {
      return res.status(400).json({ message: "Missing required event fields." });
    }

    const event = await Event.create({
      title,
      description,
      location,
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

    const [bookings, tickets, refunds] = await Promise.all([
      Booking.find({ eventId: event._id }).populate("attendeeId", "name email"),
      Ticket.find({ eventId: event._id }).populate("userId", "name email linkedinUrl networkingOptIn"),
      Refund.find({ eventId: event._id }),
    ]);

    const revenue = bookings.reduce((sum, booking) => sum + booking.totalAmount, 0);
    const checkedInCount = tickets.filter((ticket) => ticket.status === "checked-in").length;
    const approvedRefunds = refunds.filter((refund) => refund.status === "approved");
    const pendingRefunds = refunds.filter((refund) => refund.status === "pending");
    const refundedAmount = approvedRefunds.reduce((sum, refund) => {
      const booking = bookings.find((item) => String(item._id) === String(refund.bookingId));
      return sum + (booking?.totalAmount || 0);
    }, 0);
    const payoutEstimate = Math.max(0, revenue - refundedAmount);

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
      },
      attendees: tickets,
      refunds,
    });
  } catch (error) {
    res.status(500).json({ message: "Unable to load dashboard.", error: error.message });
  }
});

export default router;
