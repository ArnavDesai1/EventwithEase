import Booking from "../models/Booking.js";
import Ticket from "../models/Ticket.js";
import { notifyRefundResolved } from "./transactionalEmail.js";

/**
 * @param {import("mongoose").Document} refund
 */
export async function approveRefundDocument(refund) {
  if (refund.status !== "pending") return refund;

  refund.status = "approved";
  refund.resolvedAt = new Date();
  await refund.save();

  const booking = await Booking.findById(refund.bookingId);
  const net = Number(
    refund.refundNetAmount != null && !Number.isNaN(Number(refund.refundNetAmount))
      ? refund.refundNetAmount
      : booking?.totalAmount ?? 0
  );

  if (booking) {
    booking.refundStatus = "approved";
    booking.refundedAmount = net;
    await booking.save();
  }

  await Ticket.updateMany({ bookingId: refund.bookingId }, { status: "refunded" });
  await notifyRefundResolved(refund, "approved").catch(() => {});
  return refund;
}

/**
 * @param {import("mongoose").Document} refund
 */
export async function rejectRefundDocument(refund) {
  if (refund.status !== "pending") return refund;

  refund.status = "rejected";
  refund.resolvedAt = new Date();
  await refund.save();

  const booking = await Booking.findById(refund.bookingId);
  if (booking) {
    booking.refundStatus = "rejected";
    booking.refundedAmount = 0;
    await booking.save();
  }

  await notifyRefundResolved(refund, "rejected").catch(() => {});
  return refund;
}
