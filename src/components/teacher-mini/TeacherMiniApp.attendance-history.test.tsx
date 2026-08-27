// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  sessionMe: vi.fn(),
}));

vi.mock("@/services/teacher-mini-api", () => ({
  TeacherApiError: class TeacherApiError extends Error {},
  teacherMiniApi: {
    sessions: { me: api.sessionMe },
  },
}));
vi.mock("@/services/auth-session", () => ({ clearPendingDraft: vi.fn(), getPendingDraft: vi.fn(async () => null), savePendingDraft: vi.fn() }));
vi.mock("@/utils/geo", () => ({ getCurrentPosition: vi.fn(), formatDistance: vi.fn(), haversineDistance: vi.fn() }));
vi.mock("zmp-ui", () => ({ DatePicker: () => null, useSnackbar: () => ({ openSnackbar: vi.fn() }) }));

import { AttendanceScreen } from "@/components/teacher-mini/TeacherMiniApp";

describe("attendance history range", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 7, 26, 9, 0, 0));
    api.sessionMe.mockResolvedValue({ data: [], pagination: {} });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("supports viewing attendance history by week", async () => {
    render(<AttendanceScreen notify={vi.fn()} onProfileMissing={vi.fn()} />);
    await waitFor(() => expect(api.sessionMe).toHaveBeenCalledWith({ fromDate: "2026-08-26", toDate: "2026-08-26", limit: 200 }));

    fireEvent.click(screen.getByRole("button", { name: "Lịch sử" }));
    await waitFor(() => expect(api.sessionMe).toHaveBeenLastCalledWith({ fromDate: "2026-08-01", toDate: "2026-08-31", limit: 200 }));

    fireEvent.click(screen.getByRole("button", { name: "Theo tuần" }));
    await waitFor(() => expect(api.sessionMe).toHaveBeenLastCalledWith({ fromDate: "2026-08-24", toDate: "2026-08-30", limit: 200 }));
    expect(screen.getByText("Tuần 24/08/2026 – 30/08/2026")).toBeInTheDocument();
  });
});
