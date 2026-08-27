/** giaovien_congty (giáo viên công ty) và giaovien_ctv (giáo viên CTV) — cùng quyền hạn như nhau ở mọi nơi hiện tại, tách ra từ role "giaovien" cũ phía backend. */
export type TeacherRole = "giaovien_congty" | "giaovien_ctv";
export const TEACHER_ROLES: readonly TeacherRole[] = ["giaovien_congty", "giaovien_ctv"];

export type TeachingRole =
  | "nhansu"
  | TeacherRole
  | "director"
  | "director_la"
  | "troly_gd"
  | "ketoan_truong"
  | "sales";

export const isTeacherRole = (role: string): role is TeacherRole => (TEACHER_ROLES as readonly string[]).includes(role);
export const hasTeacherRole = (roles: readonly string[] | null | undefined) => roles?.some(isTeacherRole) ?? false;

export type SessionStatus = "SCHEDULED" | "PRESENT" | "ABSENT" | "EXCUSED" | "CANCELLED";
export type AssignmentStatus = "OPEN" | "ASSIGNED" | "CLOSED" | "CANCELLED";
export type ApplicationStatus = "PENDING" | "SELECTED" | "NOT_SELECTED" | "WITHDRAWN";

export interface AttendanceOtherCost {
  name: string;
  amount: number;
  note?: string | null;
}

export interface AttendancePayload {
  status: SessionStatus;
  attendanceNote?: string | null;
  otherCosts?: AttendanceOtherCost[];
}

export interface BulkAttendanceItem extends AttendancePayload {
  sessionId: number;
}

export interface AttendanceSummaryAmounts {
  payableAmount: number;
  otherCostsAmount: number;
  totalPayableAmount: number;
}

export interface AttendanceTeacherSummary extends AttendanceSummaryAmounts {
  teacherId: number;
  teacherName: string;
  presentSessions?: number;
}

export interface AttendanceSummary {
  /** Some API versions expose the teacher rows as `data`, others as `teachers`. */
  data?: AttendanceTeacherSummary[];
  teachers?: AttendanceTeacherSummary[];
  grandTotal: AttendanceSummaryAmounts;
}

export interface TeachingUser {
  id: number;
  name: string;
  phone?: string;
  email?: string;
  roles: TeachingRole[];
  /** Chỉ có với tài khoản role giáo viên (giaovien_congty/giaovien_ctv) đã liên kết Zalo. */
  zaloUid?: string;
  zaloId?: string;
}

export interface Teacher {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  employeeId: number | null;
  employeeName: string | null;
  isActive: boolean;
  note: string | null;
  googleMapsUrl?: string | null;
  schoolIds?: number[];
  subjectCatalogIds?: number[];
  maxPeriodsPerWeek?: number | null;
  defaultRatePerPeriod?: number | null;
  /** Vị trí đã được duyệt/ghi nhận, dùng để so khoảng cách khi check-in. null = chưa từng khai. */
  latitude?: number | null;
  longitude?: number | null;
  /** "pending" = đang có yêu cầu đổi vị trí chờ Giáo vụ/Nhân sự xử lý. */
  locationChangeStatus?: TeacherLocationRequestStatus | null;
  /** Vị trí mới đang chờ duyệt — chỉ có giá trị khi locationChangeStatus === "pending", KHÔNG dùng để chấm công. */
  pendingLocation?: TeacherPendingLocation | null;
}

export interface TeacherPendingLocation {
  latitude: number;
  longitude: number;
}

export type TeacherLocationRequestStatus = "pending" | "approved" | "rejected";

export type TeacherLocationUpdateResult =
  | { status: "captured"; requiresApproval: false; latitude: number; longitude: number }
  | { status: "pending"; requiresApproval: true; requestId: number };

export interface TeacherLocationChangeRequest {
  id: number;
  teacherId: number;
  teacherName?: string | null;
  latitude: number;
  longitude: number;
  status: TeacherLocationRequestStatus;
  createdAt: string;
  reviewedById?: number | null;
  reviewedByName?: string | null;
  reviewedAt?: string | null;
  rejectionReason?: string | null;
}

