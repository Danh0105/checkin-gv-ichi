import { io, Socket } from "socket.io-client";

import { API_HOST } from "@/config/api";
import { TeachingNotification } from "@/types/teaching";

/** Giáo viên không bao giờ nhận teaching-checkin-alert:new (chỉ gửi Giáo vụ/Nhân sự) — cố tình không lắng nghe. */
const TEACHER_NOTIFICATION_EVENTS = [
  "teaching-schedule-notification:new",
  "teaching-schedule-confirm-request:new",
  "teaching-schedule-confirm-result:new",
  "teaching-schedule-confirm-alert:new",
  "teaching-lesson-report-alert:new",
] as const;

type NotificationListener = (notification: TeachingNotification) => void;
type ResyncListener = () => void;

let socket: Socket | null = null;
const notificationListeners = new Set<NotificationListener>();
const resyncListeners = new Set<ResyncListener>();
const seenNotificationIds = new Set<number>();

function rememberSeen(id: number) {
  seenNotificationIds.add(id);
  if (seenNotificationIds.size > 500) {
    const oldest = seenNotificationIds.values().next().value;
    if (oldest !== undefined) seenNotificationIds.delete(oldest);
  }
}

export function dispatchTeacherNotification(notification: TeachingNotification) {
  if (typeof notification?.id === "number") {
    if (seenNotificationIds.has(notification.id)) return false;
    rememberSeen(notification.id);
  }
  notificationListeners.forEach((listener) => listener(notification));
  return true;
}

/** Đánh dấu một id đã xử lý để dedupe với FCM foreground (xem services/fcm.ts). */
export function markNotificationSeen(id: number) {
  rememberSeen(id);
}

export function hasSeenNotification(id: number) {
  return seenNotificationIds.has(id);
}

/**
 * Không xác thực bằng JWT ở bước bắt tay — server nhận diện thuần bằng employeeId trong query
 * và tự join phòng `user_<employeeId>`, không cần emit gì thêm.
 */
export function connectSocket(employeeId: number): Socket {
  if (socket) disconnectSocket();
  socket = io(API_HOST, {
    transports: ["websocket", "polling"],
    query: { employeeId: String(employeeId) },
  });
  TEACHER_NOTIFICATION_EVENTS.forEach((event) => socket?.on(event, dispatchTeacherNotification));
  socket.on("connect", () => resyncListeners.forEach((listener) => listener()));
  return socket;
}

export function disconnectSocket() {
  if (!socket) return;
  TEACHER_NOTIFICATION_EVENTS.forEach((event) => socket?.off(event, dispatchTeacherNotification));
  socket.disconnect();
  socket = null;
}

export function onTeacherNotification(listener: NotificationListener) {
  notificationListeners.add(listener);
  return () => { notificationListeners.delete(listener); };
}

/** Bắn khi socket connect lần đầu hoặc reconnect sau mất mạng — dùng để tự đồng bộ lại unread-count. */
export function onSocketResync(listener: ResyncListener) {
  resyncListeners.add(listener);
  return () => { resyncListeners.delete(listener); };
}
