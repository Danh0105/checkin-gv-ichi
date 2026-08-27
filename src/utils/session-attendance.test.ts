import { describe, expect, it } from "vitest";

import { TeachingSession } from "@/types/teaching";
import { getSessionAttendanceAction, sessionAttendanceLabel } from "@/utils/session-attendance";

const baseSession = { id: 1, assignmentStatus: "ASSIGNED", status: "SCHEDULED", confirmationStatus: "CONFIRMED", confirmedAt: null, rejectionReason: null, checkinAt: null, checkoutAt: null } as TeachingSession;

describe("getSessionAttendanceAction", () => {
  it.each([
    [{ checkinRequired: true, checkoutRequired: false, checkinAt: null }, "checkin"],
    [{ checkinRequired: true, checkoutRequired: false, checkinAt: "2026-08-25T00:30:00Z" }, "checkout"],
    [{ checkinRequired: false, checkoutRequired: false, checkinAt: null }, "checkout"],
    [{ checkinRequired: false, checkoutRequired: true, checkinAt: null }, "checkout"],
    [{ checkinRequired: true, checkoutRequired: true, checkinAt: null }, "checkin"],
    [{ checkinRequired: true, checkoutRequired: true, checkinAt: "2026-08-25T00:30:00Z" }, "checkout"],
  ])("requires every incomplete session to check out for %o", (changes, expected) => {
    expect(getSessionAttendanceAction({ ...baseSession, ...changes })).toBe(expected);
  });

  it("checks out incomplete assigned sessions even when backend block flags are absent", () => {
    expect(getSessionAttendanceAction(baseSession)).toBe("checkout");
    expect(getSessionAttendanceAction({ ...baseSession, checkinAt: "2026-08-25T00:30:00Z" })).toBe("checkout");
  });

  it.each(["PENDING", "REJECTED"] as const)("blocks attendance while confirmation is %s", (confirmationStatus) => {
    expect(getSessionAttendanceAction({ ...baseSession, confirmationStatus, checkinRequired: true, checkoutRequired: true })).toBeNull();
  });

  it("treats checkoutAt as attended even when checkinAt stays null", () => {
    const completed = { ...baseSession, checkinRequired: false, checkoutRequired: true, checkoutAt: "2026-08-25T02:00:00Z" };
    expect(getSessionAttendanceAction(completed)).toBeNull();
    expect(sessionAttendanceLabel(completed)).toBe("✓ Đã chấm công xong");
  });
});
