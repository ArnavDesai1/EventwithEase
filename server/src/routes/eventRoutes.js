import express from "express";
import Event from "../models/Event.js";
import Ticket from "../models/Ticket.js";
import Booking from "../models/Booking.js";
import Refund from "../models/Refund.js";
import Review from "../models/Review.js";
import { hasRole, requireAuth, requireRole } from "../middleware/auth.js";
import { notifyAttendeesEventCancelled } from "../services/transactionalEmail.js";

const router = express.Router();

const organiserListFields =
  "name email hostTagline hostBio websiteUrl twitterUrl instagramUrl linkedinUrl";

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

    const events = await Event.find(query).populate("organiserId", organiserListFields).sort({ date: 1 });
    res.json(events);
  } catch (error) {
    res.status(500).json({ message: "Unable to fetch events.", error: error.message });
  }
});

router.get("/my-events", requireAuth, requireRole("organiser", "admin"), async (req, res) => {
  try {
    const query =
      hasRole(req.user, "admin") && String(req.query.all || "") === "1" ? {} : { organiserId: req.user._id };
    const events = await Event.find(query).sort({ date: 1 }).populate("organiserId", organiserListFields);
    res.json(events);
  } catch (error) {
    res.status(500).json({ message: "Unable to fetch organiser events.", error: error.message });
  }
});

/** Host (or admin) cancels their event — notifies ticket holders when transactional email is enabled. */
router.post("/:id/cancel", requireAuth, requireRole("organiser", "admin"), async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ message: "Event not found." });
    if (String(event.organiserId) !== String(req.user._id) && !hasRole(req.user, "admin")) {
      return res.status(403).json({ message: "You can only cancel your own events." });
    }
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
      .filter(
        (user) =>
          user.networkingOptIn &&
          user.linkedinUrl &&
          (hasRole(user, "organiser") || hasRole(user, "admin"))
      );

    res.json(attendees);
  } catch (error) {
    res.status(500).json({ message: "Unable to fetch networking list.", error: error.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const event = await Event.findById(req.params.id).populate("organiserId", organiserListFields);
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
    const {
      title,
      description,
      location,
      city = "",
      category,
      date,
      coverImage,
      ticketTypes,
      discountCodes = [],
      agenda = [],
      speakers = [],
      faq = [],
      venueMapUrl = "",
      venueType = "physical",
      bookingPromo: rawPromo,
    } = req.body;

    if (!title || !description || !location || !date || !Array.isArray(ticketTypes) || !ticketTypes.length) {
      return res.status(400).json({ message: "Missing required event fields." });
    }

    let bookingPromo;
    if (rawPromo && typeof rawPromo === "object") {
      const endsRaw = rawPromo.endsAt;
      const endsAt = endsRaw ? new Date(endsRaw) : null;
      bookingPromo = {
        active: Boolean(rawPromo.active),
        headline: String(rawPromo.headline || "").trim().slice(0, 160),
        subtext: String(rawPromo.subtext || "").trim().slice(0, 400),
        badge: String(rawPromo.badge || "Limited offer").trim().slice(0, 48),
        endsAt: endsAt && !Number.isNaN(endsAt.getTime()) ? endsAt : null,
      };
      if (!bookingPromo.headline) bookingPromo.active = false;
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
      ...(bookingPromo ? { bookingPromo } : {}),
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
