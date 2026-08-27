import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/auth-session", () => ({
  getAccessToken: vi.fn(() => "kido-jwt"),
  clearAccessToken: vi.fn(async () => undefined),
  emitUnauthorized: vi.fn(),
}));

import { teacherMiniApi } from "@/services/teacher-mini-api";

describe("teacherMiniApi notifications", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("loads teacher notification types from the shared notifications endpoint", async () => {
    fetchMock.mockImplementation((url: string) => {
      const type = new URL(url).searchParams.get("type");
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ id: type === "TEACHING_LESSON_REPORT_ALERT" ? 5 : 1, type, createdAt: type === "TEACHING_LESSON_REPORT_ALERT" ? "2026-08-26T12:00:00.000Z" : "2026-08-26T08:00:00.000Z" }],
          pagination: { total: 1 },
        }),
      } as Response);
    });

    const result = await teacherMiniApi.notifications.list("unread");

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls.map(([url]) => new URL(url as string).pathname)).toEqual(Array(5).fill("/notifications"));
    expect(fetchMock.mock.calls.map(([url]) => new URL(url as string).searchParams.get("type"))).toEqual([
      "TEACHING_SCHEDULE",
      "TEACHING_SCHEDULE_CONFIRM_REQUEST",
      "TEACHING_SCHEDULE_CONFIRM_RESULT",
      "TEACHING_SCHEDULE_CONFIRM_ALERT",
      "TEACHING_LESSON_REPORT_ALERT",
    ]);
    expect(result.data[0]).toMatchObject({ id: 5, type: "TEACHING_LESSON_REPORT_ALERT" });
  });

  it("loads all notifications without a tab filter", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [], pagination: { total: 0 } }),
    } as Response);

    await teacherMiniApi.notifications.list("all");

    expect(fetchMock).toHaveBeenCalledTimes(5);
    fetchMock.mock.calls.forEach(([url]) => {
      expect(new URL(url as string).searchParams.has("tab")).toBe(false);
    });
  });

  it("uses the backend unread count endpoint for the bell badge", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ count: 7 }) } as Response);

    await expect(teacherMiniApi.notifications.unreadCount()).resolves.toBe(7);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/notifications/unread-count");
  });

  it("accepts numeric unread count responses", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => 9 } as Response);

    await expect(teacherMiniApi.notifications.unreadCount()).resolves.toBe(9);
  });

  it("counts all teacher notifications for the bell badge", async () => {
    fetchMock.mockImplementation((url: string) => {
      const type = new URL(url).searchParams.get("type");
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: [], pagination: { total: type === "TEACHING_SCHEDULE_CONFIRM_ALERT" ? 3 : 2 } }),
      } as Response);
    });

    await expect(teacherMiniApi.notifications.totalCount()).resolves.toBe(11);

    expect(fetchMock).toHaveBeenCalledTimes(5);
    fetchMock.mock.calls.forEach(([url]) => {
      const params = new URL(url as string).searchParams;
      expect(params.get("page")).toBe("1");
      expect(params.get("limit")).toBe("1");
    });
  });
});
