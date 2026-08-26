import { API_HOST } from "@/config/api";
import { clearAccessToken, emitUnauthorized, getAccessToken } from "@/services/auth-session";
import {
  AttendancePayload,
  AttendanceSummary,
  BulkAttendanceItem,
  LessonReportForm,
  ListResponse,
  Teacher,
  TeachingConfirmationPayload,
  TeachingNotification,
  TeachingSchedule,
  TeachingSession,
  TeachingUser,
} from "@/types/teaching";
import { GeoPosition } from "@/utils/geo";

export class TeacherApiError extends Error {
  constructor(public status: number, message: string, public code: string | null = null) {
    super(message);
  }
}

const toQuery = (params: Record<string, string | number | boolean | undefined>) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => value !== undefined && query.set(key, String(value)));
  const result = query.toString();
  return result ? `?${result}` : "";
};

async function request<T>(path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
  const token = getAccessToken();
  const isMultipart = typeof FormData !== "undefined" && init.body instanceof FormData;
  try {
    const response = await fetch(`${API_HOST}${path}`, {
      ...init,
      headers: {
        ...(init.body && !isMultipart ? { "Content-Type": "application/json" } : {}),
        ...(authenticated && token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });

    if (response.status === 401 && authenticated) {
      await clearAccessToken();
      emitUnauthorized();
      throw new TeacherApiError(401, "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.");
    }

    if (response.status === 204) return undefined as T;
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 403) throw new TeacherApiError(403, "Bạn không có quyền truy cập chức năng này");
      const rawMessage = payload?.message;
      const message = Array.isArray(rawMessage) ? rawMessage.join("\n") : rawMessage || "Có lỗi xảy ra, vui lòng thử lại";
      const rawCode = payload?.code ?? payload?.error?.code;
      throw new TeacherApiError(response.status, message, typeof rawCode === "string" ? rawCode : null);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    if (error instanceof TeacherApiError) throw error;
    throw new TeacherApiError(0, "Không thể kết nối máy chủ. Vui lòng kiểm tra mạng và thử lại.");
  }
}

export interface TeachingApplicationResult {
  id: number;
  status: "PENDING";
  distance: number | null;
  assignedPeriodsInWeek: number;
  pendingPeriodsInWeek: number;
  maxPeriodsPerWeek: number | null;
  remainingPeriodsInWeek: number | null;
}

export const teacherMiniApi = {
  auth: {
    login: (phone: string, password: string, zalo?: { uid: string; zaloId: string }) =>
      request<{ access_token: string; user: TeachingUser }>("/auth/login", { method: "POST", body: JSON.stringify({ phone, password, ...zalo }) }, false),
  },
  teacher: {
    me: () => request<Teacher>("/teachers/me"),
  },
  schedules: {
    me: (params: { isActive?: boolean; limit?: number } = {}) => request<ListResponse<TeachingSchedule>>(`/teaching-schedules/me${toQuery(params)}`),
    confirmation: (id: number, payload: TeachingConfirmationPayload) => request<TeachingSchedule>(`/teaching-schedules/${id}/confirmation`, { method: "PATCH", body: JSON.stringify(payload) }),
  },
  sessions: {
    me: (params: { fromDate: string; toDate: string; page?: number; limit?: number; status?: string; unchecked?: boolean }, signal?: AbortSignal) => request<ListResponse<TeachingSession>>(`/teaching-sessions/me${toQuery(params)}`, { signal }),
    get: (id: number, signal?: AbortSignal) => request<TeachingSession>(`/teaching-sessions/${id}`, { signal }),
    confirmation: (id: number, payload: TeachingConfirmationPayload) => request<TeachingSession>(`/teaching-sessions/${id}/confirmation`, { method: "PATCH", body: JSON.stringify(payload) }),
    open: (params: { fromDate: string; toDate: string; schoolId?: number; subjectId?: number; page?: number; limit?: number }) => request<ListResponse<TeachingSession>>(`/teaching-sessions/open${toQuery(params)}`),
    checkin: (id: number, position: GeoPosition, image: File) => {
      const formData = new FormData();
      formData.append("latitude", String(position.latitude));
      formData.append("longitude", String(position.longitude));
      formData.append("image", image);
      return request<TeachingSession>(`/teaching-sessions/${id}/checkin`, { method: "POST", body: formData });
    },
    checkout: (id: number, position: GeoPosition) => {
      const formData = new FormData();
      formData.append("latitude", String(position.latitude));
      formData.append("longitude", String(position.longitude));
      if (position.accuracy != null) formData.append("accuracy", String(position.accuracy));
      return request<TeachingSession>(`/teaching-sessions/${id}/checkout`, { method: "POST", body: formData });
    },
    lesson: (id: number, lesson: LessonReportForm) => {
      const formData = new FormData();
      formData.append("lessonName", lesson.lessonName.trim());
      formData.append("lessonEvaluation", lesson.lessonEvaluation.trim());
      formData.append("actualStudentCount", String(lesson.actualStudentCount));
      lesson.evidenceFiles.forEach((file) => formData.append("images", file));
      return request<TeachingSession>(`/teaching-sessions/${id}/lesson`, { method: "POST", body: formData });
    },
    decline: (id: number, reason: string) => request<TeachingSession>(`/teaching-sessions/${id}/decline`, { method: "POST", body: JSON.stringify({ reason: reason.trim() }) }),
    apply: (id: number, position: GeoPosition, note: string | null) => request<TeachingApplicationResult>(`/teaching-sessions/${id}/applications`, { method: "POST", body: JSON.stringify({ ...position, note }) }),
    withdraw: (id: number) => request<void>(`/teaching-sessions/${id}/applications/me`, { method: "DELETE" }),
  },
  notifications: {
    list: (tab: "unread" | "read", page = 1, limit = 20) => request<ListResponse<TeachingNotification>>(`/notifications/teaching-schedule${toQuery({ tab, page, limit })}`),
    unreadCount: async () => {
      const result = await request<{ count?: number; unreadCount?: number }>("/notifications/teaching-schedule/unread-count");
      return result.unreadCount ?? result.count ?? 0;
    },
    readAll: () => request<void>("/notifications/teaching-schedule/read-all", { method: "PATCH" }),
    read: (id: number) => request<void>(`/notifications/${id}/read`, { method: "PATCH" }),
  },
  fcm: {
    save: (token: string, platform: "android" | "ios" | "web") => request<void>("/employee-fcm-token/save", { method: "POST", body: JSON.stringify({ token, platform }) }),
    remove: (token: string) => request<{ removed: boolean }>("/employee-fcm-token", { method: "DELETE", body: JSON.stringify({ token }) }),
  },
};

export type AttendanceListParams = {
  fromDate: string;
  toDate: string;
  page?: number;
  limit?: number;
  teacherId?: number;
  schoolId?: number;
  status?: string;
};

/** API operations used by Nhân sự on Giảng dạy → Chấm công. */
export const attendanceAdminApi = {
  list: (params: AttendanceListParams, signal?: AbortSignal) =>
    request<ListResponse<TeachingSession>>(`/teaching-sessions${toQuery(params)}`, { signal }),
  update: (id: number, payload: AttendancePayload) =>
    request<TeachingSession>(`/teaching-sessions/${id}/attendance`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  bulkUpdate: (items: BulkAttendanceItem[]) =>
    request<TeachingSession[] | { data: TeachingSession[] }>("/teaching-sessions/attendance/bulk", {
      method: "PATCH",
      body: JSON.stringify({ items }),
    }),
  summary: (params: Pick<AttendanceListParams, "fromDate" | "toDate" | "teacherId" | "schoolId">, signal?: AbortSignal) =>
    request<AttendanceSummary>(`/teaching-sessions/attendance/summary${toQuery(params)}`, { signal }),
};
