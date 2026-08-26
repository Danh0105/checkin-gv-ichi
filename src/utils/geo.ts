import { getAccessToken as getZaloAccessToken, getLocation } from "zmp-sdk";

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
