import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/auth-session", () => ({
  getAccessToken: vi.fn(() => "kido-jwt"),
  clearAccessToken: vi.fn(async () => undefined),
  emitUnauthorized: vi.fn(),
}));

import { teacherMiniApi } from "@/services/teacher-mini-api";

describe("teacherMiniApi session attendance multipart contracts", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 123 }) } as Response);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends check-in GPS and exactly one image field as multipart", async () => {
    const photo = new File(["photo"], "checkin.jpg", { type: "image/jpeg" });
    await teacherMiniApi.sessions.checkin(123, { latitude: 10.7, longitude: 106.7 }, photo);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/teaching-sessions\/123\/checkin$/);
    expect(init.headers).not.toHaveProperty("Content-Type");
    const body = init.body as FormData;
    expect(body.get("latitude")).toBe("10.7");
    expect(body.get("longitude")).toBe("106.7");
    expect(body.getAll("image")).toEqual([photo]);
    expect(body.has("images")).toBe(false);
  });

  it("sends checkout as GPS-only multipart", async () => {
    await teacherMiniApi.sessions.checkout(944, { latitude: 10.7, longitude: 106.7, accuracy: 8.5 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/teaching-sessions\/944\/checkout$/);
    expect(init.headers).not.toHaveProperty("Content-Type");
    const body = init.body as FormData;
    expect(body.get("latitude")).toBe("10.7");
    expect(body.get("longitude")).toBe("106.7");
    expect(body.get("accuracy")).toBe("8.5");
    ["lessonName", "lessonEvaluation", "actualStudentCount", "image", "images"].forEach((field) => expect(body.has(field)).toBe(false));
  });

  it("sends lesson report fields and repeated images for photos and videos", async () => {
    const photo = new File(["photo"], "class.png", { type: "image/png" });
    const video = new File(["video"], "class.mp4", { type: "video/mp4" });
    await teacherMiniApi.sessions.lesson(944, { lessonName: "  Middle lesson  ", lessonEvaluation: "  Completed  ", actualStudentCount: 0, evidenceFiles: [photo, video] });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/teaching-sessions\/944\/lesson$/);
    const body = init.body as FormData;
    expect(body.get("lessonName")).toBe("Middle lesson");
    expect(body.get("lessonEvaluation")).toBe("Completed");
    expect(body.get("actualStudentCount")).toBe("0");
    expect(body.getAll("images")).toEqual([photo, video]);
    expect(body.has("latitude")).toBe(false);
  });

  it("confirms a repeating schedule with the confirmation contract", async () => {
    await teacherMiniApi.schedules.confirmation(107, { status: "CONFIRMED", reason: null });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/teaching-schedules\/107\/confirmation$/);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ status: "CONFIRMED", reason: null });
  });

  it("rejects a standalone session with a trimmed reason supplied by the UI", async () => {
    await teacherMiniApi.sessions.confirmation(953, { status: "REJECTED", reason: "Trùng lịch công tác" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/teaching-sessions\/953\/confirmation$/);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ status: "REJECTED", reason: "Trùng lịch công tác" });
  });
});
