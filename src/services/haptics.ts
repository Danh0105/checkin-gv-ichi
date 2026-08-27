import { vibrate } from "zmp-sdk";

/**
 * Rung nhẹ khi có thông báo khẩn (lịch dạy cần xác nhận / sắp hết hạn phản hồi).
 * Chỉ hoạt động trong app Zalo mobile và cần được Cấp quyền "Kích hoạt chế độ rung trên thiết bị"
 * tại trang Quản lý ứng dụng Zalo Mini App — nếu chưa được cấp hoặc chạy ngoài Zalo, lỗi bị nuốt êm.
 */
export function vibrateAlert() {
  vibrate({ type: "oneShot", milliseconds: 300 }).catch(() => undefined);
}
