import { API_HOST } from "@/config/api";
import { clearAccessToken, emitUnauthorized, getAccessToken } from "@/services/auth-session";
import { ResolvedZaloLocation } from "@/types/zalo-location";

type ErrorPayload = {
  code?: unknown;
  message?: unknown;
  error?: { code?: unknown; message?: unknown } | unknown;
};

export class ZaloLocationError extends Error {
  constructor(
    message: string,
    public status = 0,
    public code: string | null = null,
  ) {
    super(message);
    this.name = "ZaloLocationError";
  }
}

function errorCodeOf(payload: ErrorPayload) {
  if (typeof payload.code === "string") return payload.code;
  if (payload.error && typeof payload.error === "object" && "code" in payload.error && typeof payload.error.code === "string") return payload.error.code;
  return null;
}

function friendlyResolveError(status: number, code: string | null) {
  if (code === "ZALO_LOCATION_TOKEN_EXPIRED") return "Mã vị trí đã hết hạn. Vui lòng bấm thử lại để lấy vị trí mới.";
  if (code === "ZALO_LOCATION_TOKEN_USED") return "Mã vị trí đã được sử dụng. Vui lòng bấm thử lại để lấy vị trí mới.";
  if (code === "ZALO_ACCESS_TOKEN_INVALID") return "Phiên kết nối Zalo không còn hợp lệ. Vui lòng mở lại Mini App và thử lại.";
  if (code === "ZALO_APP_MISMATCH") return "Cấu hình kết nối Zalo chưa đồng bộ. Vui lòng liên hệ quản trị viên.";
  if (code === "ZALO_LOCATION_REJECTED" || code === "ZALO_LOCATION_TOKEN_INVALID") return "Zalo từ chối xác minh vị trí. Vui lòng bấm thử lại để lấy vị trí mới.";
  if (code === "ZALO_LOCATION_RESPONSE_INVALID") return "Dữ liệu vị trí Zalo trả về không hợp lệ. Vui lòng thử lại sau.";
  if (code === "ZALO_LOCATION_UPSTREAM_ERROR" || code === "ZALO_LOCATION_SERVICE_ERROR") return "Không thể kết nối dịch vụ vị trí Zalo. Vui lòng thử lại sau.";
  if (code === "ZALO_LOCATION_TIMEOUT") return "Zalo phản hồi quá chậm. Vui lòng lấy lại vị trí và thử lại.";
  if (status === 400) return "Dữ liệu định vị không hợp lệ. Vui lòng thử lấy lại vị trí.";
  if (status === 401) return "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.";
  if (status === 403) return "Tài khoản của bạn không có quyền sử dụng chức năng này.";
  if (status === 422) return "Zalo từ chối xác minh vị trí. Vui lòng bấm thử lại để lấy vị trí mới.";
  if (status === 429) return "Bạn thao tác quá nhanh. Vui lòng đợi một chút rồi thử lại.";
  if (status === 502) return "Không thể kết nối dịch vụ vị trí Zalo. Vui lòng thử lại sau.";
  if (status === 504) return "Zalo phản hồi quá chậm. Vui lòng lấy lại vị trí và thử lại.";
  return "Không thể xác định vị trí hiện tại. Vui lòng bật định vị và thử lại.";
}

/**
 * Đổi một location token dùng một lần thành tọa độ. Hàm này không retry và
 * không lưu, log hoặc đưa token vào URL.
 */
export async function resolveZaloLocation(
  locationToken: string,
  zaloAccessToken: string,
): Promise<ResolvedZaloLocation> {
  const kidoToken = getAccessToken();
  try {
    const response = await fetch(`${API_HOST}/zalo/location/resolve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(kidoToken ? { Authorization: `Bearer ${kidoToken}` } : {}),
      },
      body: JSON.stringify({ locationToken, zaloAccessToken }),
    });
    const payload = await response.json().catch(() => ({})) as ErrorPayload & Partial<ResolvedZaloLocation>;
    const code = errorCodeOf(payload);

    if (!response.ok) {
      if (response.status === 401) {
        await clearAccessToken();
        emitUnauthorized();
      }
      throw new ZaloLocationError(friendlyResolveError(response.status, code), response.status, code);
    }

    if (typeof payload.latitude !== "number" || !Number.isFinite(payload.latitude)
      || typeof payload.longitude !== "number" || !Number.isFinite(payload.longitude)) {
      throw new ZaloLocationError("Dữ liệu định vị không hợp lệ. Vui lòng thử lấy lại vị trí.", 400);
    }

    return {
      latitude: payload.latitude,
      longitude: payload.longitude,
      provider: typeof payload.provider === "string" ? payload.provider : null,
      timestamp: typeof payload.timestamp === "number" && Number.isFinite(payload.timestamp) ? payload.timestamp : null,
    };
  } catch (error) {
    if (error instanceof ZaloLocationError) throw error;
    throw new ZaloLocationError("Không có kết nối mạng. Vui lòng kiểm tra kết nối và thử lại.");
  }
}
