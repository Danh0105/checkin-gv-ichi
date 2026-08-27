import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSnackbar } from "zmp-ui";

import Logo from "@/components/logo";
import { TeacherIncomeScreen } from "@/components/teacher-mini/TeacherIncomeScreen";
import { API_HOST } from "@/config/api";
import { clearPendingDraft, getPendingDraft, savePendingDraft } from "@/services/auth-session";
import { TeacherApiError, TeachingApplicationResult, teacherMiniApi } from "@/services/teacher-mini-api";
import { LessonReportForm, SessionStatus, Teacher, TeachingConfirmationStatus, TeachingNotification, TeachingSchedule, TeachingSession, TeachingUser } from "@/types/teaching";
import { CHECKIN_IMAGE_ACCEPT, formatLessonReportDue, isVideoFile, isVideoMedia, LESSON_EVIDENCE_ACCEPT, lessonReportTiming, validateCheckinImage, validateLessonEvidenceBatch } from "@/utils/lesson-report";
import { formatDistance, getCurrentPosition, haversineDistance } from "@/utils/geo";
import { getSessionAttendanceAction, sessionAttendanceLabel } from "@/utils/session-attendance";
import { onSocketResync, onTeacherNotification } from "@/services/socket";

type MiniTab = "schedule" | "attendance" | "income" | "open";
type ScheduleMode = "day" | "week" | "month";
type ToastTone = "success" | "error" | "warning";
type PendingDraft = { type: "decline" | "application"; sessionId: number; text: string; session?: TeachingSession };
type LocationActionPhase = "locating" | "submitting" | null;
type LessonNotificationTarget = { date: string; sessionIds: number[] };
type ConfirmationNavigationTarget = { entityType?: "schedule" | "session"; scheduleId?: number; sessionId?: number; urgent?: boolean; notificationId?: number };
type ConfirmationTarget = { entityType: "schedule"; item: TeachingSchedule } | { entityType: "session"; item: TeachingSession };

const pad = (value: number) => String(value).padStart(2, "0");
const toISO = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const fromISO = (value: string) => { const [year, month, day] = value.split("-").map(Number); return new Date(year, month - 1, day); };
const addDays = (date: Date, amount: number) => { const result = new Date(date); result.setDate(result.getDate() + amount); return result; };
const getMonday = (date: Date) => { const result = new Date(date.getFullYear(), date.getMonth(), date.getDate()); const day = result.getDay() || 7; result.setDate(result.getDate() - day + 1); return result; };
const formatDate = (value: string) => { const [year, month, day] = value.split("-"); return `${day}/${month}/${year}`; };
const formatTime = (value: string) => value.slice(0, 5);
const dayOfWeek = (date: Date) => date.getDay() === 0 ? 8 : date.getDay() + 1;
const dayLabel = (value: number) => ({ 2: "Thứ Hai", 3: "Thứ Ba", 4: "Thứ Tư", 5: "Thứ Năm", 6: "Thứ Sáu", 7: "Thứ Bảy", 8: "Chủ Nhật" }[value] ?? "");
const statusLabel: Record<SessionStatus, string> = { SCHEDULED: "Chưa chấm", PRESENT: "Có dạy", ABSENT: "Vắng", EXCUSED: "Nghỉ có phép", CANCELLED: "Đã huỷ" };
const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
const periodsOf = (session: Pick<TeachingSession, "periods" | "startTime" | "endTime">) => session.periods ?? Math.max(1, Math.round((minutes(session.endTime) - minutes(session.startTime)) / 45));
const money = (value: number | null | undefined) => value === null || value === undefined ? "Chưa khai giá" : `${value.toLocaleString("vi-VN")} ₫`;
const useMinuteClock = () => { const [now, setNow] = useState(Date.now()); useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, []); return now; };
const resolveMediaUrl = (url: string) => { const value = url.trim(); if (!value || /^(https?:|blob:|data:)/i.test(value)) return value; if (value.startsWith("//")) return `https:${value}`; return `${API_HOST}/${value.replace(/^\/+/, "")}`; };

export function mergeSessionAfterMutation(fresh: TeachingSession, mutation?: TeachingSession) {
  if (!mutation) return fresh;
  return {
    ...fresh,
    ...mutation,
    checkinImages: fresh.checkinImages?.length ? fresh.checkinImages : mutation.checkinImages,
    lessonImages: fresh.lessonImages?.length ? fresh.lessonImages : mutation.lessonImages,
  };
}

function getRange(date: Date, mode: ScheduleMode) {
  if (mode === "day") return { from: toISO(date), to: toISO(date) };
  if (mode === "week") { const monday = getMonday(date); return { from: toISO(monday), to: toISO(addDays(monday, 6)) }; }
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { from: toISO(getMonday(first)), to: toISO(addDays(getMonday(last), 6)) };
}

function formatScheduleDate(date: Date, mode: ScheduleMode) {
  if (mode === "day") return formatDate(toISO(date));
  if (mode === "month") return `Tháng ${date.getMonth() + 1}/${date.getFullYear()}`;
  const range = getRange(date, "week");
  return `Tuần ${formatDate(range.from)} – ${formatDate(range.to)}`;
}

function explainError(error: unknown, notify: (message: string, tone?: ToastTone) => void, onProfileMissing?: () => void) {
  if (error instanceof TeacherApiError && error.status === 404 && onProfileMissing) { onProfileMissing(); return; }
  if (error instanceof TeacherApiError && error.status === 401) return;
  notify(error instanceof Error ? error.message : "Có lỗi xảy ra, vui lòng thử lại", "error");
}

function MiniIcon({ name }: { name: "calendar" | "pin" | "income" | "open" | "bell" | "logout" | "clock" | "home" }) {
  const value = { calendar: "▦", pin: "⌖", income: "₫", open: "◇", bell: "♢", logout: "↪", clock: "◷", home: "⌂" }[name];
  return <span className={`mini-icon icon-${name}`} aria-hidden>{value}</span>;
}

function NotificationIcon({ name, size = 22 }: { name: "bell" | "calendar" | "clock" | "home" | "logout"; size?: number }) {
  const paths: Record<"bell" | "calendar" | "clock" | "home" | "logout", ReactNode> = {
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    home: <><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10M9 20v-6h6v6" /></>,
    logout: <><path d="M10 17l5-5-5-5m5 5H3" /><path d="M14 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5" /></>,
  };
  return <svg className="notification-svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{paths[name]}</svg>;
}

type CellBadge = { key: string; label: string; tone: "done" | "pending" | "warn" };

function cellStatusBadges(session: TeachingSession): CellBadge[] {
  if (session.status === "CANCELLED") return [];
  const badges: CellBadge[] = [];
  if (session.checkinRequired) badges.push(session.checkinAt ? { key: "in", label: "Đã check-in", tone: "done" } : { key: "in", label: "Chưa check-in", tone: "pending" });
  if (session.checkoutRequired) badges.push(session.checkoutAt ? { key: "out", label: "Đã check-out", tone: "done" } : { key: "out", label: "Chưa check-out", tone: "pending" });
  if (session.checkoutAt) badges.push(session.lessonSubmittedAt ? { key: "lesson", label: "Đã báo giảng", tone: "done" } : { key: "lesson", label: "Chưa báo giảng", tone: lessonReportTiming(session).overdue ? "warn" : "pending" });
  return badges;
}

function CellBadges({ session }: { session: TeachingSession }) {
  const badges = cellStatusBadges(session);
  if (!badges.length) return null;
  return <span className="cell-status-badges">{badges.map((badge) => <span key={badge.key} className={`cell-badge tone-${badge.tone}`}>{badge.label}</span>)}</span>;
}

function StatusChip({ session }: { session: TeachingSession }) {
  if (session.confirmationStatus === "PENDING") return <span className="teacher-status status-confirmation-pending">Chờ xác nhận</span>;
  if (session.confirmationStatus === "REJECTED") return <span className="teacher-status status-confirmation-rejected">Đã từ chối</span>;
  if (session.lessonSubmittedAt) return <span className="teacher-status status-present">Đã báo giảng</span>;
  if (session.checkoutAt) return <span className="teacher-status status-present">Đã chấm công</span>;
  if (session.checkinAt) return <span className="teacher-status status-checked-in">Đã check-in</span>;
  if (session.confirmationStatus === "CONFIRMED") return <span className="teacher-status status-confirmation-confirmed">Đã xác nhận</span>;
  return <span className={`teacher-status status-${session.status.toLowerCase()}`}>{session.statusLabel || statusLabel[session.status]}</span>;
}

function TimetableConfirmationMark({ session, planned }: { session: TeachingSession; planned: boolean }) {
  if (session.confirmationStatus === "CONFIRMED") return <em className="confirmation-confirmed">✓ Đã xác nhận</em>;
  if (session.confirmationStatus === "REJECTED") return <em className="confirmation-rejected">Đã từ chối</em>;
  if (session.confirmationStatus === "PENDING") return <em className="confirmation-pending">{planned ? "Dự kiến · Bấm để xác nhận" : "Chờ xác nhận"}</em>;
  return planned ? <em>Dự kiến</em> : null;
}

function Sheet({ title, children, onClose, className = "", closeDisabled = false }: { title: ReactNode; children: ReactNode; onClose: () => void; className?: string; closeDisabled?: boolean }) {
  return <div className="mini-sheet-backdrop" onMouseDown={(event) => !closeDisabled && event.target === event.currentTarget && onClose()}><section className={`mini-sheet ${className}`} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}><header><div className="sheet-handle" /><h2>{title}</h2><button onClick={onClose} aria-label="Đóng" disabled={closeDisabled}>×</button></header>{children}</section></div>;
}

function EmptyProfile() {
  return <div className="teacher-empty"><div className="empty-round">♙</div><h2>Chưa có hồ sơ giáo viên</h2><p>Tài khoản của bạn chưa được phòng Nhân sự gắn với hồ sơ giáo viên. Vui lòng liên hệ phòng Nhân sự.</p></div>;
}

function LoadingCards() {
  return <div className="mini-loading-list">{[1, 2, 3].map((item) => <div key={item}><span /><span /><span /></div>)}</div>;
}

const confirmationKey = (target: ConfirmationTarget) => `${target.entityType}-${target.item.id}`;
const confirmationStatusLabel: Record<TeachingConfirmationStatus, string> = { PENDING: "Chờ xác nhận", CONFIRMED: "Đã xác nhận", REJECTED: "Đã từ chối" };

