// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { teacherMiniApi } from "@/services/teacher-mini-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("teacherMiniApi.sessions.me for income", () => {
  it("dùng endpoint /me, khoảng tháng, phân trang và không gửi teacherId", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [],
      pagination: { page: 2, limit: 100, total: 0, totalPages: 2 },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await teacherMiniApi.sessions.me({ fromDate: "2026-08-01", toDate: "2026-08-31", page: 2, limit: 100 }, controller.signal);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/teaching-sessions/me?");
    expect(url).toContain("fromDate=2026-08-01");
    expect(url).toContain("toDate=2026-08-31");
    expect(url).toContain("page=2");
    expect(url).toContain("limit=100");
    expect(url).not.toContain("teacherId");
    expect(init.signal).toBe(controller.signal);
  });
});
