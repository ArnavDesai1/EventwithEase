import express from "express";
import Stripe from "stripe";
import Event from "../models/Event.js";
import { requireAuth } from "../middleware/auth.js";
import { paymentCheckoutLimiter } from "../middleware/rateLimits.js";

const router = express.Router();
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

function computeCheckout(event, items, discountCode) {
  const now = new Date();
  const normalizedCode = String(discountCode || "").trim().toUpperCase();
  let appliedDiscount = null;

  if (normalizedCode) {
    appliedDiscount = (event.discountCodes || []).find((code) => {
      if (!code?.code) return false;
      if (code.code.toUpperCase() !== normalizedCode) return false;
      if (code.expiresAt && new Date(code.expiresAt) <= now) return false;
      return true;
    });
  }

  let subtotal = 0;
  const lineItems = [];

  for (const item of items) {
    const ticket = event.ticketTypes.id(item.ticketTypeId);
    if (!ticket) continue;

    const earlyBirdEndsAt = ticket.earlyBirdEndsAt ? new Date(ticket.earlyBirdEndsAt) : null;
    const hasEarlyBird = ticket.earlyBirdPrice !== undefined && ticket.earlyBirdPrice !== null;
    const earlyBirdPrice = Number(ticket.earlyBirdPrice);
    const isEarlyBird = hasEarlyBird && earlyBirdEndsAt && earlyBirdEndsAt > now && Number.isFinite(earlyBirdPrice);
    const price = isEarlyBird ? Math.max(0, earlyBirdPrice) : Number(ticket.price) || 0;

    subtotal += price * item.quantity;
    lineItems.push({
      name: ticket.name,
      amount: Math.round(price * 100),
      quantity: item.quantity,
    });
  }

  let discountAmount = 0;
  if (appliedDiscount) {
    if (appliedDiscount.type === "percent") {
      discountAmount = Math.min(subtotal, (subtotal * (Number(appliedDiscount.value) || 0)) / 100);
    } else {
      discountAmount = Math.min(subtotal, Number(appliedDiscount.value) || 0);
    }
  }

  const total = Math.max(0, subtotal - discountAmount);

  return { subtotal, discountAmount, total, lineItems, discountCode: appliedDiscount?.code || "" };
}

router.post("/stripe/checkout", requireAuth, paymentCheckoutLimiter, async (req, res) => {
  try {
    const { eventId, items = [], discountCode = "" } = req.body;
    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found." });
    if (event.cancelledAt) {
      return res.status(400).json({ message: "This event has been cancelled. Checkout is closed." });
    }

    const normalizedItems = items
      .map((item) => ({ ticketTypeId: item.ticketTypeId, quantity: Number(item.quantity) }))
      .filter((item) => item.ticketTypeId && item.quantity > 0);

    if (!normalizedItems.length) {
      return res.status(400).json({ message: "Select at least one ticket." });
    }

    const summary = computeCheckout(event, normalizedItems, discountCode);

    if (!stripe) {
      return res.json({
        mode: "sandbox",
        message: "Stripe is not configured. Using sandbox payment simulation.",
        summary,
      });
    }

    const clientBase = process.env.CLIENT_URL || "http://localhost:5173";
    const cartMeta = JSON.stringify(
      normalizedItems.map((item) => [String(item.ticketTypeId), item.quantity])
    );
    if (cartMeta.length > 450) {
      return res.status(400).json({
        message: "Cart is too large for secure Stripe metadata. Split into separate bookings.",
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: summary.lineItems.map((item) => ({
        price_data: {
          currency: "inr",
          product_data: { name: item.name },
          unit_amount: item.amount,
        },
        quantity: item.quantity,
      })),
      success_url: `${clientBase}?stripeSuccess=1&session_id={CHECKOUT_SESSION_ID}&eventId=${eventId}`,
      cancel_url: `${clientBase}?stripeCancel=1&eventId=${eventId}`,
      metadata: {
        eventId: String(eventId),
        discountCode: summary.discountCode || "",
        userId: String(req.user._id),
        cart: cartMeta,
      },
    });

    res.json({ mode: "stripe", checkoutUrl: session.url, summary });
  } catch (error) {
    res.status(500).json({ message: "Unable to start Stripe checkout.", error: error.message });
  }
});

router.post("/razorpay/order", requireAuth, paymentCheckoutLimiter, async (req, res) => {
  try {
    const { eventId, items = [], discountCode = "" } = req.body;
    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found." });
    if (event.cancelledAt) {
      return res.status(400).json({ message: "This event has been cancelled. Checkout is closed." });
    }

    const normalizedItems = items
      .map((item) => ({ ticketTypeId: item.ticketTypeId, quantity: Number(item.quantity) }))
      .filter((item) => item.ticketTypeId && item.quantity > 0);

    if (!normalizedItems.length) {
      return res.status(400).json({ message: "Select at least one ticket." });
    }

    const summary = computeCheckout(event, normalizedItems, discountCode);
    res.json({
      mode: "sandbox",
      message: "Razorpay sandbox simulated. Configure keys to enable live test checkout.",
      summary,
    });
  } catch (error) {
    res.status(500).json({ message: "Unable to start Razorpay checkout.", error: error.message });
  }
});

export default router;
