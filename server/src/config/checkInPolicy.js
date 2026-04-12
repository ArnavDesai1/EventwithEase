/** Hours before event `date` when check-in may begin (organiser gate). */
export const CHECKIN_OPENS_BEFORE_START_HOURS = Number(process.env.EWE_CHECKIN_OPEN_BEFORE_HOURS || 12);
/** Hours after event start when check-in stays open. */
export const CHECKIN_CLOSES_AFTER_START_HOURS = Number(process.env.EWE_CHECKIN_CLOSE_AFTER_HOURS || 24);

/**
 * @param {Date | string} eventDate
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function checkInWindowForEvent(eventDate) {
  const start = new Date(eventDate).getTime();
  if (Number.isNaN(start)) {
    return { ok: false, message: "Event schedule is invalid for check-in." };
  }
  const now = Date.now();
  const openAt = start - CHECKIN_OPENS_BEFORE_START_HOURS * 3600000;
  const closeAt = start + CHECKIN_CLOSES_AFTER_START_HOURS * 3600000;
  if (now < openAt) {
    return {
      ok: false,
      message: `Check-in opens ${CHECKIN_OPENS_BEFORE_START_HOURS} hours before the event starts.`,
    };
  }
  if (now > closeAt) {
    return {
      ok: false,
      message: `Check-in has closed (more than ${CHECKIN_CLOSES_AFTER_START_HOURS} hours after the event start).`,
    };
  }
  return { ok: true };
}
