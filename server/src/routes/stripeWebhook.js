import Stripe from "stripe";
import { fulfillStripeCheckoutSession } from "../services/bookingCreation.js";

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

/**
 * Raw body route — must be registered before express.json().
 */
export default async function stripeWebhookHandler(req, res) {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).send("Stripe webhook not configured.");
  }

  const sig = req.headers["stripe-signature"];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  if (stripeEvent.type === "checkout.session.completed") {
    const session = stripeEvent.data.object;
    const sessionId = typeof session === "string" ? session : session?.id;
    if (sessionId) {
      try {
        await fulfillStripeCheckoutSession(sessionId, {});
      } catch (e) {
        console.error("[stripe webhook] fulfill failed", sessionId, e.message);
      }
    }
  }

  res.json({ received: true });
}
