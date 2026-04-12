import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { connectDatabase } from "./config/db.js";
import authRoutes from "./routes/authRoutes.js";
import eventRoutes from "./routes/eventRoutes.js";
import bookingRoutes from "./routes/bookingRoutes.js";
import refundRoutes from "./routes/refundRoutes.js";
import reviewRoutes from "./routes/reviewRoutes.js";
import feedbackRoutes from "./routes/feedbackRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import stripeWebhookHandler from "./routes/stripeWebhook.js";
import checkinRoutes from "./routes/checkinRoutes.js";
import wishlistRoutes from "./routes/wishlistRoutes.js";
import organiserRoutes from "./routes/organiserRoutes.js";
import waitlistRoutes from "./routes/waitlistRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import analyticsRoutes from "./routes/analyticsRoutes.js";
import eventStaffRoutes from "./routes/eventStaffRoutes.js";
import { handleOgEvent, handleOgHost } from "./routes/ogHtml.js";
import { startFeedbackInviteScheduler } from "./jobs/feedbackInvites.js";
import { startRefundAndTicketLifecycleScheduler } from "./jobs/refundAndTicketLifecycle.js";
import { startCheckInReminderScheduler } from "./jobs/checkInReminders.js";
import { backfillTicketTypeSoldCounts } from "./services/bookingCreation.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
  })
);

app.get("/og/event/:id", handleOgEvent);
app.get("/og/host/:id", handleOgHost);

app.post("/api/payments/stripe/webhook", express.raw({ type: "application/json" }), stripeWebhookHandler);

app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", app: "EventwithEase API" });
});

app.use("/api/auth", authRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/refunds", refundRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/checkin", checkinRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/waitlist", waitlistRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/event-staff", eventStaffRoutes);
app.use("/api/organisers", organiserRoutes);

app.use((req, res) => {
  res.status(404).json({ message: "Route not found." });
});

connectDatabase()
  .then(async () => {
    try {
      await backfillTicketTypeSoldCounts();
    } catch (e) {
      console.warn("soldCount backfill skipped or failed:", e.message);
    }
    app.listen(port, "0.0.0.0", () => {
      console.log(`EventwithEase API running on http://0.0.0.0:${port}`);
      startFeedbackInviteScheduler();
      startRefundAndTicketLifecycleScheduler();
      startCheckInReminderScheduler();
    });
  })
  .catch((error) => {
    console.error("Database connection failed", error.message);
    process.exit(1);
  });
