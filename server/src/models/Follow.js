import mongoose from "mongoose";

const followSchema = new mongoose.Schema(
  {
    followerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    organiserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

followSchema.index({ followerId: 1, organiserId: 1 }, { unique: true });

export default mongoose.model("Follow", followSchema);
