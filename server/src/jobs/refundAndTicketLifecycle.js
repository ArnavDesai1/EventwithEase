import Event from "../models/Event.js";
import Refund from "../models/Refund.js";
import Ticket from "../models/Ticket.js";
import { AUTO_APPROVE_HOURS } from "../config/cancellationPolicy.js";
import { approveRefundDocument } from "../services/refundLifecycle.js";

const SWEEP_MS = Number(process.env.EWE_LIFECYCLE_SWEEP_MS || 60 * 1000);

export async function runRefundAutoApproveSweep() {
  const now = new Date();
  const legacyCutoff = new Date(now.getTime() - AUTO_APPROVE_HOURS * 3600000);

  const pending = await Refund.find({
    status: "pending",
    $or: [{ autoApproveAt: { $lte: now } }, { autoApproveAt: null, createdAt: { $lte: legacyCutoff } }],
  }).limit(200);

  for (const refund of pending) {
    try {
      await approveRefundDocument(refund);
    } catch (err) {
      console.error("[lifecycle] auto-approve failed", String(refund._id), err.message);
    }
  }
}

export async function runTicketExpirySweep() {
  const now = new Date();
  const pastEventIds = await Event.find({ date: { $lt: now } }).distinct("_id");
  if (!pastEventIds.length) return;

  await Ticket.updateMany(
    { eventId: { $in: pastEventIds }, status: "booked" },
    { $set: { status: "expired" } }
  );
}

export async function runLifecycleSweep() {
  await runTicketExpirySweep();
  await runRefundAutoApproveSweep();
}

export function startRefundAndTicketLifecycleScheduler() {
  const tick = () => {
    runLifecycleSweep().catch((err) => console.error("[lifecycle]", err.message));
  };
  setTimeout(tick, 20_000);
  return setInterval(tick, SWEEP_MS);
}
