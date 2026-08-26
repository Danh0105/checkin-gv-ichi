// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ListResponse, TeachingSession } from "@/types/teaching";

const api = vi.hoisted(() => ({ me: vi.fn() }));

vi.mock("@/services/teacher-mini-api", () => ({
  TeacherApiError: class TeacherApiError extends Error {
    constructor(public status: number, message: string, public code: string | null = null) { super(message); }
  },
  teacherMiniApi: { sessions: { me: api.me } },
}));

import { TeacherIncomeScreen } from "@/components/teacher-mini/TeacherIncomeScreen";
import { TeacherApiError } from "@/services/teacher-mini-api";

const teachingSession = (overrides: Partial<TeachingSession> = {}): TeachingSession => ({
  id: 1,
  scheduleId: 1,
  teacherId: 45,
  teacherName: "Giáo viên không được hiển thị",
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
  attendanceNote: "Đủ giờ",
  checkedById: 8,
  checkedByName: "Nhân sự",
  checkedAt: "2026-08-11T03:00:00.000Z",
  note: null,
  className: "2A",
  periods: 1,
  ratePerPeriod: 250_000,
  amount: 250_000,
  checkoutAt: "2026-08-11T01:52:00.000Z",
  lessonName: "Phép cộng",
  lessonEvaluation: "Học sinh tiếp thu tốt",
  ...overrides,
});

const response = (data: TeachingSession[], page = 1, totalPages = 1): ListResponse<TeachingSession> => ({
  data,
  pagination: { page, limit: 100, total: data.length, totalPages },
});

const renderScreen = (initialMonth = "2026-08") => {
  const onProfileMissing = vi.fn();
  const onBackToSchedule = vi.fn();
  render(<TeacherIncomeScreen initialMonth={initialMonth} onProfileMissing={onProfileMissing} onBackToSchedule={onBackToSchedule} />);
  return { onProfileMissing, onBackToSchedule };
};

afterEach(cleanup);

beforeEach(() => {
  api.me.mockReset();
});

