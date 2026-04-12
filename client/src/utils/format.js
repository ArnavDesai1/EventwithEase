export function formatCurrency(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

export function formatDate(value) {
  return new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function effectiveTicketPrice(ticket) {
  if (!ticket) return 0;
  const basePrice = Number(ticket.price) || 0;
  const rawEarlyBird = ticket.earlyBirdPrice;
  const hasEarlyBirdPrice = rawEarlyBird !== undefined && rawEarlyBird !== null && `${rawEarlyBird}`.trim() !== "";
  const earlyBirdPrice = Number(rawEarlyBird);
  const earlyBirdEndsAt = ticket.earlyBirdEndsAt ? new Date(ticket.earlyBirdEndsAt) : null;
  const isEarlyBirdActive = hasEarlyBirdPrice && earlyBirdEndsAt && earlyBirdEndsAt > new Date();

  if (isEarlyBirdActive && Number.isFinite(earlyBirdPrice)) {
    return Math.max(0, earlyBirdPrice);
  }

  return basePrice;
}