export function ConfirmationCard({ target, busy = false, highlighted = false, onConfirm, onReject }: { target: ConfirmationTarget; busy?: boolean; highlighted?: boolean; onConfirm: (target: ConfirmationTarget) => void; onReject: (target: ConfirmationTarget) => void }) {
  const { item, entityType } = target;
  const isSchedule = entityType === "schedule";
  const status = item.confirmationStatus;
  const schedule = isSchedule ? item : null;
  const session = !isSchedule ? item : null;
  return <article className={`confirmation-card status-${status.toLowerCase()} ${highlighted ? "confirmation-highlight" : ""}`} data-confirmation-key={confirmationKey(target)}>
    <header><span>{isSchedule ? "Lịch lặp" : "Buổi lẻ"}</span><b className={`confirmation-status status-${status.toLowerCase()}`}>{confirmationStatusLabel[status]}</b></header>
    <h3>{item.subjectName} · {item.schoolName}</h3>
    <p>{isSchedule ? `${item.dayOfWeekLabel || dayLabel(item.dayOfWeek)}, ${formatTime(item.startTime)}–${formatTime(item.endTime)}` : `${formatDate(session!.date)}, ${formatTime(item.startTime)}–${formatTime(item.endTime)}`}</p>
    {schedule && <small>Hiệu lực {formatDate(schedule.effectiveFrom)}{schedule.effectiveTo ? ` – ${formatDate(schedule.effectiveTo)}` : " trở đi"}</small>}
    {status === "REJECTED" && <div className="confirmation-reason"><b>Lý do từ chối:</b> {item.rejectionReason || "—"}</div>}
    {status === "PENDING" && <footer><button type="button" className="confirmation-accept" disabled={busy} onClick={() => onConfirm(target)}>{busy ? "Đang xử lý…" : "Xác nhận"}</button><button type="button" className="confirmation-reject" disabled={busy} onClick={() => onReject(target)}>Từ chối</button></footer>}
  </article>;
}

export function ConfirmationRejectSheet({ target, onClose, onSubmit }: { target: ConfirmationTarget; onClose: () => void; onSubmit: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = reason.trim();
    if (text.length < 5) { setError("Lý do phải có ít nhất 5 ký tự"); return; }
    if (text.length > 1000) { setError("Lý do không được vượt quá 1000 ký tự"); return; }
    setSubmitting(true);
    setError("");
    try { await onSubmit(text); onClose(); }
    catch (submitError) {
      if (submitError instanceof TeacherApiError && submitError.status === 409) setError("Lịch dạy này đã được xử lý. Trạng thái mới nhất đã được cập nhật.");
      else if (submitError instanceof TeacherApiError && submitError.status === 403) setError("Bạn không có quyền xử lý lịch dạy này.");
      else setError(submitError instanceof Error ? submitError.message : "Không thể gửi phản hồi. Vui lòng thử lại.");
    } finally { setSubmitting(false); }
  };
  return <Sheet title="Từ chối lịch dạy" onClose={onClose} closeDisabled={submitting}><form className="mini-form confirmation-reject-form" onSubmit={submit}><div className="sheet-session-summary"><b>{target.item.subjectName} · {target.item.schoolName}</b><span>{target.entityType === "schedule" ? `${target.item.dayOfWeekLabel || dayLabel(target.item.dayOfWeek)}, ${formatTime(target.item.startTime)}–${formatTime(target.item.endTime)}` : `${formatDate(target.item.date)} · ${formatTime(target.item.startTime)}–${formatTime(target.item.endTime)}`}</span></div><label>Lý do từ chối <b>*</b><textarea aria-label="Lý do từ chối" aria-invalid={Boolean(error)} maxLength={1000} rows={5} value={reason} onChange={(event) => { setReason(event.target.value); setError(""); }} placeholder="Ví dụ: Tôi đã có lịch công tác trùng thời gian này" /><small className={reason.length >= 1000 ? "over-limit" : ""}>{reason.length}/1000</small></label>{error && <p className="mini-form-error" role="alert">{error}</p>}<button className="mini-danger-button" disabled={submitting}>{submitting ? "Đang gửi…" : "Xác nhận từ chối"}</button></form></Sheet>;
}

function SessionCard({ session, planned = false, onClick }: { session: TeachingSession; planned?: boolean; onClick?: () => void }) {
  return <button type="button" disabled={!onClick} onClick={onClick} className={`teacher-session-card ${planned ? "planned" : ""}`}>
    <div className="session-time"><strong>{formatTime(session.startTime)}</strong><span>{formatTime(session.endTime)}</span></div>
    <div className="session-main"><div><b>{session.subjectName}</b>{session.isMakeup && <span className="purple-chip">Dạy bù</span>}{planned && <span className="planned-chip">Dự kiến</span>}</div><span>{session.schoolName}</span><small>Lớp {session.className || "—"} · {periodsOf(session)} tiết</small></div>
    {planned ? <span className={`teacher-status status-confirmation-${session.confirmationStatus.toLowerCase()}`}>{session.confirmationStatus === "CONFIRMED" ? "Đã xác nhận" : session.confirmationStatus === "REJECTED" ? "Đã từ chối" : "Bấm để xác nhận"}</span> : <StatusChip session={session} />}
  </button>;
}

function WeeklyTimetable({ sessions, weekStart, schoolName, schoolYear, onSelect }: { sessions: TeachingSession[]; weekStart: string; schoolName: string; schoolYear: string; onSelect: (session: TeachingSession) => void }) {
  const monday = fromISO(weekStart);
  const days = Array.from({ length: 7 }, (_, index) => {
    const value = addDays(monday, index);
    return { date: toISO(value), label: dayLabel(dayOfWeek(value)) };
  });
  const standardSlots: { startTime: string; endTime: string; isBreak?: boolean }[] = [
    { startTime: "07:30", endTime: "08:10" },
    { startTime: "08:10", endTime: "08:50" },
    { startTime: "08:50", endTime: "09:20", isBreak: true },
    { startTime: "09:20", endTime: "10:00" },
    { startTime: "10:00", endTime: "10:40" },
    { startTime: "13:30", endTime: "14:05" },
    { startTime: "14:10", endTime: "14:45" },
    { startTime: "14:50", endTime: "15:20", isBreak: true },
    { startTime: "15:20", endTime: "16:00" },
  ];
  const slotMap = new Map(standardSlots.map((slot) => [`${slot.startTime}-${slot.endTime}`, slot]));
  sessions.forEach((session) => { const startTime = formatTime(session.startTime); const endTime = formatTime(session.endTime); const key = `${startTime}-${endTime}`; if (!slotMap.has(key)) slotMap.set(key, { startTime, endTime }); });
  const slots = Array.from(slotMap.values()).sort((a, b) => minutes(a.startTime) - minutes(b.startTime));
  let morningPeriod = 0;
  let afternoonPeriod = 0;
  const rows = slots.map((slot) => {
    const phase = minutes(slot.startTime) < 12 * 60 ? "SÁNG" : "CHIỀU";
    const period = slot.isBreak ? 0 : phase === "SÁNG" ? ++morningPeriod : ++afternoonPeriod;
    return { ...slot, phase, period, firstOfPhase: period === 1 };
  });

      return <div className="weekly-timetable-card"><div className="timetable-heading"><span>{schoolName}</span><div><b>TKB</b><small>NĂM HỌC <strong>{schoolYear}</strong></small></div><em>{formatDate(days[0].date)} – {formatDate(days[6].date)}</em></div><div className="timetable-scroll" role="region" aria-label="Thời khóa biểu tuần"><div className="teacher-timetable"><div className="timetable-row timetable-main-header"><div className="sticky-session">BUỔI</div><div className="sticky-period">TIẾT</div><div className="sticky-time">THỜI GIAN</div>{days.map((day) => <div key={day.date} className="timetable-day-heading"><b>{day.label}</b><span>{formatDate(day.date).slice(0, 5)}</span></div>)}</div><div className="timetable-row timetable-sub-header"><div className="sticky-session" /><div className="sticky-period" /><div className="sticky-time" />{days.map((day) => <div key={day.date}><span>Lớp</span><span>GV dạy</span></div>)}</div>{rows.map((row) => <div className={`timetable-row timetable-slot-row phase-${row.phase === "SÁNG" ? "morning" : "afternoon"} ${row.isBreak ? "timetable-break-row" : ""}`} key={`${row.startTime}-${row.endTime}`}><div className="sticky-session">{row.firstOfPhase ? row.phase : ""}</div><div className="sticky-period">{row.isBreak ? <span>RA<br />CHƠI</span> : row.period}</div><div className="sticky-time"><b>{row.startTime}</b><span>– {row.endTime}</span></div>{days.map((day) => { if (row.isBreak) return <div className="timetable-cell timetable-break-cell" key={day.date} />; const cellItems = sessions.filter((session) => session.date === day.date && formatTime(session.startTime) === row.startTime && formatTime(session.endTime) === row.endTime); return <div className="timetable-cell" key={day.date}>{cellItems.length ? cellItems.map((session) => { const planned = session.id < 0; return <button type="button" onClick={() => onSelect(session)} className={`${planned ? "planned" : "actual"} ${session.status === "CANCELLED" ? "cancelled" : ""}`} key={session.id}><span>{session.className || "—"}</span><b>{session.teacherName || "—"}</b><small>{session.subjectName} · {session.schoolName}</small><TimetableConfirmationMark session={session} planned={planned} />{!planned && <CellBadges session={session} />}</button>; }) : <span className="timetable-empty-cell">—</span>}</div>; })}</div>)}</div></div><div className="timetable-hint"><span className="actual" /> Buổi chính thức <span className="planned" /> Buổi dự kiến · Vuốt ngang để xem các ngày</div></div>;
}

function MonthCalendar({ sessions, monthDate, onSelectDate, onSelectSession }: { sessions: TeachingSession[]; monthDate: Date; onSelectDate: (date: Date) => void; onSelectSession: (session: TeachingSession) => void }) {
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const last = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
  const calendarStart = getMonday(first);
  const calendarEnd = addDays(getMonday(last), 6);
  const days: Date[] = [];
  for (let cursor = calendarStart; cursor <= calendarEnd; cursor = addDays(cursor, 1)) days.push(cursor);

  const selectedDate = toISO(monthDate);
  const today = toISO(new Date());
  const byDate = sessions.reduce<Record<string, TeachingSession[]>>((all, session) => { (all[session.date] ||= []).push(session); return all; }, {});
  const selectedSessions = byDate[selectedDate] || [];
  const eventClass = (session: TeachingSession) => session.id < 0 ? "planned" : session.status.toLowerCase();

  return <div className="month-calendar-view">
    <div className="month-calendar-legend" aria-label="Chú thích trạng thái">
      <span className="scheduled">Chưa chấm</span><span className="present">Có dạy</span><span className="absent">Vắng/nghỉ</span><span className="cancelled">Huỷ buổi</span><span className="planned">Dự kiến</span>
    </div>
    <div className="month-calendar" role="grid" aria-label={`Lịch tháng ${monthDate.getMonth() + 1}/${monthDate.getFullYear()}`}>
      {(["T2", "T3", "T4", "T5", "T6", "T7", "CN"] as const).map((label) => <div className={label === "CN" ? "sunday" : ""} role="columnheader" key={label}>{label}</div>)}
      {days.map((day) => {
        const dayISO = toISO(day);
        const daySessions = byDate[dayISO] || [];
        const outside = day.getMonth() !== monthDate.getMonth();
        return <button type="button" role="gridcell" className={`month-calendar-day ${outside ? "outside" : ""} ${dayISO === selectedDate ? "selected" : ""} ${dayISO === today ? "today" : ""} ${dayOfWeek(day) === 8 ? "sunday" : ""}`} aria-label={`${dayLabel(dayOfWeek(day))}, ${formatDate(dayISO)}, ${daySessions.length} buổi`} aria-selected={dayISO === selectedDate} onClick={() => onSelectDate(day)} key={dayISO}>
          <time dateTime={dayISO}>{day.getDate()}</time>
          <span className="month-day-events">{daySessions.slice(0, 2).map((session) => <span className={`month-day-event ${eventClass(session)}`} key={session.id}>{formatTime(session.startTime)} {session.subjectName}{session.confirmationStatus === "CONFIRMED" && <em aria-label="Đã xác nhận">✓</em>}</span>)}{daySessions.length > 2 && <small>+{daySessions.length - 2} buổi</small>}</span>
        </button>;
      })}
    </div>
    <section className="month-selected-sessions">
      <header><div><b>{dayLabel(dayOfWeek(monthDate))}, {formatDate(selectedDate)}</b><span>{selectedSessions.length} buổi</span></div></header>
      {selectedSessions.map((session) => <SessionCard key={session.id} session={session} planned={session.id < 0} onClick={() => onSelectSession(session)} />)}
      {!selectedSessions.length && <div className="month-day-empty">Không có buổi dạy trong ngày này</div>}
    </section>
  </div>;
}

