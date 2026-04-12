import mongoose from "mongoose";

const bookingSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
    attendeeId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    subtotalAmount: { type: Number, required: true, min: 0 },
    discountAmount: { type: Number, required: true, min: 0 },
    discountCode: { type: String, default: "" },
    totalAmount: { type: Number, required: true, min: 0 },
    refundStatus: { type: String, enum: ["none", "pending", "approved", "rejected"], default: "none" },
    refundedAmount: { type: Number, default: 0 },
    quantity: { type: Number, required: true, min: 1 },
    /** Omit for free / non-Stripe bookings so sparse unique index allows many rows (null would collide). */
    stripeCheckoutSessionId: { type: String, sparse: true, unique: true },
  },
  { timestamps: true }
);

export default mongoose.model("Booking", bookingSchema);
