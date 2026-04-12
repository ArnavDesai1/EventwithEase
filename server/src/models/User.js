import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String },
    role: {
      type: String,
      enum: ["attendee", "organiser", "admin"],
      default: "attendee",
    },
    roles: {
      type: [
        {
          type: String,
          enum: ["attendee", "organiser", "admin"],
        },
      ],
      default: ["attendee"],
    },
    authProvider: {
      type: String,
      enum: ["local", "google"],
      default: "local",
    },
    googleId: { type: String, default: "" },
    emailVerified: { type: Boolean, default: false },
  linkedinUrl: { type: String, default: "" },
  networkingOptIn: { type: Boolean, default: false },
    emailVerificationToken: { type: String, default: "" },
    emailVerificationExpires: { type: Date },
    resetPasswordToken: { type: String, default: "" },
    resetPasswordExpires: { type: Date },
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);