function plannedFromSchedules(schedules: TeachingSchedule[], actual: TeachingSession[], fromDate: string, toDate: string) {
  const result: TeachingSession[] = [];
  const today = toISO(new Date());
  for (const schedule of schedules) {
    if (schedule.confirmationStatus === "REJECTED") continue;
    let cursor = fromISO(fromDate);
    const end = fromISO(toDate);
    while (cursor <= end) {
      const date = toISO(cursor);
      const withinEffective = date >= schedule.effectiveFrom && (!schedule.effectiveTo || date <= schedule.effectiveTo);
      const alreadyExists = actual.some((session) => session.date === date && (session.scheduleId === schedule.id || (session.subjectId === schedule.subjectId && formatTime(session.startTime) === formatTime(schedule.startTime))));
      if (date >= today && withinEffective && dayOfWeek(cursor) === schedule.dayOfWeek && !alreadyExists) {
        result.push({ id: -(schedule.id * 100000 + Number(date.replace(/-/g, ""))), scheduleId: schedule.id, teacherId: schedule.teacherId, teacherName: schedule.teacherName, schoolId: schedule.schoolId, schoolName: schedule.schoolName, subjectId: schedule.subjectId, subjectName: schedule.subjectName, schoolYear: schedule.schoolYear, date, dayOfWeek: schedule.dayOfWeek, dayOfWeekLabel: schedule.dayOfWeekLabel, startTime: schedule.startTime, endTime: schedule.endTime, status: "SCHEDULED", statusLabel: "Dự kiến", assignmentStatus: "ASSIGNED", confirmationStatus: schedule.confirmationStatus, confirmedAt: schedule.confirmedAt, rejectionReason: schedule.rejectionReason, checkinAt: null, declinedAt: null, declineReason: null, declinedTeacherId: null, declinedTeacherName: null, isMakeup: false, makeupForSessionId: null, attendanceNote: null, checkedById: null, checkedByName: null, checkedAt: null, note: schedule.note });
      }
      cursor = addDays(cursor, 1);
    }
  }
  return result;
}

function confirmAttendanceDistance(session: TeachingSession, position: Awaited<ReturnType<typeof getCurrentPosition>>) {
  if (session.schoolLatitude !== null && session.schoolLatitude !== undefined && session.schoolLongitude !== null && session.schoolLongitude !== undefined) {
    const distance = haversineDistance(position, { latitude: session.schoolLatitude, longitude: session.schoolLongitude });
    const radius = session.schoolCheckinRadius ?? 200;
    return distance <= radius || window.confirm(`Bạn đang cách trường ${formatDistance(distance)}, ngoài bán kính cho phép ${radius} m. Vẫn chấm công? Buổi này sẽ bị đánh dấu để Nhân sự xem lại.`);
  }
  return true;
}

function DeclineSheet({ session, onClose, onSuccess, notify }: { session: TeachingSession; onClose: () => void; onSuccess: (session: TeachingSession) => void; notify: (message: string, tone?: ToastTone) => void }) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { void getPendingDraft<PendingDraft>().then((draft) => { if (draft?.type === "decline" && draft.sessionId === session.id) setReason(draft.text); }); }, [session.id]);
  const change = (value: string) => { setReason(value); setError(""); void savePendingDraft({ type: "decline", sessionId: session.id, text: value, session } satisfies PendingDraft); };
  const submit = async (event: FormEvent) => { event.preventDefault(); const text = reason.trim(); if (text.length < 5 || text.length > 500) { setError("Lý do phải có từ 5 đến 500 ký tự"); return; } setSubmitting(true); try { const updated = await teacherMiniApi.sessions.decline(session.id, text); await clearPendingDraft(); onSuccess(updated); } catch (reasonError) { explainError(reasonError, notify); } finally { setSubmitting(false); } };

  return <Sheet title="Báo bận buổi dạy" onClose={() => { void clearPendingDraft(); onClose(); }}><form className="mini-form" onSubmit={submit}><div className="sheet-session-summary"><b>{session.subjectName} · {session.className || "—"}</b><span>{formatDate(session.date)} · {formatTime(session.startTime)}–{formatTime(session.endTime)}</span></div><label>Lý do không thể dạy <b>*</b><textarea maxLength={500} rows={5} value={reason} onChange={(event) => change(event.target.value)} placeholder="Nhập lý do để Nhân sự sắp xếp người thay thế" /><small>{reason.trim().length}/500</small></label>{error && <p className="mini-form-error">{error}</p>}<button className="mini-danger-button" disabled={submitting}>{submitting ? "Đang gửi..." : "Gửi yêu cầu người thay thế"}</button></form></Sheet>;
}

type FilePreview = { id: number; file: File; previewUrl: string };
type LessonFormErrors = { lessonName?: string; lessonEvaluation?: string; actualStudentCount?: string; evidence?: string };

const fileSizeLabel = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function CheckinSheet({ session, onClose, onSuccess, onNotRequired }: { session: TeachingSession; onClose: () => void; onSuccess: (session: TeachingSession) => void | Promise<void>; onNotRequired?: () => void | Promise<void> }) {
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<LocationActionPhase>(null);
  const fileRef = useRef<FilePreview | null>(null);
  const actionInFlight = useRef(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const schoolPosition = typeof session.schoolLatitude === "number" && Number.isFinite(session.schoolLatitude) && session.schoolLatitude >= -90 && session.schoolLatitude <= 90
    && typeof session.schoolLongitude === "number" && Number.isFinite(session.schoolLongitude) && session.schoolLongitude >= -180 && session.schoolLongitude <= 180
    ? { latitude: session.schoolLatitude, longitude: session.schoolLongitude }
    : null;
  const schoolMapsUrl = schoolPosition ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${schoolPosition.latitude},${schoolPosition.longitude}`)}` : null;

  useEffect(() => () => { if (fileRef.current) URL.revokeObjectURL(fileRef.current.previewUrl); }, []);
  const choose = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    const validation = validateCheckinImage(file);
    if (validation) { setError(validation); return; }
    if (fileRef.current) URL.revokeObjectURL(fileRef.current.previewUrl);
    const next = { id: Date.now(), file: file!, previewUrl: URL.createObjectURL(file!) };
    fileRef.current = next;
    setPreview(next);
    setError("");
  };
  const close = () => { if (!progress) onClose(); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (actionInFlight.current) return;
    const validation = validateCheckinImage(preview?.file ?? null);
    if (validation) { setError(validation); return; }
    actionInFlight.current = true;
    setProgress("locating");
    try {
      const position = await getCurrentPosition();
      if (!confirmAttendanceDistance(session, position)) { setError("Đã huỷ thao tác Check-in."); return; }
      setProgress("submitting");
      const updated = await teacherMiniApi.sessions.checkin(session.id, position, preview!.file);
      await onSuccess(updated);
    } catch (reason) {
      if (reason instanceof TeacherApiError && reason.code === "TEACHING_SESSION_CHECKIN_IMAGE_REQUIRED") setError("Vui lòng chụp ảnh khi check-in");
      else if (reason instanceof TeacherApiError && reason.code === "TEACHING_SESSION_CHECKIN_IMAGE_TYPE_UNSUPPORTED") setError("Ảnh phải là JPEG, PNG hoặc WebP");
      else if (reason instanceof TeacherApiError && reason.code === "TEACHING_SESSION_CHECKIN_NOT_REQUIRED") { await onNotRequired?.(); onClose(); }
      else setError(reason instanceof Error ? reason.message : "Không thể Check-in. Vui lòng thử lại.");
    } finally { actionInFlight.current = false; setProgress(null); }
  };
  const progressText = progress === "locating" ? "Đang xác định vị trí…" : progress === "submitting" ? "Đang tải ảnh Check-in…" : null;
  return <Sheet title="Check-in buổi dạy" onClose={close} closeDisabled={progress !== null}><form className="mini-form checkin-photo-form" onSubmit={submit}>
    <div className="sheet-session-summary"><b>{session.subjectName} · {session.className || "—"}</b><span>{formatDate(session.date)} · {formatTime(session.startTime)}–{formatTime(session.endTime)}</span></div>
    <section className={`checkin-school-location ${schoolPosition ? "" : "missing"}`} aria-label="Vị trí trường"><span className="checkin-school-pin" aria-hidden>⌖</span><div><small>Vị trí trường</small><b>{session.schoolName}</b>{schoolPosition ? <span>{schoolPosition.latitude.toFixed(6)}, {schoolPosition.longitude.toFixed(6)} · Bán kính {session.schoolCheckinRadius ?? 200} m</span> : <span>Trường chưa được cấu hình tọa độ</span>}</div>{schoolMapsUrl && <a href={schoolMapsUrl} target="_blank" rel="noreferrer">Xem trên Google Maps ↗</a>}</section>
    <p className="checkin-photo-help">Chụp một ảnh tại điểm trường để xác nhận Check-in.</p>
    {preview && <figure className="checkin-photo-preview"><img src={preview.previewUrl} alt="Ảnh Check-in đã chọn" /><figcaption>{preview.file.name} · {fileSizeLabel(preview.file.size)}</figcaption></figure>}
    <div className="lesson-image-actions"><button type="button" onClick={() => cameraRef.current?.click()}>{preview ? "Chụp lại" : "Chụp ảnh"}</button><button type="button" onClick={() => libraryRef.current?.click()}>Chọn từ thư viện</button></div>
    <input ref={cameraRef} className="lesson-image-input" type="file" accept={CHECKIN_IMAGE_ACCEPT} capture="environment" aria-label="Chụp ảnh Check-in" onChange={choose} />
    <input ref={libraryRef} className="lesson-image-input" type="file" accept={CHECKIN_IMAGE_ACCEPT} aria-label="Chọn ảnh Check-in từ thư viện" onChange={choose} />
    {error && <p className="mini-form-error" role="alert">{error}</p>}
    <button className="mini-primary-button checkin-submit-button" disabled={progress !== null}>{progress && <span className="mini-action-spinner" aria-hidden />}{progressText || "Xác nhận Check-in"}</button>
  </form></Sheet>;
}

