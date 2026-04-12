import mongoose from "mongoose";

const ticketSchema = new mongoose.Schema(
  {
    ticketCode: { type: String, required: true, unique: true },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    ticketTypeName: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["booked", "checked-in", "refunded"],
      default: "booked",
    },
    checkedInAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("Ticket", ticketSchema);
