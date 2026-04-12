import express from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import User from "../models/User.js";
import { createToken } from "../utils/token.js";
import { hasRole, requireAuth } from "../middleware/auth.js";
import { sendAppEmail } from "../utils/mailer.js";

const router = express.Router();
const oneHour = 60 * 60 * 1000;

function buildRoles(role) {
  if (role === "admin") return ["admin", "organiser", "attendee"];
  return ["attendee", "organiser"];
}

function ensureRoles(user, requestedRole = user.role) {
  const merged = new Set([...(user.roles || []), ...buildRoles(requestedRole), user.role].filter(Boolean));
  user.roles = [...merged];
  if (user.roles.includes("admin")) user.role = "admin";
  else if (user.roles.includes("organiser") && requestedRole === "organiser") user.role = "organiser";
  else if (!user.role || !user.roles.includes(user.role)) user.role = user.roles.includes("organiser") ? "organiser" : "attendee";
}

function publicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    roles: Array.isArray(user.roles) && user.roles.length ? user.roles : [user.role],
    emailVerified: user.emailVerified,
    linkedinUrl: user.linkedinUrl || "",
    networkingOptIn: Boolean(user.networkingOptIn),
    hostTagline: user.hostTagline || "",
    hostBio: user.hostBio || "",
    twitterUrl: user.twitterUrl || "",
    instagramUrl: user.instagramUrl || "",
    websiteUrl: user.websiteUrl || "",
  };
}

function createOpaqueToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function sendVerificationEmail(user) {
  user.emailVerificationToken = createOpaqueToken();
  user.emailVerificationExpires = new Date(Date.now() + oneHour);
  await user.save();

  const link = `${process.env.CLIENT_URL || "http://localhost:5173"}?verifyToken=${user.emailVerificationToken}`;
  return sendAppEmail({
    to: user.email,
    subject: "Verify your EventwithEase email",
    devLink: link,
    html: `
      <p>Hi ${user.name},</p>
      <p>Verify your email to activate your EventwithEase account.</p>
      <p><a href="${link}">Verify email</a></p>
      <p>This link expires in 1 hour.</p>
    `,
  });
}

router.post("/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email, and password are required." });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(409).json({ message: "An account with this email already exists." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const requestedRole = "organiser";
    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      role: requestedRole,
      roles: buildRoles(requestedRole),
      authProvider: "local",
      emailVerified: false,
    });

    const emailResult = await sendVerificationEmail(user);

    res.status(201).json({
      message: emailResult.sent
        ? "Account created. Check your email to verify before logging in."
        : "Account created. Verification link printed in the server terminal because SMTP is not configured.",
      needsVerification: true,
      devLink: process.env.NODE_ENV === "production" ? undefined : emailResult.devLink,
    });
  } catch (error) {
    res.status(500).json({ message: "Unable to create account.", error: error.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email?.toLowerCase() });

    if (!user || !user.password) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    if (!user.emailVerified) {
      return res.status(403).json({ message: "Please verify your email before logging in.", needsVerification: true });
    }

    ensureRoles(user);
    if (user.isModified("roles") || user.isModified("role")) await user.save();

    const token = createToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (error) {
    res.status(500).json({ message: "Unable to login.", error: error.message });
  }
});

router.post("/verify-email", async (req, res) => {
  try {
    const { token } = req.body;
    const user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ message: "Verification link is invalid or expired." });
    }

    user.emailVerified = true;
    user.emailVerificationToken = "";
    user.emailVerificationExpires = undefined;
    ensureRoles(user);
    await user.save();

    const jwtToken = createToken(user);
    res.json({ token: jwtToken, user: publicUser(user), message: "Email verified. You are signed in." });
  } catch (error) {
    res.status(500).json({ message: "Unable to verify email.", error: error.message });
  }
});

router.post("/resend-verification", async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email?.toLowerCase() });

    if (!user) {
      return res.json({ message: "If that account exists, a verification email was sent." });
    }

    if (user.emailVerified) {
      return res.json({ message: "This email is already verified." });
    }

    const emailResult = await sendVerificationEmail(user);
    res.json({
      message: emailResult.sent
        ? "Verification email sent."
        : "Verification link printed in the server terminal because SMTP is not configured.",
      devLink: process.env.NODE_ENV === "production" ? undefined : emailResult.devLink,
    });
  } catch (error) {
    res.status(500).json({ message: "Unable to resend verification email.", error: error.message });
  }
});