export function LessonReportSheet({ session, onClose, onSuccess, onAlreadySubmitted, onDeadlineExpired }: { session: TeachingSession; onClose: () => void; onSuccess: (session: TeachingSession) => void | Promise<void>; onAlreadySubmitted?: () => void | Promise<void>; onDeadlineExpired?: () => void | Promise<void> }) {
  const [lessonName, setLessonName] = useState("");
  const [lessonEvaluation, setLessonEvaluation] = useState("");
  const [actualStudentCount, setActualStudentCount] = useState("");
  const [files, setFiles] = useState<FilePreview[]>([]);
  const [errors, setErrors] = useState<LessonFormErrors>({});
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const evaluationRef = useRef<HTMLTextAreaElement>(null);
  const countRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const actionInFlight = useRef(false);
  const sequence = useRef(0);
  const filesRef = useRef<FilePreview[]>([]);

  useEffect(() => () => { filesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl)); }, []);
  const close = () => { if (!submitting) onClose(); };
  const choose = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    const validation = validateLessonEvidenceBatch(files.length, selected);
    if (validation) { setErrors((current) => ({ ...current, evidence: validation })); return; }
    const additions = selected.map((file) => ({ id: ++sequence.current, file, previewUrl: URL.createObjectURL(file) }));
    setFiles((current) => { const next = [...current, ...additions]; filesRef.current = next; return next; });
    setErrors((current) => ({ ...current, evidence: undefined }));
    setSubmitError("");
  };
  const remove = (id: number) => setFiles((current) => {
    const removed = current.find((item) => item.id === id);
    if (removed) URL.revokeObjectURL(removed.previewUrl);
    const next = current.filter((item) => item.id !== id);
    filesRef.current = next;
    return next;
  });
  const validate = () => {
    const next: LessonFormErrors = {};
    const name = lessonName.trim();
    const evaluation = lessonEvaluation.trim();
    if (!name) next.lessonName = "Vui lòng nhập tên bài học."; else if (name.length > 255) next.lessonName = "Tên bài học không được vượt quá 255 ký tự.";
    if (!evaluation) next.lessonEvaluation = "Vui lòng nhập đánh giá buổi học."; else if (evaluation.length > 2000) next.lessonEvaluation = "Đánh giá không được vượt quá 2000 ký tự.";
    if (!/^\d+$/.test(actualStudentCount)) next.actualStudentCount = "Sĩ số phải là số nguyên không âm.";
    if (!files.length) next.evidence = "Vui lòng tải lên ít nhất một ảnh hoặc video minh chứng";
    setErrors(next);
    if (next.lessonName) nameRef.current?.focus(); else if (next.lessonEvaluation) evaluationRef.current?.focus(); else if (next.actualStudentCount) countRef.current?.focus();
    return Object.keys(next).length === 0;
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (actionInFlight.current || !validate()) return;
    actionInFlight.current = true;
    setSubmitting(true);
    setSubmitError("");
    try {
      const form: LessonReportForm = { lessonName: lessonName.trim(), lessonEvaluation: lessonEvaluation.trim(), actualStudentCount: Number(actualStudentCount), evidenceFiles: files.map((item) => item.file) };
      const updated = await teacherMiniApi.sessions.lesson(session.id, form);
      await onSuccess(updated);
    } catch (reason) {
      const code = reason instanceof TeacherApiError ? reason.code : null;
      if (code === "TEACHING_SESSION_LESSON_ALREADY_SUBMITTED") { await onAlreadySubmitted?.(); onClose(); return; }
      if (code === "TEACHING_SESSION_LESSON_DEADLINE_EXPIRED") await onDeadlineExpired?.();
      const mapped: Record<string, string> = {
        TEACHING_SESSION_NOT_ATTENDED: "Tiết dạy chưa hoàn tất chấm công",
        TEACHING_SESSION_LESSON_EVIDENCE_REQUIRED: "Vui lòng tải lên ít nhất một ảnh hoặc video minh chứng",
        TEACHING_SESSION_LESSON_ALREADY_SUBMITTED: "Tiết này đã báo giảng",
        TEACHING_SESSION_LESSON_DEADLINE_EXPIRED: "Đã quá hạn báo giảng lúc 08:00 ngày hôm sau",
        LESSON_IMAGE_TOO_LARGE: "Mỗi ảnh hoặc video không được vượt quá 50 MB",
        LESSON_IMAGE_LIMIT_EXCEEDED: "Chỉ được tải lên tối đa 10 file",
      };
      setSubmitError(code && mapped[code] ? mapped[code] : reason instanceof Error ? reason.message : "Không thể gửi báo giảng. Vui lòng thử lại.");
    } finally { actionInFlight.current = false; setSubmitting(false); }
  };
  return <Sheet title="Báo giảng" onClose={close} closeDisabled={submitting} className="checkout-lesson-sheet"><form className="mini-form checkout-lesson-form" onSubmit={submit} noValidate>
    <div className="sheet-session-summary"><b>{session.subjectName} · {session.className || "—"}</b><span>{formatDate(session.date)} · {formatTime(session.startTime)}–{formatTime(session.endTime)}</span></div>
    <label htmlFor="lesson-report-name">Tên bài học <b>*</b><input ref={nameRef} id="lesson-report-name" value={lessonName} disabled={submitting} onChange={(event) => { setLessonName(event.target.value); setErrors((current) => ({ ...current, lessonName: undefined })); }} /><small>{lessonName.trim().length}/255</small></label>
    {errors.lessonName && <p className="checkout-field-error" role="alert">{errors.lessonName}</p>}
    <label htmlFor="lesson-report-evaluation">Đánh giá buổi học <b>*</b><textarea ref={evaluationRef} id="lesson-report-evaluation" rows={5} value={lessonEvaluation} disabled={submitting} onChange={(event) => { setLessonEvaluation(event.target.value); setErrors((current) => ({ ...current, lessonEvaluation: undefined })); }} /><small>{lessonEvaluation.trim().length}/2000</small></label>
    {errors.lessonEvaluation && <p className="checkout-field-error" role="alert">{errors.lessonEvaluation}</p>}
    <label htmlFor="lesson-report-count">Sĩ số thực tế <b>*</b><input ref={countRef} id="lesson-report-count" type="number" inputMode="numeric" min="0" step="1" value={actualStudentCount} disabled={submitting} onChange={(event) => { setActualStudentCount(event.target.value); setErrors((current) => ({ ...current, actualStudentCount: undefined })); }} /></label>
    {errors.actualStudentCount && <p className="checkout-field-error" role="alert">{errors.actualStudentCount}</p>}
    <fieldset className="lesson-images-fieldset" disabled={submitting}><legend>Ảnh/video minh chứng <b>*</b></legend><p>Từ 1 đến 10 file JPEG, PNG, WebP, MP4, MOV hoặc WebM; tối đa 50 MB/file.</p><div className="lesson-image-actions"><button type="button" onClick={() => inputRef.current?.click()}>Chọn ảnh/video</button><button type="button" onClick={() => cameraRef.current?.click()}>Mở camera</button></div><input ref={inputRef} className="lesson-image-input" type="file" accept={LESSON_EVIDENCE_ACCEPT} multiple aria-label="Chọn ảnh hoặc video minh chứng" onChange={choose} /><input ref={cameraRef} className="lesson-image-input" type="file" accept={LESSON_EVIDENCE_ACCEPT} capture="environment" aria-label="Chụp ảnh hoặc video minh chứng" onChange={choose} /></fieldset>
    {files.length > 0 && <div className="lesson-image-previews" aria-label="Minh chứng đã chọn">{files.map((item, index) => <figure key={item.id}>{isVideoFile(item.file) ? <video src={item.previewUrl} controls preload="metadata" aria-label={`Video minh chứng ${index + 1}: ${item.file.name}`} /> : <img src={item.previewUrl} alt={`Ảnh minh chứng ${index + 1}: ${item.file.name}`} />}<figcaption><span>{item.file.name} · {isVideoFile(item.file) ? "Video" : "Ảnh"} · {fileSizeLabel(item.file.size)}</span><button type="button" onClick={() => remove(item.id)} aria-label={`Xóa file ${item.file.name}`}>×</button></figcaption></figure>)}</div>}
    {errors.evidence && <p className="checkout-field-error" role="alert">{errors.evidence}</p>}
    {submitError && <p className="mini-form-error" role="alert">{submitError}</p>}
    <button className="mini-primary-button checkout-submit-button lesson" disabled={submitting}>{submitting && <span className="mini-action-spinner" aria-hidden />}{submitting ? "Đang tải báo giảng…" : "Gửi báo giảng"}</button>
  </form></Sheet>;
}

