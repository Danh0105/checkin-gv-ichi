// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  scheduleMe: vi.fn(),
  scheduleConfirmation: vi.fn(),
  sessionMe: vi.fn(),
  sessionConfirmation: vi.fn(),
  sessionGet: vi.fn(),
}));

vi.mock("@/services/teacher-mini-api", () => ({
  TeacherApiError: class TeacherApiError extends Error { constructor(public status: number, message: string, public code: string | null = null) { super(message); } },
  teacherMiniApi: {
    schedules: { me: api.scheduleMe, confirmation: api.scheduleConfirmation },
    sessions: { me: api.sessionMe, confirmation: api.sessionConfirmation, get: api.sessionGet },
  },
}));
vi.mock("@/services/auth-session", () => ({ clearPendingDraft: vi.fn(), getPendingDraft: vi.fn(async () => null), savePendingDraft: vi.fn() }));
vi.mock("@/utils/geo", () => ({ getCurrentPosition: vi.fn(), formatDistance: vi.fn(), haversineDistance: vi.fn() }));
vi.mock("zmp-ui", () => ({ DatePicker: () => <div data-testid="date-picker" />, useSnackbar: () => ({ openSnackbar: vi.fn() }) }));

import { ConfirmationCard, ConfirmationRejectSheet, ScheduleScreen } from "@/components/teacher-mini/TeacherMiniApp";
import { TeacherApiError } from "@/services/teacher-mini-api";
import { TeachingSchedule, TeachingSession } from "@/types/teaching";

const pendingSchedule: TeachingSchedule = {
  id: 107,
  teacherId: 1,
  teacherName: "Giáo viên A",
  schoolId: 10,
  schoolName: "Trường A",
  subjectId: 20,
  subjectName: "STEM",
  schoolYear: "2026-2027",
  dayOfWeek: 3,
  dayOfWeekLabel: "Thứ Ba",
  startTime: "13:00:00",
  endTime: "13:45:00",
  effectiveFrom: "2026-08-25",
  effectiveTo: "2026-09-08",
  isActive: true,
  note: null,
  confirmationStatus: "PENDING",
  confirmedAt: null,
  rejectionReason: null,
};

const pendingSession = {
  id: 953,
  scheduleId: null,
  teacherId: 1,
  teacherName: "Giáo viên A",
  schoolId: 10,
  schoolName: "Trường A",
  subjectId: 20,
  subjectName: "STEM",
  schoolYear: "2026-2027",
  date: "2026-08-25",
  dayOfWeek: 3,
  dayOfWeekLabel: "Thứ Ba",
  startTime: "15:00:00",
  endTime: "15:45:00",
  status: "SCHEDULED",
  statusLabel: "Chưa chấm",
  assignmentStatus: "ASSIGNED",
  confirmationStatus: "PENDING",
  confirmedAt: null,
  rejectionReason: null,
  checkinAt: null,
  checkoutAt: null,
  amount: null,
  periods: 1,
  isMakeup: false,
  className: "2A",
} as unknown as TeachingSession;

