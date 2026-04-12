/** Default cancellation / refund policy (override via env). */
export const CANCEL_MIN_HOURS_BEFORE_EVENT = Number(process.env.EWE_CANCEL_DEADLINE_HOURS || 10);
export const EARLY_CANCEL_HOURS_FROM_BOOKING = Number(process.env.EWE_EARLY_CANCEL_HOURS || 5);
export const MIN_FEE_PERCENT = Number(process.env.EWE_CANCEL_MIN_FEE_PCT || 2);
export const STANDARD_FEE_PERCENT = Number(process.env.EWE_CANCEL_STD_FEE_PCT || 15);
export const AUTO_APPROVE_HOURS = Number(process.env.EWE_REFUND_AUTO_APPROVE_HOURS || 24);

export function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * @param {Date} bookingCreatedAt
 * @param {Date} now
 * @param {number} totalAmount
 * @param {Date} eventDate
 * @returns {{ fee: number, net: number, policyBand: "grace" | "standard" }}
 */
export function computeCancellationAmounts(bookingCreatedAt, now, totalAmount, eventDate) {
  const start = new Date(eventDate).getTime();
  const nowMs = now.getTime();
  const msUntilEvent = start - nowMs;
  const minMs = CANCEL_MIN_HOURS_BEFORE_EVENT * 3600000;
  if (!Number.isFinite(msUntilEvent) || msUntilEvent < minMs) {
    const err = new Error(
      `Cancellations are only allowed until ${CANCEL_MIN_HOURS_BEFORE_EVENT} hours before the event starts.`
    );
    err.code = "CANCEL_WINDOW_CLOSED";
    throw err;
  }

  const hoursSinceBooking = (nowMs - new Date(bookingCreatedAt).getTime()) / 3600000;
  const pct = hoursSinceBooking <= EARLY_CANCEL_HOURS_FROM_BOOKING ? MIN_FEE_PERCENT : STANDARD_FEE_PERCENT;
  const fee = roundMoney(Math.min(totalAmount, (totalAmount * pct) / 100));
  const net = roundMoney(Math.max(0, totalAmount - fee));
  const policyBand = hoursSinceBooking <= EARLY_CANCEL_HOURS_FROM_BOOKING ? "grace" : "standard";
  return { fee, net, policyBand };
}

export function autoApproveAtFromNow(now = new Date()) {
  return new Date(now.getTime() + AUTO_APPROVE_HOURS * 3600000);
}