export function SessionDetailSheet({ session, onClose, onUpdate, onDeclined, onRefresh, onLessonSubmitted, notify }: { session: TeachingSession; onClose: () => void; onUpdate: (session: TeachingSession) => void; onDeclined: (session: TeachingSession) => void; onRefresh?: (sessionId: number, mutation?: TeachingSession) => Promise<void>; onLessonSubmitted?: () => void; notify: (message: string, tone?: ToastTone) => void }) {
  const [declining, setDeclining] = useState(false);
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [lessonOpen, setLessonOpen] = useState(false);
  const [progress, setProgress] = useState<LocationActionPhase>(null);
  const actionInFlight = useRef(false);
  const today = toISO(new Date());
  const action = getSessionAttendanceAction(session);
  const canDecline = session.confirmationStatus === "CONFIRMED" && action === "checkin" && session.status === "SCHEDULED" && !session.declinedAt && session.date >= today;
  const attended = session.checkoutAt != null;
  const lessonReported = session.lessonSubmittedAt != null;
  const now = useMinuteClock();
  const timing = lessonReportTiming(session, now);
  const dueLabel = formatLessonReportDue(session.lessonReportDueAt);
  const sync = async (updated: TeachingSession) => {
    // Apply the mutation response immediately so check-in/check-out never waits
    // for a follow-up GET (which can briefly return stale replicated data).
    onUpdate(updated);
    if (onRefresh) {
      try { await onRefresh(session.id, updated); }
      catch { /* Keep the successful mutation response when the background refresh fails. */ }
    }
  };

  const checkout = async () => {
    if (action !== "checkout" || actionInFlight.current) return;
    actionInFlight.current = true;
    setProgress("locating");
    try {
      const position = await getCurrentPosition();
      if (!confirmAttendanceDistance(session, position)) return;
      setProgress("submitting");
      const updated = await teacherMiniApi.sessions.checkout(session.id, position);
      await sync(updated);
      notify("Check-out thành công.");
    } catch (error) {
      if (error instanceof TeacherApiError && error.code === "TEACHING_SESSION_NOT_CHECKED_IN") notify("Vui lòng check-in trước khi check-out", "error");
      else if (error instanceof TeacherApiError && error.code === "TEACHING_SESSION_CHECKOUT_NOT_REQUIRED") { if (onRefresh) await onRefresh(session.id); notify("Tiết này không cần check-out", "warning"); }
      else if (error instanceof TeacherApiError && error.code === "TEACHING_SESSION_ALREADY_CHECKED_OUT") { if (onRefresh) await onRefresh(session.id); notify("Tiết này đã chấm công", "warning"); }
      else explainError(error, notify);
    } finally {
      actionInFlight.current = false;
      setProgress(null);
    }
  };

  const progressText = progress === "locating" ? "Đang xác định vị trí…" : progress === "submitting" ? "Đang ghi nhận chấm công…" : null;

  return <><Sheet title="Chi tiết buổi dạy" onClose={onClose}><div className="mini-session-detail">
    <div className="detail-hero"><div><b>{session.date.split("-")[2]}</b><span>Tháng {Number(session.date.split("-")[1])}</span></div><section><small>{session.dayOfWeekLabel || dayLabel(session.dayOfWeek)}</small><h3>{session.subjectName}</h3><p>{formatTime(session.startTime)}–{formatTime(session.endTime)}</p></section><StatusChip session={session} /></div>
    <dl><div><dt>Trường</dt><dd>{session.schoolName}</dd></div><div><dt>Lớp</dt><dd>{session.className || "—"}</dd></div><div><dt>Số tiết</dt><dd>{periodsOf(session)} tiết</dd></div><div><dt>Tiền dạy</dt><dd>{money(session.amount)}</dd></div></dl>
    {session.confirmationStatus === "PENDING" ? <div className="attendance-message confirmation-pending-message">Buổi dạy đang chờ bạn xác nhận hoặc từ chối tại mục “Lịch của tôi”.</div>
      : session.confirmationStatus === "REJECTED" ? <div className="attendance-message confirmation-rejected-message"><b>Đã từ chối lịch dạy.</b>{session.rejectionReason && <span>Lý do: {session.rejectionReason}</span>}</div>
      : session.status === "CANCELLED" ? <div className="attendance-message muted">Buổi đã huỷ — không cần chấm công.</div>
      : session.assignmentStatus !== "ASSIGNED" ? <div className="attendance-message muted">Tiết này chưa được phân công nên chưa check-in được.</div>
      : lessonReported ? <><div className="attendance-message success">✓ Đã báo giảng.</div><div className="lesson-report-summary"><dl><div><dt>Tên bài học</dt><dd>{session.lessonName || "—"}</dd></div><div><dt>Sĩ số thực tế</dt><dd>{session.actualStudentCount ?? "—"}</dd></div></dl><p>{session.lessonEvaluation}</p>{session.lessonSubmittedAt && <small>Nộp lúc {new Date(session.lessonSubmittedAt).toLocaleString("vi-VN")}</small>}{session.lessonImages && session.lessonImages.length > 0 && <div className="submitted-media-grid">{session.lessonImages.map((media, index) => { const rawUrl = typeof media === "string" ? media : media.url; const url = resolveMediaUrl(rawUrl); return isVideoMedia(media) ? <video key={`${url}-${index}`} src={url} controls preload="metadata" aria-label={`Video báo giảng ${index + 1}`} /> : <img key={`${url}-${index}`} src={url} alt={`Ảnh báo giảng ${index + 1}`} />; })}</div>}</div></>
      : attended ? <><div className="attendance-message success">✓ Đã chấm công.</div>{dueLabel && <div className={`lesson-deadline ${timing.overdue ? "overdue" : timing.warning ? "warning" : ""}`}>{timing.overdue ? "Đã quá hạn báo giảng" : `Hạn báo giảng: ${dueLabel}`}</div>}<button className="gps-action-button lesson" disabled={timing.overdue} onClick={() => setLessonOpen(true)}>{timing.overdue ? "Đã quá hạn báo giảng" : "Báo giảng"}</button></>
      : !action ? <div className="attendance-message muted">Tiết này không cần thao tác chấm công.</div>
      : <><div className="radius-note">{session.schoolLatitude == null ? "Trường chưa gắn toạ độ nên hệ thống chỉ ghi nhận vị trí, chưa kiểm tra khoảng cách." : `Cho phép trong bán kính ${session.schoolCheckinRadius ?? 200} m quanh ${session.schoolName}. Đứng ngoài vẫn chấm được nhưng sẽ bị đánh dấu để Nhân sự xem lại.`}</div><button className={`gps-action-button ${action}`} onClick={action === "checkin" ? () => setCheckinOpen(true) : checkout} disabled={progress !== null}>{progress && <span className="mini-action-spinner" aria-hidden />}{progressText || (action === "checkin" ? "Check-in" : "Check-out")}</button></>}
    {session.checkinAt && <div className="check-record"><span>Đã check-in lúc</span><b>{new Date(session.checkinAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</b>{session.checkinOutOfRange && <em>Ngoài vùng · {session.checkinDistance != null ? formatDistance(session.checkinDistance) : ""}</em>}</div>}
    {session.checkinImages && session.checkinImages.length > 0 && <section className="checkin-images-section"><b>Ảnh Check-in</b><div className="checkin-images">{session.checkinImages.map((image, index) => <a href={resolveMediaUrl(image.url)} target="_blank" rel="noreferrer" key={image.id ?? index}><img src={resolveMediaUrl(image.url)} alt={`Ảnh Check-in ${index + 1}`} /></a>)}</div></section>}
    {session.checkoutAt && <div className="check-record"><span>Đã check-out lúc</span><b>{new Date(session.checkoutAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</b>{session.checkoutOutOfRange && <em>Ngoài vùng · {session.checkoutDistance != null ? formatDistance(session.checkoutDistance) : ""}</em>}</div>}
    {progressText && <span className="sr-only" aria-live="polite">{progressText}</span>}
    {canDecline && <button className="decline-link" onClick={() => setDeclining(true)} disabled={progress !== null}>Tôi không thể dạy buổi này</button>}
  </div></Sheet>{declining && <DeclineSheet session={session} onClose={() => setDeclining(false)} notify={notify} onSuccess={(updated) => { setDeclining(false); onDeclined(updated); notify("Đã gửi yêu cầu người thay thế đến phòng Nhân sự"); }} />}{checkinOpen && <CheckinSheet session={session} onClose={() => setCheckinOpen(false)} onNotRequired={async () => { if (onRefresh) await onRefresh(session.id); notify("Tiết này không cần check-in", "warning"); }} onSuccess={async (updated) => { setCheckinOpen(false); await sync(updated); notify("Check-in thành công."); }} />}{lessonOpen && <LessonReportSheet session={session} onClose={() => setLessonOpen(false)} onAlreadySubmitted={async () => { if (onRefresh) await onRefresh(session.id); notify("Tiết này đã báo giảng", "warning"); }} onDeadlineExpired={async () => { if (onRefresh) await onRefresh(session.id); }} onSuccess={async (updated) => { setLessonOpen(false); await sync(updated); onLessonSubmitted?.(); notify("Đã báo giảng."); }} />}</>;
}

export function ScheduleScreen({ notify, onProfileMissing, onLessonSubmitted, onConfirmationHandled, confirmationNavigation }: { notify: (message: string, tone?: ToastTone) => void; onProfileMissing: () => void; onLessonSubmitted?: () => void; onConfirmationHandled?: () => void; confirmationNavigation?: ConfirmationNavigationTarget | null }) {
  const [mode, setMode] = useState<ScheduleMode>("week");
  const [date, setDate] = useState(new Date());
  const [schoolFilter, setSchoolFilter] = useState("all");
  const [sessions, setSessions] = useState<TeachingSession[]>([]);
  const [schedules, setSchedules] = useState<TeachingSchedule[]>([]);
  const [selected, setSelected] = useState<TeachingSession | null>(null);
  const [resumeDecline, setResumeDecline] = useState<TeachingSession | null>(null);
  const [confirmingConfirmation, setConfirmingConfirmation] = useState<ConfirmationTarget | null>(null);
  const [rejectingConfirmation, setRejectingConfirmation] = useState<ConfirmationTarget | null>(null);
  const [confirmationBusy, setConfirmationBusy] = useState<string | null>(null);
  const openedConfirmationNavigation = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const range = getRange(date, mode);

  useEffect(() => { void getPendingDraft<PendingDraft>().then((draft) => { if (draft?.type === "decline" && draft.session?.date) setDate(fromISO(draft.session.date)); }); }, []);
  useEffect(() => { let mounted = true; setLoading(true); Promise.all([teacherMiniApi.sessions.me({ fromDate: range.from, toDate: range.to, limit: 200 }), teacherMiniApi.schedules.me({ isActive: true, limit: 100 })]).then(async ([sessionResult, scheduleResult]) => { if (!mounted) return; setSessions(sessionResult.data); setSchedules(scheduleResult.data); const draft = await getPendingDraft<PendingDraft>(); if (draft?.type === "decline") { const target = sessionResult.data.find((item) => item.id === draft.sessionId); if (target) setResumeDecline(target); } }).catch((error) => explainError(error, notify, onProfileMissing)).then(() => { if (mounted) setLoading(false); }); return () => { mounted = false; }; }, [range.from, range.to]);
  useEffect(() => {
    const entityType = confirmationNavigation?.entityType;
    const targetId = entityType === "schedule" ? confirmationNavigation?.scheduleId : confirmationNavigation?.sessionId;
    if (!entityType || !targetId) return;
    const navigationKey = `${confirmationNavigation?.notificationId ?? "notification"}-${entityType}-${targetId}`;
    if (openedConfirmationNavigation.current === navigationKey) return;
    if (entityType === "schedule") {
      const schedule = schedules.find((item) => item.id === targetId);
      if (!schedule) return;
      openedConfirmationNavigation.current = navigationKey;
      setConfirmingConfirmation({ entityType: "schedule", item: schedule });
      return;
    }
    const session = sessions.find((item) => item.id === targetId);
    if (session) {
      openedConfirmationNavigation.current = navigationKey;
      setDate(fromISO(session.date));
      setConfirmingConfirmation({ entityType: "session", item: session });
      return;
    }
    openedConfirmationNavigation.current = navigationKey;
    teacherMiniApi.sessions.get(targetId).then((item) => { setDate(fromISO(item.date)); setConfirmingConfirmation({ entityType: "session", item }); }).catch((error) => explainError(error, notify, onProfileMissing));
  }, [confirmationNavigation?.entityType, confirmationNavigation?.notificationId, confirmationNavigation?.scheduleId, confirmationNavigation?.sessionId, schedules, sessions]);

  const planned = useMemo(() => plannedFromSchedules(schedules, sessions, range.from, range.to), [schedules, sessions, range.from, range.to]);
  const allVisible = [...sessions, ...planned].sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`));
  const schoolOptions = Array.from(new Map(allVisible.map((item) => [item.schoolId, item.schoolName] as const)).entries());
  const visible = schoolFilter === "all" ? allVisible : allVisible.filter((item) => String(item.schoolId) === schoolFilter);
  const actualSessions = schoolFilter === "all" ? sessions : sessions.filter((item) => String(item.schoolId) === schoolFilter);
  const grouped = visible.reduce<Record<string, TeachingSession[]>>((all, session) => { (all[session.date] ||= []).push(session); return all; }, {});
  const summary = { sessions: actualSessions.length, periods: actualSessions.reduce((sum, item) => sum + periodsOf(item), 0), amount: actualSessions.reduce((sum, item) => sum + (item.amount ?? 0), 0), unpriced: actualSessions.some((item) => item.amount == null) };
  const selectedSchoolName = schoolFilter === "all" ? "Tất cả trường" : schoolOptions.find(([id]) => String(id) === schoolFilter)?.[1] || "Trường";
  const schoolYear = visible.find((item) => item.schoolYear)?.schoolYear || "—";

  const refreshConfirmationData = async () => {
    const [sessionResult, scheduleResult] = await Promise.all([
      teacherMiniApi.sessions.me({ fromDate: range.from, toDate: range.to, limit: 200 }),
      teacherMiniApi.schedules.me({ isActive: true, limit: 100 }),
    ]);
    setSessions(sessionResult.data);
    setSchedules(scheduleResult.data);
    setSelected((current) => current ? sessionResult.data.find((item) => item.id === current.id) ?? current : null);
  };

  const submitConfirmation = async (target: ConfirmationTarget, status: "CONFIRMED" | "REJECTED", reason: string | null) => {
    const key = confirmationKey(target);
    if (confirmationBusy) return;
    setConfirmationBusy(key);
    try {
      if (target.entityType === "schedule") {
        const updated = await teacherMiniApi.schedules.confirmation(target.item.id, { status, reason });
        setSchedules((items) => items.map((item) => item.id === updated.id ? updated : item));
        if (status === "CONFIRMED") {
          try {
            const result = await teacherMiniApi.sessions.me({ fromDate: range.from, toDate: range.to, limit: 200 });
            setSessions(result.data);
          } catch { notify("Đã xác nhận lịch nhưng chưa thể tải danh sách buổi mới. Vui lòng thử tải lại.", "warning"); }
        }
      } else {
        const updated = await teacherMiniApi.sessions.confirmation(target.item.id, { status, reason });
        setSessions((items) => items.map((item) => item.id === updated.id ? updated : item));
        setSelected((current) => current?.id === updated.id ? updated : current);
      }
      onConfirmationHandled?.();
      notify(status === "CONFIRMED" ? "Đã xác nhận lịch dạy." : "Đã từ chối lịch dạy.");
    } finally { setConfirmationBusy(null); }
  };

  const handleConfirmationConflict = async () => {
    try { await refreshConfirmationData(); }
    catch (error) { explainError(error, notify, onProfileMissing); }
  };

  const confirmTarget = async (target: ConfirmationTarget) => {
    try { await submitConfirmation(target, "CONFIRMED", null); setConfirmingConfirmation(null); }
    catch (error) {
      if (error instanceof TeacherApiError && error.status === 409) { await handleConfirmationConflict(); setConfirmingConfirmation(null); notify("Lịch dạy này đã được xử lý. Đã cập nhật trạng thái mới nhất.", "warning"); }
      else if (error instanceof TeacherApiError && error.status === 403) notify("Bạn không có quyền xử lý lịch dạy này.", "error");
      else explainError(error, notify);
    }
  };

  const rejectTarget = async (reason: string) => {
    if (!rejectingConfirmation) return;
    try { await submitConfirmation(rejectingConfirmation, "REJECTED", reason); }
    catch (error) { if (error instanceof TeacherApiError && error.status === 409) await handleConfirmationConflict(); throw error; }
  };

  const move = (direction: number) => setDate(mode === "day" ? addDays(date, direction) : mode === "week" ? addDays(date, direction * 7) : new Date(date.getFullYear(), date.getMonth() + direction, 1));
  const openScheduleItem = (session: TeachingSession) => {
    if (session.id < 0 && session.scheduleId) {
      const schedule = schedules.find((item) => item.id === session.scheduleId);
      if (schedule) setConfirmingConfirmation({ entityType: "schedule", item: schedule });
      else notify("Không tìm thấy mẫu lịch để xác nhận.", "error");
      return;
    }
    if (session.confirmationStatus === "PENDING" || session.confirmationStatus === "REJECTED") {
      setConfirmingConfirmation({ entityType: "session", item: session });
      return;
    }
    setSelected(session);
  };
  const update = (updated: TeachingSession) => { setSessions((items) => items.map((item) => item.id === updated.id ? updated : item)); setSelected(updated); };
  const refresh = async (sessionId: number, mutation?: TeachingSession) => { const [list, detail] = await Promise.all([teacherMiniApi.sessions.me({ fromDate: range.from, toDate: range.to, limit: 200 }), teacherMiniApi.sessions.get(sessionId)]); setSessions(list.data.map((item) => item.id === sessionId ? mergeSessionAfterMutation(item, mutation) : item)); setSelected(mergeSessionAfterMutation(detail, mutation)); };
  const declined = (updated: TeachingSession) => { setSessions((items) => items.filter((item) => item.id !== updated.id)); setSelected(null); setResumeDecline(null); };

  return <div className="teacher-screen">
    <div className="screen-title"><div><h1>Lịch của tôi</h1><p>Theo dõi lịch giảng dạy và thu nhập dự kiến</p></div></div>
    <div className="mini-segment">{(["day", "week", "month"] as ScheduleMode[]).map((item) => <button key={item} onClick={() => setMode(item)} className={mode === item ? "active" : ""}>{item === "day" ? "Ngày" : item === "week" ? "Tuần" : "Tháng"}</button>)}</div>
    <div className="date-navigator"><button onClick={() => move(-1)}>‹</button><label className="schedule-native-date-picker"><span>{formatScheduleDate(date, mode)}</span><input type="date" aria-label="Chọn ngày" value={toISO(date)} onChange={(event) => { if (event.target.value) setDate(fromISO(event.target.value)); }} /></label><button onClick={() => move(1)}>›</button></div>
    <label className="schedule-school-filter"><span>Trường</span><select value={schoolFilter} onChange={(event) => setSchoolFilter(event.target.value)}><option value="all">Tất cả trường</option>{schoolOptions.map(([id, name]) => <option value={String(id)} key={id}>{name}</option>)}</select></label>
    <div className="schedule-summary"><div><b>{summary.sessions}</b><span>Buổi thật</span></div><div><b>{summary.periods}</b><span>Số tiết</span></div><div><b>{summary.unpriced ? "—" : summary.amount.toLocaleString("vi-VN")}</b><span>{summary.unpriced ? "Có buổi chưa khai giá" : "Tổng tiền (₫)"}</span></div></div>
    {loading ? <LoadingCards /> : mode === "week" ? <WeeklyTimetable sessions={visible} weekStart={range.from} schoolName={selectedSchoolName} schoolYear={schoolYear} onSelect={openScheduleItem} /> : mode === "month" ? <MonthCalendar sessions={visible} monthDate={date} onSelectDate={setDate} onSelectSession={openScheduleItem} /> : <div className="grouped-sessions">{Object.entries(grouped).map(([day, items]) => <section key={day}><header><b>{dayLabel(dayOfWeek(fromISO(day)))}</b><span>{formatDate(day)}</span></header>{items.map((item) => <SessionCard key={item.id} session={item} planned={item.id < 0} onClick={() => openScheduleItem(item)} />)}</section>)}{!visible.length && <div className="mini-empty-list">Không có buổi dạy trong khoảng đang xem</div>}<div className="planned-legend"><span /> Bấm vào tiết dự kiến để xác nhận hoặc từ chối lịch dạy</div></div>}
    {confirmingConfirmation && <Sheet className={`confirmation-action-sheet ${confirmationNavigation?.urgent ? "urgent" : ""}`} title="Xác nhận lịch dạy" onClose={() => setConfirmingConfirmation(null)} closeDisabled={confirmationBusy !== null}><div className="confirmation-action-content"><p>Vui lòng kiểm tra thông tin và phản hồi lịch dạy.</p><ConfirmationCard target={confirmingConfirmation} busy={confirmationBusy !== null} onConfirm={confirmTarget} onReject={(target) => { setConfirmingConfirmation(null); setRejectingConfirmation(target); }} /></div></Sheet>}
    {selected && <SessionDetailSheet session={selected} onClose={() => setSelected(null)} onUpdate={update} onDeclined={declined} onRefresh={refresh} onLessonSubmitted={onLessonSubmitted} notify={notify} />}
    {resumeDecline && <DeclineSheet session={resumeDecline} onClose={() => setResumeDecline(null)} onSuccess={declined} notify={notify} />}
    {rejectingConfirmation && <ConfirmationRejectSheet target={rejectingConfirmation} onClose={() => setRejectingConfirmation(null)} onSubmit={rejectTarget} />}
  </div>;
}

export function AttendanceScreen({ notify, onProfileMissing, onLessonSubmitted, navigationTarget }: { notify: (message: string, tone?: ToastTone) => void; onProfileMissing: () => void; onLessonSubmitted?: () => void; navigationTarget?: LessonNotificationTarget | null }) {
  const [section, setSection] = useState<"today" | "history">("today");
  const [historyMode, setHistoryMode] = useState<"week" | "month">("month");
  const [weekDate, setWeekDate] = useState(new Date());
  const [month, setMonth] = useState(new Date());
  const [sessions, setSessions] = useState<TeachingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<TeachingSession | null>(null);
  const [reporting, setReporting] = useState<TeachingSession | null>(null);
  const now = useMinuteClock();
  const today = toISO(new Date());
  const historyRange = historyMode === "week"
    ? getRange(weekDate, "week")
    : { from: toISO(new Date(month.getFullYear(), month.getMonth(), 1)), to: toISO(new Date(month.getFullYear(), month.getMonth() + 1, 0)) };
  const range = section === "today" ? { from: today, to: today } : historyRange;
  const historyLabel = historyMode === "week" ? formatScheduleDate(weekDate, "week") : `Tháng ${month.getMonth() + 1}/${month.getFullYear()}`;
  const previousHistoryRange = () => historyMode === "week" ? setWeekDate((date) => addDays(date, -7)) : setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1));
  const nextHistoryRange = () => historyMode === "week" ? setWeekDate((date) => addDays(date, 7)) : setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1));

  useEffect(() => { if (!navigationTarget?.date) return; const targetDate = fromISO(navigationTarget.date); setWeekDate(targetDate); setMonth(new Date(targetDate.getFullYear(), targetDate.getMonth(), 1)); setSection(navigationTarget.date === today ? "today" : "history"); }, [navigationTarget?.date, today]);
  useEffect(() => { setLoading(true); teacherMiniApi.sessions.me({ fromDate: range.from, toDate: range.to, limit: 200 }).then((result) => setSessions(result.data)).catch((error) => explainError(error, notify, onProfileMissing)).then(() => setLoading(false)); }, [range.from, range.to]);
  useEffect(() => { if (loading || navigationTarget?.sessionIds.length !== 1) return; const target = sessions.find((item) => item.id === navigationTarget.sessionIds[0]); if (target) setSelected(target); }, [loading, navigationTarget, sessions]);
  const checked = sessions.filter((item) => item.checkinAt).length;
  const missingCheckout = sessions.filter((item) => item.assignmentStatus === "ASSIGNED" && item.status !== "CANCELLED" && item.checkoutRequired === true && !item.checkoutAt).length;
  const outOfRange = sessions.filter((item) => item.checkinOutOfRange || item.checkoutOutOfRange).length;
  const update = (updated: TeachingSession) => { setSessions((items) => items.map((item) => item.id === updated.id ? updated : item)); setSelected(updated); };
  const refresh = async (sessionId: number, mutation?: TeachingSession) => { const [list, detail] = await Promise.all([teacherMiniApi.sessions.me({ fromDate: range.from, toDate: range.to, limit: 200 }), teacherMiniApi.sessions.get(sessionId)]); setSessions(list.data.map((item) => item.id === sessionId ? mergeSessionAfterMutation(item, mutation) : item)); setSelected(mergeSessionAfterMutation(detail, mutation)); };

  return <div className="teacher-screen"><div className="screen-title"><div><h1>Chấm công</h1><p>Check-in, check-out và báo giảng</p></div></div><div className="mini-segment attendance-tabs"><button className={section === "today" ? "active" : ""} onClick={() => setSection("today")}>Hôm nay</button><button className={section === "history" ? "active" : ""} onClick={() => setSection("history")}>Lịch sử</button></div>{section === "history" && <><div className="mini-segment attendance-history-modes"><button className={historyMode === "week" ? "active" : ""} onClick={() => setHistoryMode("week")}>Theo tuần</button><button className={historyMode === "month" ? "active" : ""} onClick={() => setHistoryMode("month")}>Theo tháng</button></div><div className="month-navigator"><button onClick={previousHistoryRange}>‹</button><b>{historyLabel}</b><button onClick={nextHistoryRange}>›</button></div></>}{section === "history" && <div className="attendance-stats"><div><b>{checked}</b><span>Đã check-in</span></div><div><b>{missingCheckout}</b><span>Chưa hoàn tất</span></div><div><b>{outOfRange}</b><span>Ngoài vùng</span></div></div>}<div className="attendance-explainer">Trạng thái công (Có dạy / Vắng / Huỷ) do phòng Nhân sự chốt sau buổi dạy.</div>{loading ? <LoadingCards /> : <div className="attendance-session-list">{sessions.map((session) => { const overdue = lessonReportTiming(session, now).overdue; return <article className={navigationTarget?.sessionIds.includes(session.id) ? "lesson-alert-highlight" : ""} key={session.id}><button className="attendance-session-main" onClick={() => setSelected(session)}><div className="attendance-date"><b>{session.date.split("-")[2]}</b><span>Tháng {Number(session.date.split("-")[1])}</span></div><div><strong>{session.subjectName} · {session.className || "—"}</strong><span>{formatTime(session.startTime)}–{formatTime(session.endTime)} · {session.schoolName}</span><small>{session.lessonSubmittedAt ? "✓ Đã báo giảng" : session.checkoutAt ? "✓ Đã chấm công · Chờ báo giảng" : sessionAttendanceLabel(session)}</small></div><span>›</span></button>{session.checkoutAt && !session.lessonSubmittedAt && <button className="lesson-quick-action" disabled={overdue} onClick={() => setReporting(session)}>{overdue ? "Quá hạn" : "Báo giảng"}</button>}</article>; })}{!sessions.length && <div className="mini-empty-list">Không có buổi dạy trong khoảng này</div>}</div>}{selected && <SessionDetailSheet session={selected} onClose={() => setSelected(null)} onUpdate={update} onDeclined={(updated) => { setSessions((items) => items.filter((item) => item.id !== updated.id)); setSelected(null); }} onRefresh={refresh} onLessonSubmitted={onLessonSubmitted} notify={notify} />}{reporting && <LessonReportSheet session={reporting} onClose={() => setReporting(null)} onAlreadySubmitted={async () => { await refresh(reporting.id); setReporting(null); notify("Tiết này đã báo giảng", "warning"); }} onDeadlineExpired={async () => { await refresh(reporting.id); }} onSuccess={async (updated) => { setReporting(null); await refresh(updated.id); onLessonSubmitted?.(); notify("Đã báo giảng."); }} />}</div>;
}

export function ApplicationSheet({ session, onClose, onSuccess, notify }: { session: TeachingSession; onClose: () => void; onSuccess: (result: TeachingApplicationResult) => void; notify: (message: string, tone?: ToastTone) => void }) {
  const [note, setNote] = useState("");
  const [progress, setProgress] = useState<LocationActionPhase>(null);
  const actionInFlight = useRef(false);
  useEffect(() => { void getPendingDraft<PendingDraft>().then((draft) => { if (draft?.type === "application" && draft.sessionId === session.id) setNote(draft.text); else void savePendingDraft({ type: "application", sessionId: session.id, text: "", session } satisfies PendingDraft); }); }, [session.id]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setProgress("locating");
    try {
      const position = await getCurrentPosition();
      setProgress("submitting");
      const result = await teacherMiniApi.sessions.apply(session.id, position, note.trim() || null);
      await clearPendingDraft();
      onSuccess(result);
    } catch (error) {
      explainError(error, notify);
    } finally {
      actionInFlight.current = false;
      setProgress(null);
    }
  };
  const progressText = progress === "locating" ? "Đang xác định vị trí…" : progress === "submitting" ? "Đang gửi đăng ký…" : null;
  return <Sheet title="Đăng ký nhận tiết" onClose={() => { void clearPendingDraft(); onClose(); }}><form className="mini-form" onSubmit={submit}><div className="sheet-session-summary"><b>{session.subjectName} · {session.className || "—"}</b><span>{formatDate(session.date)} · {formatTime(session.startTime)}–{formatTime(session.endTime)}</span></div><div className="location-consent"><MiniIcon name="pin" /><p>Khi gửi, app lấy vị trí hiện tại của bạn để Nhân sự xếp giáo viên gần trường nhất. Vị trí chỉ lấy một lần tại thời điểm đăng ký.</p></div><label>Ghi chú<textarea rows={4} maxLength={500} value={note} disabled={progress !== null} onChange={(event) => { setNote(event.target.value); void savePendingDraft({ type: "application", sessionId: session.id, text: event.target.value, session } satisfies PendingDraft); }} placeholder="Ví dụ: Nhà gần trường" /><small>{note.length}/500</small></label><button className="mini-primary-button" disabled={progress !== null}>{progress && <span className="mini-action-spinner" aria-hidden />}{progressText || "Xác nhận đăng ký"}</button>{progressText && <span className="sr-only" aria-live="polite">{progressText}</span>}</form></Sheet>;
}

function OpenSessionsScreen({ profile, notify, onProfileMissing }: { profile: Teacher | null; notify: (message: string, tone?: ToastTone) => void; onProfileMissing: () => void }) {
  const [openSessions, setOpenSessions] = useState<TeachingSession[]>([]);
  const [mySessions, setMySessions] = useState<TeachingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<TeachingSession | null>(null);
  const [remainingPeriods, setRemainingPeriods] = useState<number | null | undefined>(undefined);
  const today = new Date();
  const range = { fromDate: toISO(today), toDate: toISO(addDays(today, 30)) };

  const load = () => { setLoading(true); Promise.all([teacherMiniApi.sessions.open({ ...range, page: 1, limit: 20 }), teacherMiniApi.sessions.me({ ...range, limit: 200 })]).then(async ([openResult, myResult]) => { const available = openResult.data.filter((item) => item.assignmentStatus === "OPEN" && item.date >= range.fromDate); setOpenSessions(available); setMySessions(myResult.data); const draft = await getPendingDraft<PendingDraft>(); if (draft?.type === "application") { const target = available.find((item) => item.id === draft.sessionId); if (target) setApplying(target); } }).catch((error) => explainError(error, notify, onProfileMissing)).then(() => setLoading(false)); };
  useEffect(load, []);
  const overlaps = (session: TeachingSession) => mySessions.some((mine) => mine.assignmentStatus === "ASSIGNED" && mine.date === session.date && minutes(mine.startTime) < minutes(session.endTime) && minutes(mine.endTime) > minutes(session.startTime));
  const withdraw = async (session: TeachingSession) => { try { await teacherMiniApi.sessions.withdraw(session.id); setOpenSessions((items) => items.map((item) => item.id === session.id ? { ...item, hasApplied: false, myApplicationStatus: "WITHDRAWN" } : item)); notify("Đã rút đăng ký"); } catch (error) { explainError(error, notify); } };

  return <div className="teacher-screen"><div className="screen-title"><div><h1>Tiết đang mở</h1><p>Đăng ký các tiết phù hợp với lịch của bạn</p></div></div><div className="capacity-card"><div><span>Định mức tuần</span><b>{remainingPeriods !== undefined ? remainingPeriods === null ? "Không giới hạn" : `Còn ${remainingPeriods} tiết` : profile?.maxPeriodsPerWeek == null ? "Không giới hạn" : `${profile.maxPeriodsPerWeek} tiết`}</b></div><small>Hệ thống vẫn kiểm tra trùng lịch và định mức khi đăng ký.</small></div>{loading ? <LoadingCards /> : <div className="open-session-list">{openSessions.map((session) => { const conflict = overlaps(session); const capacityExceeded = typeof remainingPeriods === "number" && remainingPeriods < periodsOf(session); const applicationStatus = session.myApplicationStatus; return <article key={session.id}><header><div><b>{dayLabel(session.dayOfWeek)}</b><span>{formatDate(session.date)}</span></div><span>{formatTime(session.startTime)}–{formatTime(session.endTime)}</span></header><h3>{session.subjectName} · Lớp {session.className || "—"}</h3><p>{session.schoolName}</p><div className="open-meta"><span>{periodsOf(session)} tiết</span><span>{money(session.amount)}</span><span>{session.applicationCount ?? 0} đăng ký</span></div>{conflict && !applicationStatus && <div className="client-warning">Trùng giờ với lịch đã được phân công</div>}{capacityExceeded && !applicationStatus && <div className="client-warning">Số tiết còn lại trong tuần không đủ cho buổi này</div>}<footer>{applicationStatus === "PENDING" ? <button className="withdraw-button" onClick={() => withdraw(session)}>Rút đăng ký</button> : applicationStatus === "SELECTED" ? <div className="application-result success">✓ Bạn đã được phân công tiết này — xem trong Lịch của tôi.</div> : applicationStatus === "NOT_SELECTED" || applicationStatus === "WITHDRAWN" ? <div className="application-result">Tiết này đã có kết quả phân công.</div> : <button className="apply-button" disabled={conflict || capacityExceeded} onClick={() => setApplying(session)}>Đăng ký dạy</button>}</footer></article>; })}{!openSessions.length && <div className="mini-empty-list">Hiện chưa có tiết đang mở</div>}</div>}{applying && <ApplicationSheet session={applying} onClose={() => setApplying(null)} notify={notify} onSuccess={(result) => { setRemainingPeriods(result.remainingPeriodsInWeek); setApplying(null); load(); notify("Đã gửi đăng ký nhận tiết"); }} />}</div>;
}

const confirmationNotificationTypes = new Set(["TEACHING_SCHEDULE_CONFIRM_REQUEST", "TEACHING_SCHEDULE_CONFIRM_RESULT", "TEACHING_SCHEDULE_CONFIRM_ALERT"]);

function notificationPresentation(item: TeachingNotification) {
  const meta = item.meta ?? item.metadata;
  const type = item.type || meta?.kind || "";
  const lessonAlert = type === "TEACHING_LESSON_REPORT_ALERT" || type === "lesson_report_missing";
  if (lessonAlert) return { className: "lesson-report-alert", icon: "clock" as const, title: "Nhắc báo giảng" };
  if (type === "TEACHING_SCHEDULE_CONFIRM_REQUEST") return { className: "schedule-confirm-request", icon: "calendar" as const, title: "Lịch dạy cần xác nhận" };
  if (type === "TEACHING_SCHEDULE_CONFIRM_RESULT") return { className: "schedule-confirm-result", icon: "bell" as const, title: "Kết quả phản hồi lịch" };
  if (type === "TEACHING_SCHEDULE_CONFIRM_ALERT") return { className: "schedule-confirm-alert", icon: "clock" as const, title: "Khẩn: lịch chưa xác nhận" };
  return { className: "", icon: "calendar" as const, title: item.title || "Cập nhật lịch dạy" };
}

export function NotificationSheet({ onClose, notify, onCountChange, onUnreadCountChange, onNavigateLessonReport, onNavigateScheduleConfirmation }: { onClose: () => void; notify: (message: string, tone?: ToastTone) => void; onCountChange?: (count: number) => void; onUnreadCountChange?: (count: number) => void; onNavigateLessonReport?: (target: LessonNotificationTarget) => void; onNavigateScheduleConfirmation?: (target: ConfirmationNavigationTarget) => void }) {
  const [tab, setTab] = useState<"all" | "unread" | "read">("all");
  const [items, setItems] = useState<TeachingNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const unreadCount = tab === "unread" ? items.length : unreadTotal;
  useEffect(() => { setLoading(true); teacherMiniApi.notifications.list(tab).then((result) => setItems(result.data)).catch((error) => explainError(error, notify)).then(() => setLoading(false)); }, [tab]);
  useEffect(() => {
    if (tab === "unread") return;
    teacherMiniApi.notifications.list("unread").then((result) => setUnreadTotal(result.data.length)).catch(() => undefined);
  }, [tab]);
  useEffect(() => onTeacherNotification((item) => {
    if (tab === "all" || tab === "unread") setItems((current) => current.some((entry) => entry.id === item.id) ? current : [item, ...current]);
    if (tab !== "unread") setUnreadTotal((value) => value + 1);
  }), [tab]);
  useEffect(() => { onUnreadCountChange?.(unreadCount); }, [unreadCount, onUnreadCountChange]);
  const openItem = async (item: TeachingNotification) => {
    try {
      const unreadItem = tab === "unread" || item.isRead === false;
      if (unreadItem) {
        await teacherMiniApi.notifications.read(item.id);
        setItems((current) => tab === "all" ? current.map((entry) => entry.id === item.id ? { ...entry, isRead: true } : entry) : current.filter((entry) => entry.id !== item.id));
        if (tab !== "unread") setUnreadTotal((value) => Math.max(0, value - 1));
        onCountChange?.(-1);
      }
      const meta = item.meta ?? item.metadata;
      const type = item.type || meta?.kind || "";
      const lessonAlert = type === "TEACHING_LESSON_REPORT_ALERT" || type === "lesson_report_missing";
      if (lessonAlert && meta?.date) {
        const ids = meta.sessionIds ?? (meta.sessionId ? [meta.sessionId] : []);
        onNavigateLessonReport?.({ date: meta.date, sessionIds: ids });
        onClose();
      } else if (confirmationNotificationTypes.has(type)) {
        onNavigateScheduleConfirmation?.({ entityType: meta?.entityType ?? (meta?.scheduleId ? "schedule" : meta?.sessionId ? "session" : undefined), scheduleId: meta?.scheduleId, sessionId: meta?.sessionId, urgent: type === "TEACHING_SCHEDULE_CONFIRM_ALERT", notificationId: item.id });
        onClose();
      }
    } catch (error) { explainError(error, notify); }
  };
  const readAll = async () => { try { const removed = items.length; await teacherMiniApi.notifications.readAll(); setItems([]); setUnreadTotal(0); onCountChange?.(-removed); notify("Đã đánh dấu tất cả là đã đọc"); } catch (error) { explainError(error, notify); } };
  const emptyTitle = tab === "all" ? "Chưa có thông báo" : tab === "unread" ? "Bạn đã đọc hết thông báo" : "Chưa có thông báo đã đọc";
  return <Sheet className="notification-sheet" title={<span className="notification-title"><NotificationIcon name="bell" /> Thông báo</span>} onClose={onClose}>
    <div className="notification-tabs" role="tablist">
      <button role="tab" aria-selected={tab === "all"} className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}>Tất cả{tab === "all" && items.length > 0 && <b>{items.length}</b>}</button>
      <button role="tab" aria-selected={tab === "unread"} className={tab === "unread" ? "active" : ""} onClick={() => setTab("unread")}>Chưa đọc{tab === "unread" && items.length > 0 && <b>{items.length}</b>}</button>
      <button role="tab" aria-selected={tab === "read"} className={tab === "read" ? "active" : ""} onClick={() => setTab("read")}>Đã đọc</button>
      {tab === "unread" && items.length > 0 && <button className="read-all-button" onClick={readAll}>Đọc tất cả</button>}
    </div>
    {loading ? <LoadingCards /> : <div className="notification-list">
      {items.map((item) => {
        const isUnread = item.isRead === false;
        const presentation = notificationPresentation(item);
        return <button type="button" className={`${isUnread ? "unread" : ""} ${presentation.className}`} key={item.id} onClick={() => openItem(item)}><span className="notification-card-icon"><NotificationIcon name={presentation.icon} /></span><span className="notification-card-copy"><b>{presentation.title}</b><p>{item.message || item.content || "Bạn có một cập nhật mới về lịch dạy."}</p><small><NotificationIcon name="clock" size={11} /> {item.createdAt ? new Date(item.createdAt).toLocaleString("vi-VN") : "Vừa xong"}</small></span>{isUnread && <span className="notification-dot" aria-label="Chưa đọc" />}</button>;
      })}
      {!items.length && <div className="notification-empty"><span><NotificationIcon name="bell" size={28} /></span><b>{emptyTitle}</b><p>Các cập nhật lịch dạy mới sẽ xuất hiện tại đây.</p></div>}
    </div>}
  </Sheet>;
}

export default function TeacherMiniApp({ user, initialTab = "schedule", onHome, onLogout }: { user: TeachingUser; initialTab?: MiniTab; onHome: () => void; onLogout: () => void }) {
  const { openSnackbar } = useSnackbar();
  const [tab, setTab] = useState<MiniTab>(initialTab);
  const [profile, setProfile] = useState<Teacher | null>(null);
  const [profileMissing, setProfileMissing] = useState(false);
  const [unread, setUnread] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [lessonNavigation, setLessonNavigation] = useState<LessonNotificationTarget | null>(null);
  const [confirmationNavigation, setConfirmationNavigation] = useState<ConfirmationNavigationTarget | null>(null);
  const notify = useCallback((message: string, tone: ToastTone = "success") => openSnackbar({ text: message, type: tone, position: "bottom", duration: 3200, icon: true, zIndex: 250 }), [openSnackbar]);
  const handleProfileMissing = useCallback(() => setProfileMissing(true), []);
  const refreshUnread = useCallback(() => { teacherMiniApi.notifications.unreadCount().then(setUnread).catch(() => undefined); }, []);

  useEffect(() => { teacherMiniApi.teacher.me().then(setProfile).catch((error) => explainError(error, notify, handleProfileMissing)); teacherMiniApi.notifications.unreadCount().then(setUnread).catch(() => undefined); }, [handleProfileMissing, notify]);
  useEffect(() => { void getPendingDraft<PendingDraft>().then((draft) => { if (draft?.type === "application") setTab("open"); }); }, []);
  useEffect(() => {
    const offNotification = onTeacherNotification((item) => {
      setUnread((value) => value + 1);
      if (item.type === "TEACHING_SCHEDULE_CONFIRM_REQUEST" || item.type === "TEACHING_SCHEDULE_CONFIRM_ALERT") notify(item.message || "Bạn có lịch dạy cần xác nhận", "warning");
    });
    const offResync = onSocketResync(refreshUnread);
    return () => { offNotification(); offResync(); };
  }, [notify, refreshUnread]);

  return <main className="teacher-mini-app"><header className="teacher-app-header"><Logo /><div><span>Xin chào,</span><strong>{user.name || profile?.name}</strong></div><button className="mini-home" onClick={onHome} aria-label="Về trang chủ"><NotificationIcon name="home" size={20} /></button><button className="mini-notification-button" onClick={() => setNotificationsOpen(true)}><NotificationIcon name="bell" size={20} />{unread > 0 && <b>{unread > 99 ? "99+" : unread}</b>}</button><button className="mini-logout" onClick={onLogout} aria-label="Đăng xuất"><NotificationIcon name="logout" size={19} /></button></header><div className="teacher-app-body">{profileMissing ? <EmptyProfile /> : tab === "schedule" ? <ScheduleScreen notify={notify} onProfileMissing={handleProfileMissing} onLessonSubmitted={refreshUnread} onConfirmationHandled={refreshUnread} confirmationNavigation={confirmationNavigation} /> : tab === "attendance" ? <AttendanceScreen notify={notify} onProfileMissing={handleProfileMissing} onLessonSubmitted={refreshUnread} navigationTarget={lessonNavigation} /> : tab === "income" ? <TeacherIncomeScreen onProfileMissing={handleProfileMissing} onBackToSchedule={() => setTab("schedule")} /> : <OpenSessionsScreen profile={profile} notify={notify} onProfileMissing={handleProfileMissing} />}</div><nav className="teacher-bottom-nav"><button className={tab === "schedule" ? "active" : ""} onClick={() => setTab("schedule")}><MiniIcon name="calendar" /><span>Lịch của tôi</span></button><button className={tab === "attendance" ? "active" : ""} onClick={() => setTab("attendance")}><MiniIcon name="pin" /><span>Chấm công</span></button><button className={tab === "income" ? "active" : ""} onClick={() => setTab("income")}><MiniIcon name="income" /><span>Thu nhập</span></button></nav>{notificationsOpen && <NotificationSheet onClose={() => setNotificationsOpen(false)} notify={notify} onCountChange={(change) => setUnread((value) => Math.max(0, value + change))} onUnreadCountChange={setUnread} onNavigateLessonReport={(target) => { setLessonNavigation(target); setTab("attendance"); setNotificationsOpen(false); }} onNavigateScheduleConfirmation={(target) => { setConfirmationNavigation(target); setTab("schedule"); setNotificationsOpen(false); }} />}</main>;
}
