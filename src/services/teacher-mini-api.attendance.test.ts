// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { attendanceAdminApi } from "@/services/teacher-mini-api";

afterEach(() => vi.unstubAllGlobals());

describe("attendanceAdminApi", () => {
  it("gửi otherCosts dạng number cho PATCH đơn và PATCH hàng loạt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await attendanceAdminApi.update(123, {
      status: "PRESENT",
      attendanceNote: "Đã hoàn thành",
      otherCosts: [{ name: "Xăng xe", amount: 50_000, note: null }],
    });
    await attendanceAdminApi.bulkUpdate([{
      sessionId: 456,
      status: "PRESENT",
      attendanceNote: null,
      otherCosts: [{ name: "Phụ cấp", amount: 100_000 }],
    }]);

    const [singleUrl, singleInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(singleUrl).toContain("/teaching-sessions/123/attendance");
    expect(singleInit.method).toBe("PATCH");
    expect(JSON.parse(String(singleInit.body))).toEqual({
      status: "PRESENT",
      attendanceNote: "Đã hoàn thành",
      otherCosts: [{ name: "Xăng xe", amount: 50_000, note: null }],
    });

    const [bulkUrl, bulkInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(bulkUrl).toContain("/teaching-sessions/attendance/bulk");
    expect(bulkInit.method).toBe("PATCH");
    expect(JSON.parse(String(bulkInit.body))).toEqual({ items: [{
      sessionId: 456,
      status: "PRESENT",
      attendanceNote: null,
      otherCosts: [{ name: "Phụ cấp", amount: 100_000 }],
    }] });
  });
});
