// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TeachingSession } from "@/types/teaching";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  summary: vi.fn(),
  update: vi.fn(),
  bulkUpdate: vi.fn(),
}));

const locationApi = vi.hoisted(() => ({
  list: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
}));

vi.mock("@/services/teacher-mini-api", () => ({
  attendanceAdminApi: api,
  teacherMiniApi: { teacher: { locationChangeRequests: locationApi } },
  TeacherApiError: class TeacherApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

import AttendanceAdminScreen from "@/components/attendance/AttendanceAdminScreen";

const session = {
  id: 123,
  scheduleId: 1,
  teacherId: 10,
  teacherName: "Nguyễn Văn An",
  schoolId: 2,
  schoolName: "THCS KIDO",
  subjectId: 3,
  subjectName: "Toán",
  schoolYear: "2026-2027",
  date: "2026-08-12",
  dayOfWeek: 3,
  dayOfWeekLabel: "Thứ Tư",
  startTime: "08:00:00",
  endTime: "09:30:00",
  status: "PRESENT",
  statusLabel: "Có dạy",
  assignmentStatus: "ASSIGNED",
  confirmationStatus: "CONFIRMED",
  confirmedAt: "2026-08-25T00:00:00.000Z",
  rejectionReason: null,
  checkinAt: null,
  declinedAt: null,
  declineReason: null,
  declinedTeacherId: null,
  declinedTeacherName: null,
  isMakeup: false,
  makeupForSessionId: null,
  attendanceNote: null,
  checkedById: 1,
  checkedByName: "Nhân sự",
  checkedAt: "2026-08-12T10:00:00Z",
  note: null,
  amount: 300_000,
  otherCosts: [],
  otherCostsTotal: 0,
  totalAmount: 300_000,
} as TeachingSession;

const summary = {
  teachers: [{ teacherId: 10, teacherName: "Nguyễn Văn An", payableAmount: 300_000, otherCostsAmount: 0, totalPayableAmount: 300_000 }],
  grandTotal: { payableAmount: 300_000, otherCostsAmount: 0, totalPayableAmount: 300_000 },
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-08-12T02:00:00Z"));
  api.list.mockReset().mockResolvedValue({ data: [session], pagination: { page: 1, limit: 100, total: 1, totalPages: 1 } });
  api.summary.mockReset().mockResolvedValue(summary);
  api.update.mockReset().mockResolvedValue(session);
  api.bulkUpdate.mockReset().mockResolvedValue([]);
  locationApi.list.mockReset().mockResolvedValue({ data: [], pagination: { page: 1, limit: 100, total: 0, totalPages: 1 } });
  locationApi.approve.mockReset();
  locationApi.reject.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("AttendanceAdminScreen", () => {
  it("thêm nhiều khoản và gửi đúng otherCosts theo sessionId khi lưu hàng loạt", async () => {
    render(<AttendanceAdminScreen user={{ id: 1, name: "HR", roles: ["nhansu"] }} onLogout={vi.fn()} />);
    await screen.findByLabelText("Trạng thái buổi 123");

    fireEvent.click(screen.getByRole("button", { name: /Thêm khoản/ }));
    fireEvent.click(screen.getByRole("button", { name: "+ Xăng xe" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Phụ cấp" }));
    const amounts = screen.getAllByPlaceholderText("0");
    fireEvent.change(amounts[0], { target: { value: "50.000" } });
    fireEvent.change(amounts[1], { target: { value: "100,000" } });
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng" }));

    fireEvent.click(screen.getByRole("button", { name: "Lưu hàng loạt (1)" }));
    await waitFor(() => expect(api.bulkUpdate).toHaveBeenCalledOnce());
    expect(api.bulkUpdate).toHaveBeenCalledWith([{
      sessionId: 123,
      status: "PRESENT",
      attendanceNote: null,
      otherCosts: [
        { name: "Xăng xe", amount: 50_000, note: null },
        { name: "Phụ cấp", amount: 100_000, note: null },
      ],
    }]);
  });

  it("cảnh báo và xóa chi phí khỏi payload khi bỏ chấm", async () => {
    api.list.mockResolvedValue({ data: [{ ...session, otherCosts: [{ name: "Xăng xe", amount: 50_000 }], otherCostsTotal: 50_000, totalAmount: 350_000 }], pagination: { page: 1, limit: 100, total: 1, totalPages: 1 } });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AttendanceAdminScreen user={{ id: 1, name: "HR", roles: ["nhansu"] }} onLogout={vi.fn()} />);
    await screen.findByLabelText("Trạng thái buổi 123");

    fireEvent.change(screen.getByLabelText("Trạng thái buổi 123"), { target: { value: "SCHEDULED" } });
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/xóa toàn bộ chi phí khác/i));
    fireEvent.click(screen.getByRole("button", { name: "Lưu hàng loạt (1)" }));

    await waitFor(() => expect(api.bulkUpdate).toHaveBeenCalledWith([expect.objectContaining({
      sessionId: 123,
      status: "SCHEDULED",
      otherCosts: [],
    })]));
  });

  it("duyệt yêu cầu đổi vị trí đang chờ", async () => {
    locationApi.list.mockResolvedValue({ data: [{ id: 5, teacherId: 10, teacherName: "Nguyễn Văn An", latitude: 10.123456, longitude: 106.654321, status: "pending", createdAt: "2026-08-25T02:00:00.000Z" }], pagination: { page: 1, limit: 100, total: 1, totalPages: 1 } });
    locationApi.approve.mockResolvedValue({ status: "approved" });
    render(<AttendanceAdminScreen user={{ id: 1, name: "HR", roles: ["nhansu"] }} onLogout={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Yêu cầu đổi vị trí" }));
    expect(await screen.findByText("Nguyễn Văn An")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Duyệt" }));
    await waitFor(() => expect(locationApi.approve).toHaveBeenCalledWith(5));
    await waitFor(() => expect(screen.queryByText("Nguyễn Văn An")).not.toBeInTheDocument());
  });

  it("từ chối yêu cầu đổi vị trí kèm lý do", async () => {
    locationApi.list.mockResolvedValue({ data: [{ id: 5, teacherId: 10, teacherName: "Nguyễn Văn An", latitude: 10.123456, longitude: 106.654321, status: "pending", createdAt: "2026-08-25T02:00:00.000Z" }], pagination: { page: 1, limit: 100, total: 1, totalPages: 1 } });
    locationApi.reject.mockResolvedValue({ status: "rejected" });
    render(<AttendanceAdminScreen user={{ id: 1, name: "HR", roles: ["nhansu"] }} onLogout={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Yêu cầu đổi vị trí" }));
    fireEvent.click(await screen.findByRole("button", { name: "Từ chối" }));
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận từ chối" }));
    expect(screen.getByText(/ít nhất 5 ký tự/)).toBeInTheDocument();
    expect(locationApi.reject).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText("Lý do từ chối"), { target: { value: "Toạ độ không hợp lệ" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận từ chối" }));
    await waitFor(() => expect(locationApi.reject).toHaveBeenCalledWith(5, "Toạ độ không hợp lệ"));
    await waitFor(() => expect(screen.queryByText("Nguyễn Văn An")).not.toBeInTheDocument());
  });
});
