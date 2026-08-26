// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const geo = vi.hoisted(() => ({ getCurrentPosition: vi.fn(), formatDistance: (value: number) => `${value} m`, haversineDistance: vi.fn(() => 0) }));
const api = vi.hoisted(() => ({ checkin: vi.fn(), checkout: vi.fn(), lesson: vi.fn(), apply: vi.fn() }));

vi.mock("@/utils/geo", () => geo);
vi.mock("@/services/auth-session", () => ({ clearPendingDraft: vi.fn(async () => undefined), getPendingDraft: vi.fn(async () => null), savePendingDraft: vi.fn(async () => undefined) }));
vi.mock("@/services/teacher-mini-api", () => ({
  TeacherApiError: class TeacherApiError extends Error { constructor(public status: number, message: string, public code: string | null = null) { super(message); } },
  teacherMiniApi: { sessions: api },
}));
vi.mock("zmp-ui", () => ({ DatePicker: () => null, useSnackbar: () => ({ openSnackbar: vi.fn() }) }));

import { CheckinSheet, LessonReportSheet, mergeSessionAfterMutation, SessionDetailSheet } from "@/components/teacher-mini/TeacherMiniApp";
import { TeachingSession } from "@/types/teaching";

const session: TeachingSession = {
  id: 123, scheduleId: null, teacherId: 45, teacherName: "Giáo viên A", schoolId: 10, schoolName: "Trường A",
  subjectId: 3, subjectName: "STEM", schoolYear: "2026-2027", date: "2026-08-25", dayOfWeek: 2, dayOfWeekLabel: "Thứ Ba",
  startTime: "08:00:00", endTime: "09:00:00", status: "SCHEDULED", statusLabel: null, assignmentStatus: "ASSIGNED",
  confirmationStatus: "CONFIRMED", confirmedAt: "2026-08-25T00:00:00Z", rejectionReason: null,
  checkinRequired: true, checkoutRequired: true, checkinAt: null, checkoutAt: null, declinedAt: null, declineReason: null,
  declinedTeacherId: null, declinedTeacherName: null, isMakeup: false, makeupForSessionId: null, attendanceNote: null,
  checkedById: null, checkedByName: null, checkedAt: null, note: null, schoolLatitude: null, schoolLongitude: null,
  lessonSubmittedAt: null, lessonReportDueAt: "2099-08-26T01:00:00.000Z",
};

const photo = (name = "photo.jpg", type = "image/jpeg", size?: number) => {
  const file = new File(["photo"], name, { type });
  if (size !== undefined) Object.defineProperty(file, "size", { value: size });
  return file;
};

