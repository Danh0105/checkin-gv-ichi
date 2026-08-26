import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  getLocation: vi.fn(),
  getAccessToken: vi.fn(),
}));
const resolver = vi.hoisted(() => ({ resolveZaloLocation: vi.fn() }));

vi.mock("zmp-sdk", () => sdk);
vi.mock("@/services/zalo-location.service", () => ({
  resolveZaloLocation: resolver.resolveZaloLocation,
  ZaloLocationError: class ZaloLocationError extends Error {
    constructor(message: string, public status = 0, public code: string | null = null) {
      super(message);
    }
  },
}));

import { getCurrentPosition } from "@/utils/geo";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("getCurrentPosition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdk.getLocation.mockResolvedValue({ token: "location-1" });
    sdk.getAccessToken.mockResolvedValue("zalo-1");
    resolver.resolveZaloLocation.mockResolvedValue({ latitude: 10.758341, longitude: 106.745863, provider: "gps", timestamp: 1 });
  });

  it("không xin vị trí nếu hàm nghiệp vụ chưa được gọi", () => {
    expect(sdk.getLocation).not.toHaveBeenCalled();
    expect(sdk.getAccessToken).not.toHaveBeenCalled();
  });

  it("gọi getLocation và getAccessToken đồng thời", async () => {
    const location = deferred<{ token: string }>();
    const access = deferred<string>();
    sdk.getLocation.mockReturnValue(location.promise);
    sdk.getAccessToken.mockReturnValue(access.promise);

    const result = getCurrentPosition();
    expect(sdk.getLocation).toHaveBeenCalledTimes(1);
    expect(sdk.getAccessToken).toHaveBeenCalledTimes(1);
    location.resolve({ token: "location-concurrent" });
    access.resolve("zalo-concurrent");
    await result;
  });

  it("gửi đúng hai token và giữ tọa độ dạng number", async () => {
    const position = await getCurrentPosition();
    expect(resolver.resolveZaloLocation).toHaveBeenCalledWith("location-1", "zalo-1");
    expect(position).toEqual({ latitude: 10.758341, longitude: 106.745863 });
    expect(typeof position.latitude).toBe("number");
    expect(typeof position.longitude).toBe("number");
  });

  it("mỗi lần thử lại lấy token mới, không tái sử dụng token lỗi", async () => {
    sdk.getLocation.mockResolvedValueOnce({ token: "expired" }).mockResolvedValueOnce({ token: "fresh" });
    sdk.getAccessToken.mockResolvedValueOnce("zalo-old").mockResolvedValueOnce("zalo-new");
    resolver.resolveZaloLocation.mockRejectedValueOnce(new Error("Vị trí đã hết hạn"));

    await expect(getCurrentPosition()).rejects.toThrow("Vị trí đã hết hạn");
    await getCurrentPosition();
    expect(resolver.resolveZaloLocation.mock.calls).toEqual([
      ["expired", "zalo-old"],
      ["fresh", "zalo-new"],
    ]);
  });

  it("hiển thị lỗi thân thiện khi người dùng từ chối quyền", async () => {
    sdk.getLocation.mockRejectedValue(new Error("Permission denied"));
    await expect(getCurrentPosition()).rejects.toThrow("Bạn cần cho phép truy cập vị trí để thực hiện thao tác này.");
    expect(resolver.resolveZaloLocation).not.toHaveBeenCalled();
  });
});