router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email?.toLowerCase() });

    if (!user) {
      return res.json({ message: "If that account exists, a reset email was sent." });
    }

    user.resetPasswordToken = createOpaqueToken();
    user.resetPasswordExpires = new Date(Date.now() + oneHour);
    await user.save();

    const link = `${process.env.CLIENT_URL || "http://localhost:5173"}?resetToken=${user.resetPasswordToken}`;
    const emailResult = await sendAppEmail({
      to: user.email,
      subject: "Reset your EventwithEase password",
      devLink: link,
      html: `
        <p>Hi ${user.name},</p>
        <p>Use this secure link to reset your EventwithEase password.</p>
        <p><a href="${link}">Reset password</a></p>
        <p>This link expires in 1 hour.</p>
      `,
    });

    res.json({
      message: emailResult.sent
        ? "Password reset email sent."
        : "Password reset link printed in the server terminal because SMTP is not configured.",
      devLink: process.env.NODE_ENV === "production" ? undefined : emailResult.devLink,
    });
  } catch (error) {
    res.status(500).json({ message: "Unable to start password reset.", error: error.message });
  }
});

router.post("/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!password || password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters." });
    }

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ message: "Reset link is invalid or expired." });
    }

    user.password = await bcrypt.hash(password, 10);
    user.authProvider = user.authProvider || "local";
    user.emailVerified = true;
    user.resetPasswordToken = "";
    user.resetPasswordExpires = undefined;
    ensureRoles(user);
    await user.save();

    res.json({ message: "Password updated. You can login now." });
  } catch (error) {
    res.status(500).json({ message: "Unable to reset password.", error: error.message });
  }
});

router.post("/google", async (req, res) => {
  try {
    const { credential, intent } = req.body;

    if (!credential || !process.env.GOOGLE_CLIENT_ID) {
      return res.status(400).json({ message: "Google sign-in is not configured." });
    }

    const googleResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
    const profile = await googleResponse.json();

    if (!googleResponse.ok || profile.aud !== process.env.GOOGLE_CLIENT_ID || !profile.email_verified) {
      return res.status(401).json({ message: "Invalid Google sign-in token." });
    }

    const requestedRole = "organiser";
    let user = await User.findOne({ email: profile.email.toLowerCase() });

    if (!user) {
      user = await User.create({
        name: profile.name || profile.email.split("@")[0],
        email: profile.email,
        role: requestedRole,
        roles: buildRoles(requestedRole),
        authProvider: "google",
        googleId: profile.sub,
        emailVerified: true,
      });
    } else {
      user.googleId = user.googleId || profile.sub;
      user.emailVerified = true;
      user.authProvider = user.authProvider === "local" ? "local" : "google";
      if (intent === "signup") ensureRoles(user, requestedRole);
      else ensureRoles(user);
      await user.save();
    }

    const token = createToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (error) {
    res.status(500).json({ message: "Unable to sign in with Google.", error: error.message });
  }
});


router.post("/profile", requireAuth, async (req, res) => {
  try {
    const {
      linkedinUrl = "",
      networkingOptIn = false,
      hostBio,
      hostTagline,
      twitterUrl,
      instagramUrl,
      websiteUrl,
    } = req.body;

    req.user.linkedinUrl = String(linkedinUrl || "").trim();
    req.user.networkingOptIn = Boolean(networkingOptIn);

    if (hasRole(req.user, "organiser") || hasRole(req.user, "admin")) {
      if (hostBio !== undefined) req.user.hostBio = String(hostBio || "").trim().slice(0, 4000);
      if (hostTagline !== undefined) req.user.hostTagline = String(hostTagline || "").trim().slice(0, 200);
      if (twitterUrl !== undefined) req.user.twitterUrl = String(twitterUrl || "").trim().slice(0, 500);
      if (instagramUrl !== undefined) req.user.instagramUrl = String(instagramUrl || "").trim().slice(0, 500);
      if (websiteUrl !== undefined) req.user.websiteUrl = String(websiteUrl || "").trim().slice(0, 500);
    }

    await req.user.save();

    res.json({ user: publicUser(req.user) });
  } catch (error) {
    res.status(500).json({ message: "Unable to update profile.", error: error.message });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  ensureRoles(req.user);
  if (req.user.isModified("roles") || req.user.isModified("role")) await req.user.save();
  res.json({ user: publicUser(req.user) });
});

export default router;
