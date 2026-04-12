import mongoose from "mongoose";

const pageViewSchema = new mongoose.Schema(
  {
    path: { type: String, required: true, maxlength: 512, trim: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

pageViewSchema.index({ createdAt: -1 });
pageViewSchema.index({ path: 1, createdAt: -1 });

export default mongoose.model("PageView", pageViewSchema);