describe("attendance and lesson report flows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:preview") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    geo.getCurrentPosition.mockResolvedValue({ latitude: 10.7, longitude: 106.7 });
    api.checkin.mockResolvedValue({ ...session, checkinAt: "2026-08-25T01:00:00Z" });
    api.checkout.mockResolvedValue({ ...session, checkoutAt: "2026-08-25T02:00:00Z" });
    api.lesson.mockResolvedValue({ ...session, checkoutAt: "2026-08-25T02:00:00Z", lessonSubmittedAt: "2026-08-25T03:00:00Z" });
  });
  afterEach(cleanup);

  it("does not request GPS or call check-in without an image", () => {
    render(<CheckinSheet session={session} onClose={vi.fn()} onSuccess={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận Check-in" }));
    expect(screen.getByText("Vui lòng chụp ảnh khi check-in")).toBeInTheDocument();
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expect(api.checkin).not.toHaveBeenCalled();
  });

  it("shows the school coordinates and a Google Maps link in the check-in popup", () => {
    render(<CheckinSheet session={{ ...session, schoolLatitude: 10.7, schoolLongitude: 106.7, schoolCheckinRadius: 250 }} onClose={vi.fn()} onSuccess={vi.fn()} />);
    expect(screen.getByText("10.700000, 106.700000 · Bán kính 250 m")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Xem trên Google Maps/ })).toHaveAttribute("href", "https://www.google.com/maps/search/?api=1&query=10.7%2C106.7");
    expect(screen.getByRole("link", { name: /Xem trên Google Maps/ })).toHaveAttribute("target", "_blank");
  });

  it("does not create a Maps link when the school has no coordinates", () => {
    render(<CheckinSheet session={session} onClose={vi.fn()} onSuccess={vi.fn()} />);
    expect(screen.getByText("Trường chưa được cấu hình tọa độ")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Google Maps/ })).not.toBeInTheDocument();
  });

  it("previews and submits one check-in image with GPS", async () => {
    const image = photo("checkin.webp", "image/webp");
    const onSuccess = vi.fn();
    render(<CheckinSheet session={session} onClose={vi.fn()} onSuccess={onSuccess} />);
    fireEvent.change(screen.getByLabelText("Chụp ảnh Check-in"), { target: { files: [image] } });
    expect(screen.getByAltText("Ảnh Check-in đã chọn")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận Check-in" }));
    await waitFor(() => expect(api.checkin).toHaveBeenCalledWith(123, { latitude: 10.7, longitude: 106.7 }, image));
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ checkinRequired: true, checkoutRequired: false, checkinAt: null }, "Check-in"],
    [{ checkinRequired: false, checkoutRequired: true, checkinAt: null }, "Check-out"],
  ])("renders the backend-directed attendance action", (flags, button) => {
    render(<SessionDetailSheet session={{ ...session, ...flags }} onClose={vi.fn()} onUpdate={vi.fn()} onDeclined={vi.fn()} notify={vi.fn()} />);
    expect(screen.getByRole("button", { name: button })).toBeEnabled();
  });

  it("renders no attendance action for a middle block session", () => {
    render(<SessionDetailSheet session={{ ...session, checkinRequired: false, checkoutRequired: false }} onClose={vi.fn()} onUpdate={vi.fn()} onDeclined={vi.fn()} notify={vi.fn()} />);
    expect(screen.getByText("Tiết này không cần thao tác chấm công.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Check-in|Check-out/ })).not.toBeInTheDocument();
  });

  it("checks out a final session with null checkinAt and refreshes the whole range", async () => {
    const onRefresh = vi.fn(async () => undefined);
    const onUpdate = vi.fn();
    render(<SessionDetailSheet session={{ ...session, checkinRequired: false, checkoutRequired: true, checkinAt: null }} onClose={vi.fn()} onUpdate={onUpdate} onDeclined={vi.fn()} onRefresh={onRefresh} notify={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Check-out" }));
    await waitFor(() => expect(api.checkout).toHaveBeenCalledWith(123, { latitude: 10.7, longitude: 106.7 }));
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ checkoutAt: "2026-08-25T02:00:00Z" }));
    expect(onUpdate.mock.invocationCallOrder[0]).toBeLessThan(onRefresh.mock.invocationCallOrder[0]);
    expect(onRefresh).toHaveBeenCalledWith(123, expect.objectContaining({ checkoutAt: "2026-08-25T02:00:00Z" }));
    expect(screen.queryByLabelText(/Tên bài học/)).not.toBeInTheDocument();
  });

  it("shows check-in status immediately from the mutation response", () => {
    render(<SessionDetailSheet session={{ ...session, checkinRequired: true, checkoutRequired: false, checkinAt: "2026-08-25T01:00:00Z" }} onClose={vi.fn()} onUpdate={vi.fn()} onDeclined={vi.fn()} notify={vi.fn()} />);
    expect(screen.getByText("Đã check-in")).toBeInTheDocument();
  });

  it("keeps check-in images from the refreshed detail when merging an upload response", () => {
    const mutation = { ...session, checkinAt: "2026-08-25T01:00:00Z", checkinImages: [] };
    const fresh = { ...mutation, checkinImages: [{ id: 8, url: "/uploads/checkins/photo.jpg" }] };
    expect(mergeSessionAfterMutation(fresh, mutation).checkinImages).toEqual(fresh.checkinImages);
  });

  it("renders a relative check-in image URL from the API host", () => {
    render(<SessionDetailSheet session={{ ...session, checkinAt: "2026-08-25T01:00:00Z", checkinImages: [{ id: 8, url: "/uploads/checkins/photo.jpg" }] }} onClose={vi.fn()} onUpdate={vi.fn()} onDeclined={vi.fn()} notify={vi.fn()} />);
    expect(screen.getByAltText("Ảnh Check-in 1")).toHaveAttribute("src", "https://sales.kidoedu.vn/uploads/checkins/photo.jpg");
  });

  it("shows lesson report action only after attendance", () => {
    render(<SessionDetailSheet session={{ ...session, checkoutAt: "2026-08-25T02:00:00Z" }} onClose={vi.fn()} onUpdate={vi.fn()} onDeclined={vi.fn()} notify={vi.fn()} />);
    expect(screen.getByText("✓ Đã chấm công.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Báo giảng" }));
    expect(screen.getByRole("heading", { name: "Báo giảng" })).toBeInTheDocument();
  });

  it("requires student count and evidence before lesson submission", () => {
    render(<LessonReportSheet session={session} onClose={vi.fn()} onSuccess={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Tên bài học/), { target: { value: "Bài 1" } });
    fireEvent.change(screen.getByLabelText(/Đánh giá buổi học/), { target: { value: "Tốt" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi báo giảng" }));
    expect(screen.getByText("Sĩ số phải là số nguyên không âm.")).toBeInTheDocument();
    expect(screen.getByText("Vui lòng tải lên ít nhất một ảnh hoặc video minh chứng")).toBeInTheDocument();
    expect(api.lesson).not.toHaveBeenCalled();
  });

  it("submits count zero plus photo and video evidence", async () => {
    const image = photo("class.png", "image/png");
    const video = photo("class.mp4", "video/mp4");
    render(<LessonReportSheet session={session} onClose={vi.fn()} onSuccess={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Tên bài học/), { target: { value: "  Bài 1  " } });
    fireEvent.change(screen.getByLabelText(/Đánh giá buổi học/), { target: { value: "  Tốt  " } });
    fireEvent.change(screen.getByLabelText(/Sĩ số thực tế/), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Chọn ảnh hoặc video minh chứng"), { target: { files: [image, video] } });
    expect(screen.getByLabelText(/Video minh chứng/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Gửi báo giảng" }));
    await waitFor(() => expect(api.lesson).toHaveBeenCalledWith(123, { lessonName: "Bài 1", lessonEvaluation: "Tốt", actualStudentCount: 0, evidenceFiles: [image, video] }));
  });

  it.each([
    [photo("large.mp4", "video/mp4", 50 * 1024 * 1024 + 1), "Mỗi ảnh hoặc video không được vượt quá 50 MB"],
    [photo("bad.pdf", "application/pdf"), "Chỉ hỗ trợ ảnh JPEG, PNG, WebP hoặc video MP4, MOV, WebM"],
  ])("rejects invalid lesson evidence", (file, message) => {
    render(<LessonReportSheet session={session} onClose={vi.fn()} onSuccess={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Chọn ảnh hoặc video minh chứng"), { target: { files: [file] } });
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it("disables lesson reporting after the backend due timestamp", () => {
    render(<SessionDetailSheet session={{ ...session, checkoutAt: "2026-08-25T02:00:00Z", lessonReportDueAt: "2020-01-01T01:00:00Z" }} onClose={vi.fn()} onUpdate={vi.fn()} onDeclined={vi.fn()} notify={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Đã quá hạn báo giảng" })).toBeDisabled();
  });

  it("renders submitted photo and video evidence", () => {
    render(<SessionDetailSheet session={{ ...session, checkoutAt: "2026-08-25T02:00:00Z", lessonSubmittedAt: "2026-08-25T03:00:00Z", lessonName: "Bài 1", lessonEvaluation: "Tốt", actualStudentCount: 12, lessonImages: [{ url: "https://cdn.test/photo.webp" }, { url: "https://cdn.test/video.mp4", mediaType: "video" }] }} onClose={vi.fn()} onUpdate={vi.fn()} onDeclined={vi.fn()} notify={vi.fn()} />);
    expect(screen.getByAltText("Ảnh báo giảng 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Video báo giảng 2")).toBeInTheDocument();
  });
});
