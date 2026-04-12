import rateLimit from "express-rate-limit";

const window15m = 15 * 60 * 1000;
const window1m = 60 * 1000;

export const authSignupLimiter = rateLimit({
  windowMs: window15m,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many signup attempts. Try again later." },
});

export const authLoginLimiter = rateLimit({
  windowMs: window15m,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts. Try again later." },
});

export const bookingPostLimiter = rateLimit({
  windowMs: window1m,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many booking attempts. Slow down and try again shortly." },
});

export const paymentCheckoutLimiter = rateLimit({
  windowMs: window1m,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many checkout starts. Try again in a minute." },
});

export const checkinPostLimiter = rateLimit({
  windowMs: window1m,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many check-in requests. Try again shortly." },
});

export const waitlistPostLimiter = rateLimit({
  windowMs: window1m,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many waitlist updates. Try again shortly." },
});
