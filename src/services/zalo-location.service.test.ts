import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getAccessToken: vi.fn(() => "kido-jwt"),
  clearAccessToken: vi.fn(async () => undefined),
  emitUnauthorized: vi.fn(),
}));

vi.mock("@/services/auth-session", () => auth);

import { resolveZaloLocation } from "@/services/zalo-location.service";

function response(status: number, payload: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response);
}

describe("resolveZaloLocation", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("gửi token duy nhất trong JSON body, không đưa vào URL hoặc log", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    fetchMock.mockReturnValue(response(200, { latitude: 10.7, longitude: 106.7, provider: "gps", timestamp: 123 }));

    const result = await resolveZaloLocation("location-secret", "zalo-secret");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/zalo\/location\/resolve$/);
    expect(url).not.toContain("location-secret");
    expect(url).not.toContain("zalo-secret");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: "Bearer kido-jwt", "Content-Type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({ locationToken: "location-secret", zaloAccessToken: "zalo-secret" });
    expect(log).not.toHaveBeenCalled();
    expect(result).toMatchObject({ latitude: 10.7, longitude: 106.7 });
    log.mockRestore();
  });

  it.each([
    [400, {}, "Dữ liệu định vị không hợp lệ"],
    [403, {}, "Tài khoản của bạn không có quyền sử dụng chức năng này"],
    [422, {}, "Zalo từ chối xác minh vị trí"],
    [400, { code: "ZALO_LOCATION_TOKEN_INVALID" }, "Zalo từ chối xác minh vị trí"],
    [422, { code: "ZALO_LOCATION_TOKEN_EXPIRED" }, "Mã vị trí đã hết hạn"],
    [422, { error: { code: "ZALO_LOCATION_TOKEN_USED" } }, "Mã vị trí đã được sử dụng"],
    [422, { code: "ZALO_ACCESS_TOKEN_INVALID" }, "Phiên kết nối Zalo không còn hợp lệ"],
    [502, { code: "ZALO_APP_MISMATCH" }, "Cấu hình kết nối Zalo chưa đồng bộ"],
    [422, { code: "ZALO_LOCATION_REJECTED" }, "Zalo từ chối xác minh vị trí"],
    [502, { code: "ZALO_LOCATION_RESPONSE_INVALID" }, "Dữ liệu vị trí Zalo trả về không hợp lệ"],
    [502, { code: "ZALO_LOCATION_UPSTREAM_ERROR" }, "Không thể kết nối dịch vụ vị trí Zalo"],
    [502, {}, "Không thể kết nối dịch vụ vị trí Zalo"],
    [504, {}, "Zalo phản hồi quá chậm"],
    [429, {}, "Bạn thao tác quá nhanh"],
  ])("ánh xạ lỗi HTTP %s sang thông báo thân thiện", async (status, payload, message) => {
    fetchMock.mockReturnValue(response(status as number, payload));
    await expect(resolveZaloLocation("one-use", "zalo")).rejects.toThrow(message as string);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("xóa phiên và phát sự kiện đăng nhập khi backend trả 401", async () => {
    fetchMock.mockReturnValue(response(401, {}));
    await expect(resolveZaloLocation("one-use", "zalo")).rejects.toThrow("Phiên đăng nhập đã hết hạn");
    expect(auth.clearAccessToken).toHaveBeenCalledTimes(1);
    expect(auth.emitUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("từ chối response có tọa độ không phải number", async () => {
    fetchMock.mockReturnValue(response(200, { latitude: "10.7", longitude: 106.7 }));
    await expect(resolveZaloLocation("one-use", "zalo")).rejects.toThrow("Dữ liệu định vị không hợp lệ");
  });

  it("hiển thị lỗi mất mạng và không tự retry", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(resolveZaloLocation("one-use", "zalo")).rejects.toThrow("Không có kết nối mạng");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
