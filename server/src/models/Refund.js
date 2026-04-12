import mongoose from "mongoose";

const refundSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true },
    attendeeId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reason: { type: String, default: "" },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    resolvedAt: { type: Date },
    /** Gross booking total at time of cancel (snapshot). */
    bookingTotalAmount: { type: Number, min: 0 },
    cancellationFeeAmount: { type: Number, default: 0, min: 0 },
    refundNetAmount: { type: Number, min: 0 },
    policyBand: { type: String, default: "" },
    autoApproveAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("Refund", refundSchema);
