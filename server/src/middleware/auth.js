import jwt from "jsonwebtoken";
import User from "../models/User.js";

export function getUserRoles(user) {
  if (!user) return [];
  if (Array.isArray(user.roles) && user.roles.length) {
    return [...new Set(user.roles)];
  }
  return user.role ? [user.role] : [];
}

export function hasRole(user, ...roles) {
  const effectiveRoles = getUserRoles(user);
  return roles.some((role) => effectiveRoles.includes(role));
}

export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;

    if (!token) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select("-password -emailVerificationToken -resetPasswordToken");

    if (!user) {
      return res.status(401).json({ message: "User not found." });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !hasRole(req.user, ...roles)) {
      return res.status(403).json({ message: "You do not have permission for this action." });
    }

    next();
  };
}
