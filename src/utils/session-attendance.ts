import { TeachingSession } from "@/types/teaching";

export type SessionAttendanceAction = "checkin" | "checkout" | null;

/**
 * Chooses the one action still required for a teaching session.
 *
 * The backend is the source of truth for block boundaries. Missing flags do
 * not fall back to the legacy per-session flow.
 */
export function getSessionAttendanceAction(session: TeachingSession): SessionAttendanceAction {
  if (session.status === "CANCELLED" || session.assignmentStatus !== "ASSIGNED" || session.checkoutAt) return null;
  if (session.confirmationStatus === "PENDING" || session.confirmationStatus === "REJECTED") return null;

  if (session.checkinRequired === true && !session.checkinAt) return "checkin";
  if (session.checkoutRequired === true) return "checkout";
  return null;
}

export function sessionAttendanceLabel(session: TeachingSession) {
  if (session.status === "CANCELLED") return "Buổi đã huỷ";
  if (session.checkoutAt) return "✓ Đã chấm công xong";
  if (session.assignmentStatus !== "ASSIGNED") return "Chưa được phân công";

  const action = getSessionAttendanceAction(session);
  if (action === "checkin") return "Chờ Check-in";
  if (action === "checkout") return "Chờ Check-out";
  if (session.checkinRequired && session.checkinAt) return "✓ Đã Check-in đầu block";
  return "Không cần thao tác chấm công";
}
