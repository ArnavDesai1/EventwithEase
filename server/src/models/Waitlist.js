import mongoose from "mongoose";

const waitlistSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    /** Optional: wait for a specific ticket type; null means any ticket for the event. */
    ticketTypeId: { type: mongoose.Schema.Types.ObjectId, default: null },
    /** Last time we emailed “capacity may be open” (cooldown avoids spam). */
    lastNotifiedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

waitlistSchema.index({ eventId: 1, userId: 1, ticketTypeId: 1 }, { unique: true });

export default mongoose.model("Waitlist", waitlistSchema);
