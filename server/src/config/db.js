import mongoose from "mongoose";

export async function connectDatabase() {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error("MONGODB_URI is missing in the server environment.");
  }

  await mongoose.connect(mongoUri);
  console.log("MongoDB connected");
}
