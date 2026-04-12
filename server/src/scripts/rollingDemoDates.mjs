/**
 * Re-assign demo event dates relative to seed run time so upcoming events are soon,
 * past events stay in the past (for reviews / trust score demos).
 */
const DAY_MS = 86400000;

export function applyRollingDatesToDemoEvents(events) {
  const now = Date.now();
  const cloned = events.map((e) => JSON.parse(JSON.stringify(e)));
  const withOrig = cloned.map((e) => ({
    ...e,
    _t: new Date(e.date).getTime(),
  }));
  withOrig.sort((a, b) => a._t - b._t);

  const past = withOrig.filter((e) => e._t < now);
  const future = withOrig.filter((e) => e._t >= now);

  past.forEach((e, i) => {
    const span = Math.max(past.length - 1, 1);
    const daysAgo = 130 - (i / span) * 95;
    e.date = new Date(now - daysAgo * DAY_MS).toISOString();
  });

  let t = now + 1.25 * DAY_MS;
  future.forEach((e, i) => {
    e.date = new Date(t).toISOString();
    t += (1.2 + (i % 6) * 0.65) * DAY_MS;
  });

  for (const e of withOrig) {
    delete e._t;
    const evTime = new Date(e.date).getTime();
    if (Array.isArray(e.discountCodes)) {
      e.discountCodes = e.discountCodes.map((dc) => ({
        ...dc,
        expiresAt: new Date(evTime - 12 * DAY_MS).toISOString().slice(0, 10),
      }));
    }
    if (Array.isArray(e.ticketTypes)) {
      e.ticketTypes = e.ticketTypes.map((tt) => {
        if (!tt.earlyBirdEndsAt) return tt;
        return { ...tt, earlyBirdEndsAt: new Date(evTime - 8 * DAY_MS).toISOString() };
      });
    }
  }

  return withOrig;
}
