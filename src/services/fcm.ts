import { getToken, onMessage } from "firebase/messaging";
import { getStorage, removeStorage, setStorage } from "zmp-sdk";

import { FIREBASE_VAPID_KEY, firebaseServiceWorkerQuery, getFirebaseMessaging, isFirebaseConfigured } from "@/config/firebase";
import { dispatchTeacherNotification } from "@/services/socket";
import { teacherMiniApi } from "@/services/teacher-mini-api";
import { TeachingNotification } from "@/types/teaching";

const FCM_TOKEN_KEY = "fcm_token";

let currentToken: string | null = null;
let unsubscribeForeground: (() => void) | null = null;

async function persistToken(token: string) {
  await setStorage({ data: { [FCM_TOKEN_KEY]: token } }).catch(() => undefined);
}

async function readPersistedToken(): Promise<string | null> {
  const storage = await getStorage({ keys: [FCM_TOKEN_KEY] }).catch(() => ({}) as Record<string, unknown>);
  return typeof storage[FCM_TOKEN_KEY] === "string" ? (storage[FCM_TOKEN_KEY] as string) : null;
}

async function clearPersistedToken() {
  await removeStorage({ keys: [FCM_TOKEN_KEY] }).catch(() => undefined);
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return undefined;
  try {
    return await navigator.serviceWorker.register(`firebase-messaging-sw.js?${firebaseServiceWorkerQuery()}`, { scope: "./" });
  } catch {
    return undefined;
  }
}

function parseForegroundNotification(payload: { data?: Record<string, string> }): TeachingNotification | null {
  const data = payload.data ?? {};
  const id = Number(data.id ?? data.notificationId);
  if (!Number.isFinite(id)) return null;

  let meta: TeachingNotification["meta"] | null = null;
  if (data.meta || data.metadata) {
    try {
      const parsed = JSON.parse(data.meta ?? data.metadata ?? "{}");
      if (parsed && typeof parsed === "object") meta = parsed;
    } catch {
      meta = null;
    }
  }

  return {
    id,
    type: data.type ?? meta?.kind ?? null,
    title: data.title ?? null,
    message: data.message ?? data.body ?? null,
    isRead: false,
    createdAt: data.createdAt ?? null,
    meta,
  };
}

/**
 * Gọi mỗi lần đăng nhập thành công (kể cả khôi phục phiên). Firebase modular SDK không còn
 * onTokenRefresh riêng — gọi lại getToken() ở đây đóng vai trò tương đương: trả về token còn
 * hiệu lực hoặc cấp token mới nếu Firebase đã xoay vòng token cũ.
 */
export async function registerFcmToken(onForegroundMessage?: (notification: TeachingNotification | null) => void): Promise<string | null> {
  if (!isFirebaseConfigured || typeof Notification === "undefined") return null;
  try {
    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (permission !== "granted") return null;

    const messaging = await getFirebaseMessaging();
    if (!messaging) return null;

    const registration = await registerServiceWorker();
    const token = await getToken(messaging, { vapidKey: FIREBASE_VAPID_KEY, serviceWorkerRegistration: registration });
    if (!token) return null;

    currentToken = token;
    await persistToken(token);
    await teacherMiniApi.fcm.save(token, "zalo-miniapp");

    unsubscribeForeground?.();
    unsubscribeForeground = onMessage(messaging, (payload) => {
      const notification = parseForegroundNotification(payload);
      if (notification && !dispatchTeacherNotification(notification)) return;
      onForegroundMessage?.(notification);
    });

    return token;
  } catch {
    return null;
  }
}

/** Bắt buộc gọi trong luồng đăng xuất, trước khi xoá JWT khỏi bộ nhớ máy. */
export async function unregisterFcmToken(): Promise<void> {
  unsubscribeForeground?.();
  unsubscribeForeground = null;
  const token = currentToken ?? (await readPersistedToken());
  currentToken = null;
  await clearPersistedToken();
  if (!token) return;
  await teacherMiniApi.fcm.remove(token).catch(() => undefined);
}
