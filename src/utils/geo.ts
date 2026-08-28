import { getAccessToken as getZaloAccessToken, getLocation, openWebview } from "zmp-sdk";

import { resolveZaloLocation, ZaloLocationError } from "@/services/zalo-location.service";

export interface GeoPosition {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export async function getCurrentPosition(): Promise<GeoPosition> {
  let locationResult: Awaited<ReturnType<typeof getLocation>>;
  let zaloAccessToken: string;
  try {
    [locationResult, zaloAccessToken] = await Promise.all([
      getLocation(),
      getZaloAccessToken(),
    ]);
  } catch (error) {
    const detail = error instanceof Error ? error.message.toLowerCase() : "";
    const code = typeof error === "object" && error !== null && "code" in error ? Number(error.code) : null;
    if (/permission|denied|authorize|cho phép|quyền/.test(detail) || code === -201 || code === -202) {
      throw new ZaloLocationError("Bạn cần cho phép truy cập vị trí để thực hiện thao tác này.", 0, "LOCATION_PERMISSION_DENIED");
    }
    throw new ZaloLocationError("Không thể xác định vị trí hiện tại. Vui lòng bật định vị và thử lại.");
  }

  const locationToken = typeof locationResult.token === "string" ? locationResult.token.trim() : "";
  const accessToken = typeof zaloAccessToken === "string" ? zaloAccessToken.trim() : "";
  if (!locationToken || !accessToken) {
    throw new ZaloLocationError("Không thể xác định vị trí hiện tại. Vui lòng bật định vị và thử lại.");
  }

  const resolved = await resolveZaloLocation(locationToken, accessToken);
  return { latitude: resolved.latitude, longitude: resolved.longitude };
}

export function haversineDistance(from: Pick<GeoPosition, "latitude" | "longitude">, to: Pick<GeoPosition, "latitude" | "longitude">) {
  const radius = 6371000;
  const rad = (degree: number) => degree * Math.PI / 180;
  const dLat = rad(to.latitude - from.latitude);
  const dLng = rad(to.longitude - from.longitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(from.latitude)) * Math.cos(rad(to.latitude)) * Math.sin(dLng / 2) ** 2;
  return Math.round(radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export const formatDistance = (meters: number) => meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(2)} km`;

export const googleMapsUrl = (latitude: number, longitude: number) =>
  `https://www.google.com/maps?q=${encodeURIComponent(`${latitude},${longitude}`)}`;

/**
 * Mở URL trong webview toàn màn hình của chính Zalo. Thẻ <a target="_blank"> không mở được gì
 * trong webview sandbox của Zalo Mini App. openOutApp() (thoát hẳn ra ngoài Zalo) không hoạt động
 * trên thiết bị thật — nhiều khả năng cần khai báo whitelist tên miền chưa được cấp, và không có
 * tài liệu/ví dụ chính thức. openWebview() được tài liệu hoá đầy đủ và không cần whitelist tên
 * miền vì nội dung vẫn hiển thị trong webview do Zalo kiểm soát, nên dùng cách này ổn định hơn.
 * Dự phòng window.open khi chạy ngoài app Zalo (vd. xem trước trên trình duyệt lúc dev).
 */
export async function openExternalUrl(url: string) {
  try {
    await openWebview({ url, config: { style: "normal" } });
  } catch {
    if (typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer");
  }
}

export function openGoogleMaps(latitude: number, longitude: number) {
  return openExternalUrl(googleMapsUrl(latitude, longitude));
}
