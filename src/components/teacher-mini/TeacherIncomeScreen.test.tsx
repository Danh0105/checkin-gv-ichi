// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ListResponse, TeachingSession } from "@/types/teaching";

const api = vi.hoisted(() => ({ me: vi.fn(), lesson: vi.fn() }));

vi.mock("@/services/teacher-mini-api", () => ({
  TeacherApiError: class TeacherApiError extends Error {
    constructor(public status: number, message: string, public code: string | null = null) { super(message); }
  },
  teacherMiniApi: { sessions: { me: api.me, lesson: api.lesson } },
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
  lessonSubmittedAt: "2026-08-11T02:05:00.000Z",
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

const renderCompanyScreen = (initialMonth = "2026-08") => {
  const onProfileMissing = vi.fn();
  const onBackToSchedule = vi.fn();
  render(<TeacherIncomeScreen initialMonth={initialMonth} onProfileMissing={onProfileMissing} onBackToSchedule={onBackToSchedule} companyTeacher />);
  return { onProfileMissing, onBackToSchedule };
};

const getSessionPlace = (name: RegExp) => screen.getByText(name, { selector: ".income-session-place strong" });
const querySessionPlace = (name: RegExp) => screen.queryByText(name, { selector: ".income-session-place strong" });

afterEach(cleanup);

beforeEach(() => {
  api.me.mockReset();
  api.lesson.mockReset();
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
    expect(screen.queryByText("Buổi được tính công")).not.toBeInTheDocument();
    expect(screen.queryByText("Buổi chờ xác nhận")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Thống kê thu nhập")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Chưa chấm công từ nhân sự 3 tiết" }));
    expect(screen.getByText("Chờ xác nhận")).toBeInTheDocument();
    expect(screen.queryByText("Giáo viên không được hiển thị")).not.toBeInTheDocument();
  });

  it("chia đúng các tiết hoàn thành và chưa chấm công từ nhân sự thành hai tab", async () => {
    api.me.mockResolvedValue(response([
      teachingSession({ id: 1, schoolName: "Trường đã chấm", status: "PRESENT" }),
      teachingSession({ id: 2, schoolName: "Trường chưa chấm", status: "SCHEDULED", startTime: "10:00:00" }),
    ]));
    renderScreen();

    expect(await screen.findByRole("tab", { name: "Hoàn thành 1 tiết" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/Trường đã chấm/)).toBeInTheDocument();
    expect(screen.queryByText(/Trường chưa chấm/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Chưa chấm công từ nhân sự 1 tiết" }));
    expect(screen.getByText(/Trường chưa chấm/)).toBeInTheDocument();
    expect(screen.queryByText(/Trường đã chấm/)).not.toBeInTheDocument();
  });

  it("cho phép bấm tab để xem chi tiết từng nhóm tiết", async () => {
    api.me.mockResolvedValue(response([
      teachingSession({ id: 1, schoolName: "Trường đã chấm", status: "PRESENT" }),
      teachingSession({ id: 2, schoolName: "Trường chưa chấm", status: "SCHEDULED", startTime: "10:00:00" }),
    ]));
    renderScreen();

    await screen.findByRole("tab", { name: "Hoàn thành 1 tiết" });
    fireEvent.click(screen.getByRole("tab", { name: "Chưa chấm công từ nhân sự 1 tiết" }));
    expect(screen.getByText("Các tiết chưa chấm công từ nhân sự")).toBeInTheDocument();
    expect(screen.getByText(/Trường chưa chấm/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Hoàn thành 1 tiết" }));
    expect(screen.getByText("Các tiết hoàn thành")).toBeInTheDocument();
    expect(screen.getByText(/Trường đã chấm/)).toBeInTheDocument();
  });

  it("xếp tiết thiếu check-in, check-out hoặc báo giảng vào nhóm chưa đủ 3 yếu tố", async () => {
    api.me.mockResolvedValue(response([
      teachingSession({ id: 1, schoolName: "Thiếu báo giảng", lessonSubmittedAt: null }),
      teachingSession({ id: 2, schoolName: "Đủ nhưng chờ nhân sự", status: "SCHEDULED", startTime: "10:00:00" }),
    ]));
    renderScreen();

    fireEvent.click(await screen.findByRole("tab", { name: "Chưa đủ 3 yếu tố 1 tiết" }));
    expect(screen.getByText("Các tiết chưa đủ 3 yếu tố để chấm công")).toBeInTheDocument();
    expect(getSessionPlace(/Thiếu báo giảng/)).toBeInTheDocument();
    expect(querySessionPlace(/Đủ nhưng chờ nhân sự/)).not.toBeInTheDocument();
  });

  it("lọc nhóm chưa đủ 3 yếu tố theo check-in, check-out và báo giảng", async () => {
    api.me.mockResolvedValue(response([
      teachingSession({ id: 1, schoolName: "Thiếu check-in", checkinAt: null }),
      teachingSession({ id: 2, schoolName: "Thiếu check-out", checkoutAt: null, startTime: "10:00:00" }),
      teachingSession({ id: 3, schoolName: "Thiếu báo giảng", lessonSubmittedAt: null, startTime: "11:00:00" }),
      teachingSession({ id: 4, schoolName: "Thiếu check-in và báo giảng", checkinAt: null, lessonSubmittedAt: null, startTime: "12:00:00" }),
    ]));
    renderScreen();

    fireEvent.click(await screen.findByRole("tab", { name: "Chưa đủ 3 yếu tố 4 tiết" }));
    expect(screen.getByRole("button", { name: "Tất cả 4 tiết" })).toHaveAttribute("aria-pressed", "true");
    expect(getSessionPlace(/^Thiếu check-in ·/)).toBeInTheDocument();
    expect(getSessionPlace(/Thiếu check-out/)).toBeInTheDocument();
    expect(getSessionPlace(/Thiếu báo giảng/)).toBeInTheDocument();
    expect(getSessionPlace(/^Thiếu check-in và báo giảng ·/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Thiếu check-in 2 tiết" }));
    expect(getSessionPlace(/^Thiếu check-in ·/)).toBeInTheDocument();
    expect(getSessionPlace(/^Thiếu check-in và báo giảng ·/)).toBeInTheDocument();
    expect(querySessionPlace(/Thiếu check-out/)).not.toBeInTheDocument();
    expect(querySessionPlace(/Thiếu báo giảng/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Thiếu check-out 1 tiết" }));
    expect(querySessionPlace(/^Thiếu check-in ·/)).not.toBeInTheDocument();
    expect(getSessionPlace(/Thiếu check-out/)).toBeInTheDocument();
    expect(querySessionPlace(/Thiếu báo giảng/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Thiếu báo giảng 1 tiết" }));
    expect(querySessionPlace(/^Thiếu check-in ·/)).not.toBeInTheDocument();
    expect(querySessionPlace(/^Thiếu check-in và báo giảng ·/)).not.toBeInTheDocument();
    expect(querySessionPlace(/Thiếu check-out/)).not.toBeInTheDocument();
    expect(getSessionPlace(/Thiếu báo giảng/)).toBeInTheDocument();
  });

  it("mở form báo giảng từ thẻ tiết thiếu báo giảng trong doanh thu", async () => {
    api.me.mockResolvedValue(response([
      teachingSession({ id: 1, schoolName: "Thiếu báo giảng", lessonSubmittedAt: null }),
    ]));
    renderScreen();

    fireEvent.click(await screen.findByRole("tab", { name: "Chưa đủ 3 yếu tố 1 tiết" }));
    fireEvent.click(screen.getByRole("button", { name: "Xem chi tiết thu nhập ngày 11/08/2026" }));
    expect(screen.getByRole("button", { name: "Báo giảng" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Báo giảng" }));
    expect(screen.getByRole("dialog", { name: "Báo giảng" })).toBeInTheDocument();
  });

  it("đánh dấu tiết liên tục là đủ check-in và check-out trong nhóm doanh thu", async () => {
    api.me.mockResolvedValue(response([
      teachingSession({
        id: 1,
        schoolName: "Tiết liền kề",
        checkinAt: null,
        checkoutAt: null,
        checkinRequired: false,
        checkoutRequired: false,
        lessonSubmittedAt: null,
      }),
    ]));
    renderScreen();

    fireEvent.click(await screen.findByRole("tab", { name: "Chưa đủ 3 yếu tố 1 tiết" }));
    expect(screen.getByRole("button", { name: "Thiếu check-in 0 tiết" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thiếu check-out 0 tiết" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thiếu báo giảng 1 tiết" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Thiếu báo giảng 1 tiết" }));
    expect(getSessionPlace(/Tiết liền kề/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xem chi tiết thu nhập ngày 11/08/2026" }));
    expect(screen.getAllByText("Đã ghi nhận theo tiết liên tục")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Báo giảng" })).toBeInTheDocument();
  });

  it("hiển thị rõ null và buổi chưa có đơn giá", async () => {
    api.me.mockResolvedValue(response([teachingSession({ periods: null, ratePerPeriod: null, amount: null })]));
    renderScreen();

    expect(await screen.findByText("Chưa xác định số tiết")).toBeInTheDocument();
    expect(screen.getByText("Chưa có đơn giá")).toBeInTheDocument();
    expect(screen.getByText("Chưa xác định")).toBeInTheDocument();
    expect(screen.getByText("Có tiết đã xác nhận chưa có thành tiền nên chưa được cộng vào tổng.")).toBeInTheDocument();
  });

  it("hiển thị thu nhập dự kiến cho tiết tương lai nếu hoàn thành", async () => {
    api.me.mockResolvedValue(response([
      teachingSession({
        id: 1,
        date: "2026-09-05",
        status: "SCHEDULED",
        statusLabel: "Chưa chấm",
        periods: 3,
        ratePerPeriod: 250_000,
        amount: null,
        totalAmount: undefined,
        checkinAt: null,
        checkoutAt: null,
        lessonSubmittedAt: null,
      }),
    ]));
    renderScreen("2026-09");

    expect(await screen.findByText("Tổng thu nhập nếu hoàn thành tháng 09/2026")).toBeInTheDocument();
    expect(screen.getAllByText("750.000 ₫").length).toBeGreaterThan(0);
    expect(screen.getByText("Dự kiến còn lại")).toBeInTheDocument();
    expect(screen.getByText("Số tiết dự kiến")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Chưa đủ 3 yếu tố 3 tiết" }));
    expect(screen.getByText("Dự kiến nếu hoàn thành")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xem chi tiết thu nhập ngày 05/09/2026" }));
    expect(screen.getByText("Dự kiến tiền tiết dạy")).toBeInTheDocument();
    expect(screen.getByText("Tổng dự kiến")).toBeInTheDocument();
  });

  it("giữ thu nhập theo tiết cho giáo viên cộng tác viên", async () => {
    api.me.mockResolvedValue(response([
      teachingSession({ id: 1, amount: null, totalAmount: undefined, periods: 2, ratePerPeriod: 120_000, status: "SCHEDULED", checkinAt: null, checkoutAt: null, lessonSubmittedAt: null }),
    ]));
    renderScreen();

    expect(await screen.findByText("Tổng thu nhập nếu hoàn thành tháng 08/2026")).toBeInTheDocument();
    expect(screen.getAllByText("240.000 ₫").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("tab", { name: "Chưa đủ 3 yếu tố 2 tiết" }));
    expect(screen.getByText("2 tiết × 120.000 ₫")).toBeInTheDocument();
  });

  it("hiển thị phụ cấp xăng cho giáo viên công ty thay vì đơn giá mỗi tiết", async () => {
    api.me.mockResolvedValue(response([
      teachingSession({ id: 1, amount: null, ratePerPeriod: null, gasAllowance: 20_000, distanceToSchoolKm: 0.01 }),
    ]));
    renderCompanyScreen();

    expect(await screen.findByText("Phụ cấp xăng tháng 08/2026")).toBeInTheDocument();
    expect(screen.getByText("Theo lần đến trường")).toBeInTheDocument();
    expect(screen.getByText("20.000 ₫ · 0,01 km")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xem chi tiết thu nhập ngày 11/08/2026" }));
    expect(screen.getAllByText("Phụ cấp xăng").length).toBeGreaterThan(0);
    expect(screen.queryByText("Đơn giá mỗi tiết")).not.toBeInTheDocument();
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

  it("chuyển tháng trước/sau bằng đúng khoảng ngày và cho phép xem tháng tương lai", async () => {
    api.me.mockResolvedValue(response([]));
    renderScreen("2026-08");
    await screen.findByText("Chưa có dữ liệu thu nhập trong tháng này.");

    expect(screen.getByRole("button", { name: "Tháng sau" })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Tháng trước" }));
    await waitFor(() => expect(api.me).toHaveBeenLastCalledWith({ fromDate: "2026-07-01", toDate: "2026-07-31", page: 1, limit: 100 }, expect.any(AbortSignal)));
    expect(screen.getByText("Tháng 07/2026")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Tháng sau" }));
    await waitFor(() => expect(screen.getByText("Tháng 08/2026")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Tháng sau" }));
    await waitFor(() => expect(api.me).toHaveBeenLastCalledWith({ fromDate: "2026-09-01", toDate: "2026-09-30", page: 1, limit: 100 }, expect.any(AbortSignal)));
    expect(screen.getByText("Tháng 09/2026")).toBeInTheDocument();
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
