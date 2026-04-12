import jwt from "jsonwebtoken";
import User from "../models/User.js";

/** Attaches req.user when a valid Bearer token is present; otherwise continues without user. */
export default async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;
    if (!token) {
      req.user = null;
      return next();
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select("-password -emailVerificationToken -resetPasswordToken");
    req.user = user || null;
  } catch {
    req.user = null;
  }
  next();
}
