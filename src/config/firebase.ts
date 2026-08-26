import { initializeApp, FirebaseApp } from "firebase/app";
import { getMessaging, isSupported, Messaging } from "firebase/messaging";

const firebaseConfig = {
  apiKey: (import.meta.env.VITE_FIREBASE_API_KEY as string | undefined)?.trim() || "",
  authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined)?.trim() || "",
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined)?.trim() || "",
  storageBucket: (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined)?.trim() || "",
  messagingSenderId: (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined)?.trim() || "",
  appId: (import.meta.env.VITE_FIREBASE_APP_ID as string | undefined)?.trim() || "",
};

/** Khoá VAPID dùng để lấy FCM registration token cho web push (Firebase Console > Cloud Messaging). */
export const FIREBASE_VAPID_KEY = (import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined)?.trim() || "";

export const isFirebaseConfigured = Object.values(firebaseConfig).every((value) => value.length > 0);

/** Query string để truyền config cho service worker tĩnh (public/firebase-messaging-sw.js không được Vite xử lý env). */
export function firebaseServiceWorkerQuery() {
  return new URLSearchParams(firebaseConfig).toString();
}

let app: FirebaseApp | null = null;
let messagingPromise: Promise<Messaging | null> | null = null;

function getFirebaseApp() {
  if (!isFirebaseConfigured) return null;
  if (!app) app = initializeApp(firebaseConfig);
  return app;
}

/** Trả về Messaging nếu môi trường hỗ trợ (Zalo Mini App chạy trong webview có thể không hỗ trợ Service Worker/Push). */
export function getFirebaseMessaging(): Promise<Messaging | null> {
  if (!messagingPromise) {
    messagingPromise = (async () => {
      const firebaseApp = getFirebaseApp();
      if (!firebaseApp || typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
      const supported = await isSupported().catch(() => false);
      return supported ? getMessaging(firebaseApp) : null;
    })();
  }
  return messagingPromise;
}
