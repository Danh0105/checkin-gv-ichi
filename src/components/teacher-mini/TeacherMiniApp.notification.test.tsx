// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn(), readAll: vi.fn() }));
vi.mock("@/services/teacher-mini-api", () => ({
  TeacherApiError: class TeacherApiError extends Error {},
  teacherMiniApi: { notifications: api, sessions: {}, schedules: {}, teacher: {} },
}));
vi.mock("@/services/auth-session", () => ({ clearPendingDraft: vi.fn(), getPendingDraft: vi.fn(async () => null), savePendingDraft: vi.fn() }));
vi.mock("@/utils/geo", () => ({ getCurrentPosition: vi.fn(), formatDistance: vi.fn(), haversineDistance: vi.fn() }));
vi.mock("zmp-ui", () => ({ DatePicker: () => null, useSnackbar: () => ({ openSnackbar: vi.fn() }) }));

import { NotificationSheet } from "@/components/teacher-mini/TeacherMiniApp";

describe("lesson report notification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue({ data: [{ id: 9, type: "TEACHING_LESSON_REPORT_ALERT", title: "Backend title", message: "Còn 2 tiết chưa báo giảng", isRead: false, meta: { kind: "lesson_report_missing", date: "2026-08-25", sessionIds: [101, 102] } }], pagination: {} });
    api.read.mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  it("shows the alert and navigates to its date and session IDs", async () => {
    const navigate = vi.fn();
    const onClose = vi.fn();
    render(<NotificationSheet onClose={onClose} notify={vi.fn()} onCountChange={vi.fn()} onNavigateLessonReport={navigate} />);
    const alert = await screen.findByRole("button", { name: /Nhắc báo giảng/ });
    fireEvent.click(alert);
    await waitFor(() => expect(api.read).toHaveBeenCalledWith(9));
    expect(navigate).toHaveBeenCalledWith({ date: "2026-08-25", sessionIds: [101, 102] });
    expect(onClose).toHaveBeenCalled();
  });

  it.each([
    ["TEACHING_SCHEDULE_CONFIRM_REQUEST", { entityType: "schedule", scheduleId: 107 }, "Lịch dạy cần xác nhận", { entityType: "schedule", scheduleId: 107, sessionId: undefined, urgent: false, notificationId: 10 }],
    ["TEACHING_SCHEDULE_CONFIRM_RESULT", { entityType: "schedule", scheduleId: 107, status: "CONFIRMED" }, "Kết quả phản hồi lịch", { entityType: "schedule", scheduleId: 107, sessionId: undefined, urgent: false, notificationId: 10 }],
    ["TEACHING_SCHEDULE_CONFIRM_ALERT", { sessionId: 953 }, "Khẩn: lịch chưa xác nhận", { entityType: "session", scheduleId: undefined, sessionId: 953, urgent: true, notificationId: 10 }],
  ])("renders and routes %s", async (type, meta, title, expectedTarget) => {
    api.list.mockResolvedValue({ data: [{ id: 10, type, message: "Thông báo lịch dạy", isRead: false, meta: { kind: type, ...meta } }], pagination: {} });
    const navigate = vi.fn();
    render(<NotificationSheet onClose={vi.fn()} notify={vi.fn()} onCountChange={vi.fn()} onNavigateScheduleConfirmation={navigate} />);
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(title) }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(expectedTarget));
  });

  it("ẩn thông báo đổi vị trí với giáo viên cộng tác viên", async () => {
    api.list.mockResolvedValue({ data: [
      { id: 11, type: "TEACHER_LOCATION_CHANGE_RESULT", message: "Vị trí mới đã được duyệt", isRead: false, meta: { kind: "TEACHER_LOCATION_CHANGE_RESULT", approved: true } },
      { id: 12, type: "TEACHING_LESSON_REPORT_ALERT", message: "Còn 1 tiết chưa báo giảng", isRead: false, meta: { kind: "lesson_report_missing", date: "2026-08-25", sessionIds: [101] } },
    ], pagination: {} });

    render(<NotificationSheet onClose={vi.fn()} notify={vi.fn()} companyTeacher={false} />);

    expect(await screen.findByRole("button", { name: /Nhắc báo giảng/ })).toBeInTheDocument();
    expect(screen.queryByText("Vị trí mới đã được duyệt")).not.toBeInTheDocument();
  });
});
