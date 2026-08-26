const configuredHost = (import.meta.env.VITE_API_HOST as string | undefined)?.trim();

/** Một nguồn cấu hình duy nhất cho cả đăng nhập và toàn bộ API nghiệp vụ. */
export const API_HOST = (configuredHost || "https://sales.kidoedu.vn").replace(/\/+$/, "");

export const API_ENVIRONMENT = API_HOST.includes("160.250.132.143") ? "development" : "production";

/** Zalo Official Account dùng để followOA() và nhận zaloId (idByOA) khi đăng nhập từ Mini App. */
export const ZALO_OA_ID = (import.meta.env.VITE_ZALO_OA_ID as string | undefined)?.trim() || "";
