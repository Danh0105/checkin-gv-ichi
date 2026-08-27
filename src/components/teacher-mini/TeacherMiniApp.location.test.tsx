// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const geo = vi.hoisted(() => ({
  getCurrentPosition: vi.fn(),
  formatDistance: (value: number) => `${value} m`,
  haversineDistance: vi.fn(() => 0),
}));
const api = vi.hoisted(() => ({
  checkin: vi.fn(),
  checkout: vi.fn(),
  lesson: vi.fn(),
  apply: vi.fn(),
}));

vi.mock("@/utils/geo", () => geo);
vi.mock("@/services/auth-session", () => ({
  clearPendingDraft: vi.fn(async () => undefined),
  getPendingDraft: vi.fn(async () => null),
  savePendingDraft: vi.fn(async () => undefined),
}));
vi.mock("@/services/teacher-mini-api", () => ({
  TeacherApiError: class TeacherApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
  teacherMiniApi: {
    sessions: { checkin: api.checkin, checkout: api.checkout, lesson: api.lesson, apply: api.apply },
  },
}));
vi.mock("zmp-ui", () => ({
  DatePicker: () => null,
  useSnackbar: () => ({ openSnackbar: vi.fn() }),
}));

import { ApplicationSheet, SessionDetailSheet } from "@/components/teacher-mini/TeacherMiniApp";
import { TeachingSession } from "@/types/teaching";

const session: TeachingSession = {
  id: 123,
  scheduleId: null,
  teacherId: 45,
  teacherName: "Giáo viên A",
  schoolId: 10,
  schoolName: "Trường A",
  subjectId: 3,
  subjectName: "STEM",
  schoolYear: "2026-2027",
  date: "2026-08-10",
  dayOfWeek: 2,
  dayOfWeekLabel: "Thứ Hai",
  startTime: "08:00:00",
  endTime: "09:30:00",
  status: "SCHEDULED",
  statusLabel: null,
  assignmentStatus: "ASSIGNED",
  confirmationStatus: "CONFIRMED",
  confirmedAt: "2026-08-25T00:00:00.000Z",
  rejectionReason: null,
  checkinRequired: true,
  checkoutRequired: true,
  checkinAt: null,
  declinedAt: null,
  declineReason: null,
  declinedTeacherId: null,
  declinedTeacherName: null,
  isMakeup: false,
  makeupForSessionId: null,
  attendanceNote: null,
  checkedById: null,
  checkedByName: null,
  checkedAt: null,
  note: null,
  schoolLatitude: null,
  schoolLongitude: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("giao diện thao tác định vị", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    geo.getCurrentPosition.mockResolvedValue({ latitude: 10.7, longitude: 106.7 });
    api.checkin.mockResolvedValue({ ...session, checkinAt: "2026-08-10T08:01:00.000Z" });
    api.checkout.mockResolvedValue({ ...session, checkinAt: "2026-08-10T08:01:00.000Z", checkoutAt: "2026-08-10T09:31:00.000Z" });
    api.apply.mockResolvedValue({ id: 1, status: "PENDING", distance: 20, assignedPeriodsInWeek: 1, pendingPeriodsInWeek: 1, maxPeriodsPerWeek: 10, remainingPeriodsInWeek: 8 });
  });

  it("mở chi tiết không xin vị trí và không còn cảnh báo backend cũ", () => {
    render(<SessionDetailSheet session={session} onClose={vi.fn()} onUpdate={vi.fn()} onDeclined={vi.fn()} notify={vi.fn()} />);
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expect(screen.queryByText(/backend chưa có API/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check-in" })).toBeEnabled();
  });

  it("bấm Check-in mở form ảnh nhưng chưa xin vị trí", () => {
    render(<SessionDetailSheet session={session} onClose={vi.fn()} onUpdate={vi.fn()} onDeclined={vi.fn()} notify={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Check-in" }));
    expect(screen.getByRole("heading", { name: "Check-in buổi dạy" })).toBeInTheDocument();
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expect(api.checkin).not.toHaveBeenCalled();
  });

  it("bấm Check-out lấy vị trí, gửi ngay, rồi mở form báo giảng", async () => {
    const checkedIn = { ...session, checkinRequired: false, checkoutRequired: true, checkinAt: null };
    render(<SessionDetailSheet session={checkedIn} onClose={vi.fn()} onUpdate={vi.fn()} onDeclined={vi.fn()} notify={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Check-out" }));
    await waitFor(() => expect(api.checkout).toHaveBeenCalledWith(123, { latitude: 10.7, longitude: 106.7 }));
    expect(await screen.findByRole("heading", { name: "Báo giảng" })).toBeInTheDocument();
    expect(api.checkin).not.toHaveBeenCalled();
  });

  it("giữ popup mở khi resolve checkout thất bại", async () => {
    geo.getCurrentPosition.mockRejectedValue(new Error("Không thể xác định vị trí hiện tại."));
    render(<SessionDetailSheet session={{ ...session, checkinRequired: false, checkoutRequired: true }} onClose={vi.fn()} onUpdate={vi.fn()} onDeclined={vi.fn()} notify={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Check-out" }));
    await waitFor(() => expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(api.checkout).not.toHaveBeenCalled();
  });

  it("đăng ký tiết chỉ gọi API nghiệp vụ sau khi resolve và chống gửi trùng", async () => {
    const position = deferred<{ latitude: number; longitude: number }>();
    geo.getCurrentPosition.mockReturnValue(position.promise);
    render(<ApplicationSheet session={{ ...session, assignmentStatus: "OPEN", teacherId: null }} onClose={vi.fn()} onSuccess={vi.fn()} notify={vi.fn()} />);

    const button = screen.getByRole("button", { name: "Xác nhận đăng ký" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(api.apply).not.toHaveBeenCalled();

    position.resolve({ latitude: 10.71, longitude: 106.71 });
    await waitFor(() => expect(api.apply).toHaveBeenCalledWith(123, { latitude: 10.71, longitude: 106.71 }, null));
    expect(api.apply).toHaveBeenCalledTimes(1);
  });

});
