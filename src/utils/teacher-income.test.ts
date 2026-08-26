import { describe, expect, it, vi } from "vitest";

import { ListResponse, TeachingSession } from "@/types/teaching";
import {
  fetchTeacherIncomeMonth,
  formatIncomeDate,
  formatVnd,
  incomeDayLabel,
  monthRange,
  shiftMonth,
  summarizeTeacherIncome,
  toTeacherIncomeSession,
} from "@/utils/teacher-income";

const teachingSession = (overrides: Partial<TeachingSession> = {}): TeachingSession => ({
  id: 1,
  scheduleId: 1,
  teacherId: 45,
  teacherName: "Không được hiển thị",
  schoolId: 2,
  schoolName: "Trường TEST",
  subjectId: 3,
  subjectName: "Toán",
  schoolYear: "2026-2027",
  date: "2026-08-11",
  dayOfWeek: 3,
  dayOfWeekLabel: "Thứ Ba",
  startTime: "08:10:00",
  endTime: "08:50:00",
  status: "PRESENT",
  statusLabel: "Có dạy",
  assignmentStatus: "ASSIGNED",
  confirmationStatus: "CONFIRMED",
  confirmedAt: "2026-08-25T00:00:00.000Z",
  rejectionReason: null,
  checkinAt: "2026-08-11T01:08:00.000Z",
  declinedAt: null,
  declineReason: null,
  declinedTeacherId: null,
  declinedTeacherName: null,
  isMakeup: false,
  makeupForSessionId: null,
  attendanceNote: null,
  checkedById: 8,
  checkedByName: "Nhân sự",
  checkedAt: "2026-08-11T03:00:00.000Z",
  note: null,
  className: "2A",
  periods: 1,
  ratePerPeriod: 250_000,
  amount: 250_000,
  checkoutAt: "2026-08-11T01:52:00.000Z",
  ...overrides,
});

describe("teacher income calculations", () => {
  it("tổng hợp đúng buổi, tiết, số tiền và giữ amount = 0 là giá trị hợp lệ", () => {
    const sessions = [
      teachingSession({ id: 1, periods: 1, amount: 250_000 }),
      teachingSession({ id: 2, periods: 2, amount: 0 }),
      teachingSession({ id: 3, status: "SCHEDULED", periods: 3, amount: 900_000 }),
      teachingSession({ id: 4, status: "ABSENT", periods: 1, amount: 250_000 }),
      teachingSession({ id: 5, status: "EXCUSED", periods: 1, amount: 100_000 }),
    ].map(toTeacherIncomeSession);

    expect(summarizeTeacherIncome("2026-08", sessions)).toEqual({
      month: "2026-08",
      totalIncome: 350_000,
      payableSessions: 3,
      payablePeriods: 4,
      pendingSessions: 1,
      sessionsWithoutRate: 0,
      sessionsWithoutAmount: 0,
    });
  });

  it("không biến amount, periods hoặc ratePerPeriod null thành số 0 giả", () => {
    const sessions = [
      teachingSession({ id: 1, amount: null, periods: null, ratePerPeriod: null }),
      teachingSession({ id: 2, status: "SCHEDULED", amount: null, periods: null, ratePerPeriod: null }),
    ].map(toTeacherIncomeSession);

    expect(summarizeTeacherIncome("2026-08", sessions)).toMatchObject({
      totalIncome: 0,
      payableSessions: 1,
      payablePeriods: 0,
      pendingSessions: 1,
      sessionsWithoutRate: 2,
      sessionsWithoutAmount: 1,
    });
  });

  it("không tính buổi vắng, huỷ hoặc nghỉ có phép không có khoản backend xác nhận", () => {
    const sessions = [
      teachingSession({ id: 1, status: "ABSENT", amount: 250_000 }),
      teachingSession({ id: 2, status: "CANCELLED", amount: 250_000 }),
      teachingSession({ id: 3, status: "EXCUSED", amount: 0 }),
      teachingSession({ id: 4, status: "EXCUSED", amount: null }),
    ].map(toTeacherIncomeSession);

    expect(summarizeTeacherIncome("2026-08", sessions)).toMatchObject({ totalIncome: 0, payableSessions: 0, payablePeriods: 0 });
  });

  it("lọc bỏ toàn bộ thông tin định danh giáo viên khỏi model hiển thị", () => {
    const result = toTeacherIncomeSession(teachingSession());
    expect(result).not.toHaveProperty("teacherId");
    expect(result).not.toHaveProperty("teacherName");
    expect(JSON.stringify(result)).not.toContain("Không được hiển thị");
  });

  it("giữ chi phí khác và dùng totalAmount backend cho tổng thu nhập", () => {
    const result = toTeacherIncomeSession(teachingSession({
      amount: 0,
      otherCosts: [{ name: "Xăng xe", amount: 1_000_000, note: "Điểm trường xa" }],
      otherCostsTotal: 1_000_000,
      totalAmount: 1_000_000,
    }));

    expect(result).toMatchObject({
      amount: 0,
      otherCosts: [{ name: "Xăng xe", amount: 1_000_000, note: "Điểm trường xa" }],
      otherCostsTotal: 1_000_000,
      totalAmount: 1_000_000,
    });
    expect(summarizeTeacherIncome("2026-08", [result]).totalIncome).toBe(1_000_000);
  });
});

