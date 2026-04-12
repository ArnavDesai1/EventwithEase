import mongoose from "mongoose";

const faqSchema = new mongoose.Schema(
  {
    question: { type: String, trim: true },
    answer: { type: String, trim: true },
  },
  { _id: false }
);

const discountCodeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    type: { type: String, enum: ["percent", "amount"], default: "percent" },
    value: { type: Number, required: true, min: 0 },
    expiresAt: { type: Date },
  },
  { _id: false }
);

const ticketTypeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    earlyBirdPrice: { type: Number, min: 0 },
    earlyBirdEndsAt: { type: Date },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: true }
);

const eventSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    location: { type: String, required: true, trim: true },
    category: { type: String, default: "General", trim: true },
    date: { type: Date, required: true },
    organiserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    discountCodes: { type: [discountCodeSchema], default: [] },
    ticketTypes: {
      type: [ticketTypeSchema],
      validate: [(value) => value.length > 0, "At least one ticket type is required."],
    },
    coverImage: { type: String, default: "" },
    venueMapUrl: { type: String, default: "" },
    agenda: { type: [String], default: [] },
    speakers: { type: [String], default: [] },
    faq: { type: [faqSchema], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model("Event", eventSchema);