describe("teaching schedule confirmation", () => {
  beforeEach(() => {
    // Ghim đồng hồ hệ thống trong tuần chứa effectiveFrom/effectiveTo của pendingSchedule (24–30/08/2026),
    // nếu không buổi "Thứ Ba 25/08" sẽ rơi vào quá khứ khi chạy test ở ngày thực tế muộn hơn.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-24T09:00:00"));
    vi.clearAllMocks();
    api.scheduleMe.mockResolvedValue({ data: [pendingSchedule], pagination: {} });
    api.sessionMe.mockResolvedValue({ data: [], pagination: {} });
    api.scheduleConfirmation.mockResolvedValue({ ...pendingSchedule, confirmationStatus: "CONFIRMED", confirmedAt: "2026-08-25T06:25:22.621Z" });
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("shows both actions only while an item is pending", () => {
    const onConfirm = vi.fn();
    const onReject = vi.fn();
    const { rerender } = render(<ConfirmationCard target={{ entityType: "schedule", item: pendingSchedule }} onConfirm={onConfirm} onReject={onReject} />);
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
    fireEvent.click(screen.getByRole("button", { name: "Từ chối" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledTimes(1);

    rerender(<ConfirmationCard target={{ entityType: "schedule", item: { ...pendingSchedule, confirmationStatus: "REJECTED", rejectionReason: "Trùng lịch công tác" } }} onConfirm={onConfirm} onReject={onReject} />);
    expect(screen.queryByRole("button", { name: "Xác nhận" })).not.toBeInTheDocument();
    expect(screen.getByText(/Trùng lịch công tác/)).toBeInTheDocument();
  });

  it("keeps the rejection form open and displays a backend 400 inline", async () => {
    const submit = vi.fn().mockRejectedValue(new TeacherApiError(400, "Lý do là bắt buộc"));
    render(<ConfirmationRejectSheet target={{ entityType: "schedule", item: pendingSchedule }} onClose={vi.fn()} onSubmit={submit} />);
    fireEvent.change(screen.getByLabelText("Lý do từ chối"), { target: { value: "Bận công tác" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận từ chối" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Lý do là bắt buộc");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("requires a meaningful rejection reason before calling the API", () => {
    const submit = vi.fn();
    render(<ConfirmationRejectSheet target={{ entityType: "schedule", item: pendingSchedule }} onClose={vi.fn()} onSubmit={submit} />);
    fireEvent.change(screen.getByLabelText("Lý do từ chối"), { target: { value: "Bận" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận từ chối" }));
    expect(screen.getByRole("alert")).toHaveTextContent("ít nhất 5 ký tự");
    expect(submit).not.toHaveBeenCalled();
  });

  it("uses the schedule endpoint then refetches sessions immediately after confirmation", async () => {
    const handled = vi.fn();
    render(<ScheduleScreen notify={vi.fn()} onProfileMissing={vi.fn()} onConfirmationHandled={handled} />);
    expect(screen.queryByRole("button", { name: "Xác nhận" })).not.toBeInTheDocument();
    const plannedLabel = await screen.findByText("Dự kiến · Bấm để xác nhận");
    const visibleRange = api.sessionMe.mock.calls[0][0];
    const visibleDate = (screen.getByLabelText("Chọn ngày") as HTMLInputElement).value;
    fireEvent.click(plannedLabel.closest("button")!);
    expect(await screen.findByRole("dialog", { name: "Xác nhận lịch dạy" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Xác nhận" }));
    await waitFor(() => expect(api.scheduleConfirmation).toHaveBeenCalledWith(107, { status: "CONFIRMED", reason: null }));
    await waitFor(() => expect(api.sessionMe).toHaveBeenCalledTimes(2));
    expect(api.sessionMe.mock.calls[1][0]).toEqual(visibleRange);
    expect(screen.getByLabelText("Chọn ngày")).toHaveValue(visibleDate);
    expect(handled).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "Xác nhận lịch dạy" })).not.toBeInTheDocument();
    expect(await screen.findByText("✓ Đã xác nhận")).toBeInTheDocument();
  });

  it("uses the standalone-session confirmation endpoint for a pending single session", async () => {
    api.scheduleMe.mockResolvedValue({ data: [], pagination: {} });
    api.sessionMe.mockResolvedValue({ data: [pendingSession], pagination: {} });
    api.sessionConfirmation.mockResolvedValue({ ...pendingSession, confirmationStatus: "CONFIRMED", confirmedAt: "2026-08-25T06:30:00.000Z" });
    render(<ScheduleScreen notify={vi.fn()} onProfileMissing={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /2A.*Giáo viên A.*STEM.*Trường A/ }));
    expect(await screen.findByRole("dialog", { name: "Xác nhận lịch dạy" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Xác nhận" }));
    await waitFor(() => expect(api.sessionConfirmation).toHaveBeenCalledWith(953, { status: "CONFIRMED", reason: null }));
    expect(screen.queryByRole("dialog", { name: "Xác nhận lịch dạy" })).not.toBeInTheDocument();
    expect(await screen.findByText("✓ Đã xác nhận")).toBeInTheDocument();
  });

  it("turns a 409 into a friendly message and reloads current confirmation state", async () => {
    const confirmed = { ...pendingSchedule, confirmationStatus: "CONFIRMED" as const, confirmedAt: "2026-08-25T06:25:22.621Z" };
    api.scheduleMe.mockResolvedValueOnce({ data: [pendingSchedule], pagination: {} }).mockResolvedValueOnce({ data: [confirmed], pagination: {} });
    api.scheduleConfirmation.mockRejectedValueOnce(new TeacherApiError(409, "Conflict"));
    const notify = vi.fn();
    render(<ScheduleScreen notify={notify} onProfileMissing={vi.fn()} />);
    const plannedLabel = await screen.findByText("Dự kiến · Bấm để xác nhận");
    fireEvent.click(plannedLabel.closest("button")!);
    fireEvent.click(await screen.findByRole("button", { name: "Xác nhận" }));
    await waitFor(() => expect(api.scheduleMe).toHaveBeenCalledTimes(2));
    expect(notify).toHaveBeenCalledWith("Lịch dạy này đã được xử lý. Đã cập nhật trạng thái mới nhất.", "warning");
  });
});
