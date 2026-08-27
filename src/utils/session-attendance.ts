import { TeachingSession } from "@/types/teaching";

export type SessionAttendanceAction = "checkin" | "checkout" | null;

/**
 * Chooses the one action still required for a teaching session.
 *
 * Check-in is still only required on the first session in a block, but every
 * assigned session must now check out itself before lesson reporting.
 */
export function getSessionAttendanceAction(session: TeachingSession): SessionAttendanceAction {
  if (session.status === "CANCELLED" || session.assignmentStatus !== "ASSIGNED" || session.checkoutAt) return null;
  if (session.confirmationStatus === "PENDING" || session.confirmationStatus === "REJECTED") return null;

  if (session.checkinRequired === true && !session.checkinAt) return "checkin";
  return "checkout";
}

export function sessionAttendanceLabel(session: TeachingSession) {
  if (session.status === "CANCELLED") return "Buổi đã huỷ";
  if (session.checkoutAt) return "✓ Đã chấm công xong";
  if (session.assignmentStatus !== "ASSIGNED") return "Chưa được phân công";

  const action = getSessionAttendanceAction(session);
  if (action === "checkin") return "Chờ Check-in";
  if (action === "checkout") return "Chờ Check-out";
  return "Không cần thao tác chấm công";
}
