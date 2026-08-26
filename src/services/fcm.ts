import { getToken, onMessage } from "firebase/messaging";
import { getStorage, removeStorage, setStorage } from "zmp-sdk";

import { FIREBASE_VAPID_KEY, firebaseServiceWorkerQuery, getFirebaseMessaging, isFirebaseConfigured } from "@/config/firebase";
import { teacherMiniApi } from "@/services/teacher-mini-api";

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

/**
 * Gọi mỗi lần đăng nhập thành công (kể cả khôi phục phiên). Firebase modular SDK không còn
 * onTokenRefresh riêng — gọi lại getToken() ở đây đóng vai trò tương đương: trả về token còn
 * hiệu lực hoặc cấp token mới nếu Firebase đã xoay vòng token cũ.
 */
export async function registerFcmToken(onForegroundMessage?: () => void): Promise<string | null> {
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
    await teacherMiniApi.fcm.save(token, "web");

    unsubscribeForeground?.();
    unsubscribeForeground = onMessage(messaging, () => onForegroundMessage?.());

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