describe("TeacherIncomeScreen", () => {
  it("hiển thị skeleton trong lúc tải và không dựng số 0 giả", () => {
    api.me.mockImplementation(() => new Promise(() => undefined));
    renderScreen();
    expect(screen.getByLabelText("Đang tải dữ liệu thu nhập")).toBeInTheDocument();
    expect(screen.queryByText("0 ₫")).not.toBeInTheDocument();
  });

  it("hiển thị tháng có dữ liệu, tổng thu nhập, tổng tiết và amount = 0", async () => {
    api.me.mockResolvedValue(response([
      teachingSession({ id: 1, periods: 2, amount: 500_000 }),
      teachingSession({ id: 2, periods: 1, amount: 0, startTime: "10:00:00", endTime: "10:40:00" }),
      teachingSession({ id: 3, status: "SCHEDULED", periods: 3, amount: 900_000 }),
    ]));
    renderScreen();

    expect((await screen.findAllByText("500.000 ₫")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("0 ₫").length).toBeGreaterThan(0);
    expect(screen.getByText("2", { selector: ".income-stat-grid b" })).toBeInTheDocument();
    expect(screen.getByText("3", { selector: ".income-stat-grid b" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Chưa chấm công 1" }));
    expect(screen.getByText("Chờ xác nhận")).toBeInTheDocument();
    expect(screen.queryByText("Giáo viên không được hiển thị")).not.toBeInTheDocument();
  });

  it("chia đúng các buổi đã chấm công và chưa chấm công thành hai tab", async () => {
    api.me.mockResolvedValue(response([
      teachingSession({ id: 1, schoolName: "Trường đã chấm", status: "PRESENT" }),
      teachingSession({ id: 2, schoolName: "Trường chưa chấm", status: "SCHEDULED", startTime: "10:00:00" }),
    ]));
    renderScreen();

    expect(await screen.findByRole("tab", { name: "Đã chấm công 1" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/Trường đã chấm/)).toBeInTheDocument();
    expect(screen.queryByText(/Trường chưa chấm/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Chưa chấm công 1" }));
    expect(screen.getByText(/Trường chưa chấm/)).toBeInTheDocument();
    expect(screen.queryByText(/Trường đã chấm/)).not.toBeInTheDocument();
  });

  it("hiển thị rõ null và buổi chưa có đơn giá", async () => {
    api.me.mockResolvedValue(response([teachingSession({ periods: null, ratePerPeriod: null, amount: null })]));
    renderScreen();

    expect(await screen.findByText("Chưa xác định số tiết")).toBeInTheDocument();
    expect(screen.getByText("Chưa có đơn giá")).toBeInTheDocument();
    expect(screen.getByText("Chưa xác định")).toBeInTheDocument();
    expect(screen.getByText(/1 buổi đã xác nhận chưa có thành tiền/)).toBeInTheDocument();
  });

  it("mở bottom sheet với dữ liệu chấm công và bài học", async () => {
    api.me.mockResolvedValue(response([teachingSession()]));
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: "Xem chi tiết thu nhập ngày 11/08/2026" }));

    expect(screen.getByRole("dialog", { name: "Chi tiết khoản thu nhập" })).toBeInTheDocument();
    expect(screen.getByText("Đủ giờ")).toBeInTheDocument();
    expect(screen.getByText("Phép cộng")).toBeInTheDocument();
    expect(screen.getByText("Học sinh tiếp thu tốt")).toBeInTheDocument();
  });

  it("hiển thị chi phí khác và totalAmount backend trong danh sách lẫn bottom sheet", async () => {
    api.me.mockResolvedValue(response([teachingSession({
      amount: 0,
      otherCosts: [{ name: "Xăng xe", amount: 1_000_000, note: "Điểm trường xa" }],
      otherCostsTotal: 1_000_000,
      totalAmount: 1_000_000,
    })]));
    renderScreen();

    expect((await screen.findAllByText("1.000.000 ₫")).length).toBeGreaterThan(0);
    expect(screen.getByText("Gồm chi phí khác 1.000.000 ₫")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xem chi tiết thu nhập ngày 11/08/2026" }));

    const dialog = screen.getByRole("dialog", { name: "Chi tiết khoản thu nhập" });
    expect(within(dialog).getByText("Tiền tiết dạy")).toBeInTheDocument();
    expect(within(dialog).getByText("Chi phí khác")).toBeInTheDocument();
    expect(within(dialog).getByText("Xăng xe")).toBeInTheDocument();
    expect(within(dialog).getByText("Điểm trường xa")).toBeInTheDocument();
    expect(within(dialog).getByText("Tổng thu nhập")).toBeInTheDocument();
    expect(within(dialog).getAllByText("1.000.000 ₫").length).toBeGreaterThan(0);
  });

  it("hiển thị empty state và quay về lịch dạy", async () => {
    api.me.mockResolvedValue(response([]));
    const { onBackToSchedule } = renderScreen();

    fireEvent.click(await screen.findByRole("button", { name: "Về lịch dạy" }));
    expect(onBackToSchedule).toHaveBeenCalledOnce();
  });

  it("chuyển tháng trước/sau bằng đúng khoảng ngày và chặn tháng tương lai", async () => {
    api.me.mockResolvedValue(response([]));
    renderScreen("2026-08");
    await screen.findByText("Chưa có dữ liệu thu nhập trong tháng này.");

    expect(screen.getByRole("button", { name: "Tháng sau" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Tháng trước" }));
    await waitFor(() => expect(api.me).toHaveBeenLastCalledWith({ fromDate: "2026-07-01", toDate: "2026-07-31", page: 1, limit: 100 }, expect.any(AbortSignal)));
    expect(screen.getByText("Tháng 07/2026")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Tháng sau" }));
    await waitFor(() => expect(screen.getByText("Tháng 08/2026")).toBeInTheDocument());
  });

  it.each([
    [403, "Bạn không có quyền xem thông tin này"],
    [401, "Phiên đăng nhập đã hết hạn. Đang chuyển bạn về màn hình đăng nhập."],
  ])("hiển thị lỗi %s thân thiện và không lộ raw error", async (status, message) => {
    api.me.mockRejectedValue(new TeacherApiError(status as number, "raw backend salary error"));
    renderScreen();

    expect(await screen.findByText(message as string)).toBeInTheDocument();
    expect(screen.queryByText("raw backend salary error")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Thử lại" })).not.toBeInTheDocument();
  });

  it("hiển thị lỗi mạng/5xx thân thiện và thử lại thành công", async () => {
    api.me.mockRejectedValueOnce(new TeacherApiError(500, "Internal server error")).mockResolvedValueOnce(response([]));
    renderScreen();

    fireEvent.click(await screen.findByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText("Chưa có dữ liệu thu nhập trong tháng này.")).toBeInTheDocument();
    expect(api.me).toHaveBeenCalledTimes(2);
  });

  it("bỏ qua response tháng cũ sau khi người dùng đã đổi tháng", async () => {
    let resolveAugust!: (value: ListResponse<TeachingSession>) => void;
    const august = new Promise<ListResponse<TeachingSession>>((resolve) => { resolveAugust = resolve; });
    api.me.mockImplementationOnce(() => august).mockResolvedValueOnce(response([teachingSession({ id: 7, date: "2026-07-10", schoolName: "Trường tháng Bảy" })]));
    renderScreen();

    fireEvent.click(screen.getByRole("button", { name: "Tháng trước" }));
    expect(await screen.findByText(/Trường tháng Bảy/)).toBeInTheDocument();
    resolveAugust(response([teachingSession({ id: 8, schoolName: "Dữ liệu cũ tháng Tám" })]));
    await Promise.resolve();

    expect(screen.queryByText(/Dữ liệu cũ tháng Tám/)).not.toBeInTheDocument();
  });
});