describe("teacher income pagination", () => {
  it("tải đủ mọi trang và không cộng trùng session.id", async () => {
    const pages: Record<number, TeachingSession[]> = {
      1: [teachingSession({ id: 1, date: "2026-08-01", amount: 100_000 })],
      2: [teachingSession({ id: 2, date: "2026-08-02", amount: 200_000 }), teachingSession({ id: 1, date: "2026-08-01", amount: 100_000 })],
      3: [teachingSession({ id: 3, date: "2026-08-03", amount: 300_000 })],
    };
    const loader = vi.fn(async ({ page = 1 }): Promise<ListResponse<TeachingSession>> => ({
      data: pages[page],
      pagination: { page, limit: 100, total: 3, totalPages: 3 },
    }));

    const sessions = await fetchTeacherIncomeMonth(loader, "2026-08");
    const summary = summarizeTeacherIncome("2026-08", sessions);

    expect(loader).toHaveBeenCalledTimes(3);
    expect(loader).toHaveBeenNthCalledWith(1, { fromDate: "2026-08-01", toDate: "2026-08-31", page: 1, limit: 100 }, undefined);
    expect(sessions.map((session) => session.id)).toEqual([3, 2, 1]);
    expect(summary.totalIncome).toBe(600_000);
    expect(summary.payableSessions).toBe(3);
  });

  it("trả danh sách rỗng hợp lệ khi tháng không có dữ liệu", async () => {
    const loader = vi.fn(async (): Promise<ListResponse<TeachingSession>> => ({ data: [], pagination: { page: 1, limit: 100, total: 0, totalPages: 0 } }));
    await expect(fetchTeacherIncomeMonth(loader, "2026-08")).resolves.toEqual([]);
  });
});

describe("teacher income formatting", () => {
  it("định dạng tiền VND và giữ số 0", () => {
    expect(formatVnd(250_000)).toBe("250.000 ₫");
    expect(formatVnd(0)).toBe("0 ₫");
  });

  it("định dạng ngày YYYY-MM-DD mà không parse UTC gây lệch ngày", () => {
    expect(formatIncomeDate("2026-08-01")).toBe("01/08/2026");
    expect(incomeDayLabel("2026-08-01")).toBe("Thứ Bảy");
  });

  it("tạo đúng khoảng tháng và chuyển qua ranh giới năm", () => {
    expect(monthRange("2026-02")).toEqual({ fromDate: "2026-02-01", toDate: "2026-02-28" });
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
});
