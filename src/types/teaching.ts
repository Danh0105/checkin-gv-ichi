export type TeachingRole =
  | "nhansu"
  | "giaovien"
  | "director"
  | "director_la"
  | "troly_gd"
  | "ketoan_truong"
  | "sales";

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
  /** Chỉ có với tài khoản role "giaovien" đã liên kết Zalo. */
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
  status?: TeachingConfirmationStatus;
  reason?: string;
  date?: string;
  route?: string;
  url?: string;
  path?: string;
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

export const isTeacher = (user: TeachingUser | null) => user?.roles?.includes("giaovien") ?? false;
