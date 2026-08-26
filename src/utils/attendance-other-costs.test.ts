import { describe, expect, it } from "vitest";

import {
  attendancePayloadFromDraft,
  isAttendanceDraftDirty,
  normalizeAttendanceOtherCosts,
  parseAttendanceAmount,
} from "@/utils/attendance-other-costs";
import { TeachingSession } from "@/types/teaching";

describe("attendance other costs", () => {
  it("chuẩn hóa số có dấu phân cách thành number", () => {
    expect(parseAttendanceAmount("50.000")).toBe(50_000);
    expect(parseAttendanceAmount("1.234,50")).toBe(1_234.5);
    expect(parseAttendanceAmount("1,234.50")).toBe(1_234.5);
  });

  it("từ chối tên trống, số âm, NaN và quá 2 chữ số thập phân", () => {
    expect(() => normalizeAttendanceOtherCosts([{ name: " ", amount: 1 }])).toThrow(/tên khoản/i);
    expect(() => normalizeAttendanceOtherCosts([{ name: "Xăng xe", amount: "-1" }])).toThrow(/số tiền/i);
    expect(() => normalizeAttendanceOtherCosts([{ name: "Xăng xe", amount: "abc" }])).toThrow(/số tiền/i);
    expect(() => normalizeAttendanceOtherCosts([{ name: "Xăng xe", amount: "1,234" }])).not.toThrow();
    expect(() => normalizeAttendanceOtherCosts([{ name: "Xăng xe", amount: "1,2345" }])).toThrow(/số tiền/i);
  });

  it("payload luôn gửi otherCosts dưới dạng số và nhận biết thay đổi chi phí", () => {
    const session = {
      id: 1,
      status: "PRESENT",
      attendanceNote: null,
      otherCosts: [],
    } as unknown as TeachingSession;
    const draft = { status: "PRESENT" as const, attendanceNote: "", otherCosts: [{ name: " Xăng xe ", amount: 50_000, note: null }] };

    expect(isAttendanceDraftDirty(session, draft)).toBe(true);
    expect(attendancePayloadFromDraft(draft)).toEqual({
      status: "PRESENT",
      attendanceNote: null,
      otherCosts: [{ name: "Xăng xe", amount: 50_000, note: null }],
    });
  });
});
