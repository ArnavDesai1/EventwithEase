import mongoose from "mongoose";

const feedbackSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
    attendeeId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    rating: { type: Number, min: 1, max: 5, required: true },
    feedback: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("Feedback", feedbackSchema);
