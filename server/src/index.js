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
import checkinRoutes from "./routes/checkinRoutes.js";
import wishlistRoutes from "./routes/wishlistRoutes.js";
import { startFeedbackInviteScheduler } from "./jobs/feedbackInvites.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
  })
);
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

app.use((req, res) => {
  res.status(404).json({ message: "Route not found." });
});

connectDatabase()
  .then(() => {
    app.listen(port, "0.0.0.0", () => {
      console.log(`EventwithEase API running on http://0.0.0.0:${port}`);
      startFeedbackInviteScheduler();
    });
  })
  .catch((error) => {
    console.error("Database connection failed", error.message);
    process.exit(1);
  });
