import mongoose from "mongoose";

const eventStaffSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["checkin"], default: "checkin" },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

eventStaffSchema.index({ eventId: 1, userId: 1 }, { unique: true });

export default mongoose.model("EventStaff", eventStaffSchema);