export interface TeachingSchedule {
  id: number;
  teacherId: number;
  teacherName: string;
  schoolId: number;
  schoolName: string;
  subjectId: number;
  subjectName: string;
  schoolYear: string | null;
  dayOfWeek: number;
  dayOfWeekLabel: string | null;
  startTime: string;
  endTime: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  note: string | null;
  confirmationStatus: TeachingConfirmationStatus;
  confirmedAt: string | null;
  rejectionReason: string | null;
}

export type TeachingConfirmationStatus = "PENDING" | "CONFIRMED" | "REJECTED";

export interface TeachingConfirmationPayload {
  status: "CONFIRMED" | "REJECTED";
  reason: string | null;
}

export interface LessonReportForm {
  lessonName: string;
  lessonEvaluation: string;
  actualStudentCount: number;
  evidenceFiles: File[];
}

export interface TeachingMedia {
  id?: number;
  url: string;
  name?: string | null;
  mimeType?: string;
  mediaType?: "video";
}

export interface TeachingSession {
  id: number;
  scheduleId: number | null;
  teacherId: number | null;
  teacherName: string | null;
  schoolId: number;
  schoolName: string;
  subjectId: number;
  subjectName: string;
  schoolYear: string | null;
  date: string;
  dayOfWeek: number;
  dayOfWeekLabel: string | null;
  startTime: string;
  endTime: string;
  status: SessionStatus;
  statusLabel: string | null;
  assignmentStatus: AssignmentStatus;
  confirmationStatus: TeachingConfirmationStatus;
  confirmedAt: string | null;
  rejectionReason: string | null;
  /** Whether this session starts a same-school block and needs its own GPS check-in. */
  checkinRequired?: boolean;
  /** Whether this session ends a same-school block and needs a GPS check-out. */
  checkoutRequired?: boolean;
  checkinAt: string | null;
  checkinImages?: Array<{ id: number; url: string }>;
  declinedAt: string | null;
  declineReason: string | null;
  declinedTeacherId: number | null;
  declinedTeacherName: string | null;
  isMakeup: boolean;
  makeupForSessionId: number | null;
  attendanceNote: string | null;
  checkedById: number | null;
  checkedByName: string | null;
  checkedAt: string | null;
  note: string | null;
  className?: string | null;
  periods?: number | null;
  ratePerPeriod?: number | null;
  amount?: number | null;
  /** Optional so cached sessions from before the API rollout remain readable. */
  otherCosts?: AttendanceOtherCost[];
  otherCostsTotal?: number;
  totalAmount?: number;
  schoolLatitude?: number | null;
  schoolLongitude?: number | null;
  schoolCheckinRadius?: number | null;
  checkinDistance?: number | null;
  checkinOutOfRange?: boolean | null;
  checkoutAt?: string | null;
  checkoutDistance?: number | null;
  checkoutOutOfRange?: boolean | null;
  lessonName?: string | null;
  lessonEvaluation?: string | null;
  actualStudentCount?: number | null;
  lessonImages?: Array<string | TeachingMedia>;
  lessonSubmittedAt?: string | null;
  lessonReportDueAt?: string | null;
  applicationCount?: number;
  hasApplied?: boolean;
  myApplicationStatus?: ApplicationStatus | null;
}

export interface TeachingNotificationMeta {
  kind?: string;
  module?: string;
  sessionId?: number;
  sessionIds?: number[];
  scheduleId?: number;
  entityType?: "schedule" | "session";
  status?: TeachingConfirmationStatus | TeacherLocationRequestStatus;
  requestId?: number;
  reason?: string;
  date?: string;
  route?: string;
  url?: string;
  path?: string;
  teacherId?: number;
  /** TEACHER_LOCATION_CHANGE_RESULT: true = đã duyệt, false = đã từ chối (lý do nằm trong message). */
  approved?: boolean;
}

export interface TeachingNotification {
  id: number;
  type?: string | null;
  title?: string | null;
  message?: string | null;
  content?: string | null;
  isRead?: boolean;
  createdAt?: string | null;
  metadata?: TeachingNotificationMeta | null;
  meta?: TeachingNotificationMeta | null;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ListResponse<T> {
  data: T[];
  pagination: Pagination;
}

export const isTeacher = (user: TeachingUser | null) => hasTeacherRole(user?.roles);
