import { followOA, getUserInfo } from "zmp-sdk";

import { ZALO_OA_ID } from "@/config/api";

export interface ZaloIdentity {
  uid: string;
  zaloId: string;
}

/**
 * Đọc uid + zaloId (idByOA) từ Zalo SDK, không ép hiện popup xin quyền tên/ảnh đại diện
 * vì đăng nhập chỉ cần id (mặc định) và idByOA (phụ thuộc trạng thái follow OA).
 * Trả về null nếu không chạy trong Zalo app hoặc chưa follow OA — không phải lỗi cần báo người dùng.
 */
export async function readZaloIdentity(): Promise<ZaloIdentity | null> {
  try {
    const { userInfo } = await getUserInfo({ autoRequestPermission: false });
    const uid = userInfo.id?.trim();
    const zaloId = userInfo.idByOA?.trim();
    if (!uid || !zaloId) return null;
    return { uid, zaloId };
  } catch {
    return null;
  }
}

export async function requestFollowOA(): Promise<void> {
  if (!ZALO_OA_ID) throw new Error("Chưa cấu hình Official Account, vui lòng liên hệ quản trị viên.");
  await followOA({ id: ZALO_OA_ID, showDialogConfirm: true });
}
