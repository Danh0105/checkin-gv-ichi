import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { TeacherApiError, teacherMiniApi } from "@/services/teacher-mini-api";
import { LessonReportForm } from "@/types/teaching";
import {
  currentMonthInVietnam,
  estimateSessionTotal,
  estimateTeachingAmount,
  fetchTeacherIncomeMonth,
  formatIncomeDate,
  formatIncomeTime,
  formatMonth,
  formatVnd,
  incomeDayLabel,
  incomeState,
  shiftMonth,
  summarizeTeacherIncome,
  TeacherIncomeSession,
  toTeacherIncomeSession,
} from "@/utils/teacher-income";
import { formatLessonReportDue, isVideoFile, LESSON_EVIDENCE_ACCEPT, validateLessonEvidenceBatch } from "@/utils/lesson-report";

type IncomeError = { message: string; retryable: boolean };
type AttendanceTab = "completed" | "unchecked" | "incomplete";
type IncompleteFilter = "all" | "checkin" | "checkout" | "lesson";
type FilePreview = { id: number; file: File; previewUrl: string };

const timestampFormatter = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  hour: "2-digit",
  minute: "2-digit",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function formatTimestamp(value: string | null) {
  if (!value) return "Chưa có";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Chưa có" : timestampFormatter.format(date);
}

function formatIncomeCheckin(session: TeacherIncomeSession) {
  return session.checkinAt ? formatTimestamp(session.checkinAt) : session.checkinRequired === false ? "Đã ghi nhận theo tiết liên tục" : "Chưa có";
}

function formatIncomeCheckout(session: TeacherIncomeSession) {
  return session.checkoutAt ? formatTimestamp(session.checkoutAt) : session.checkoutRequired === false || session.checkoutViaAdjacent ? "Đã ghi nhận theo tiết liên tục" : "Chưa có";
}

function sessionStatus(session: TeacherIncomeSession) {
  const state = incomeState(session);
  if (state === "confirmed") return { state, label: session.status === "PRESENT" ? "Đã xác nhận" : "Được tính công" };
  if (state === "pending") return { state, label: "Chờ xác nhận" };
  if (session.status === "ABSENT") return { state, label: "Không tính công" };
  if (session.status === "CANCELLED") return { state, label: "Đã huỷ" };
  return { state, label: session.statusLabel || "Nghỉ có phép" };
}

function periodsText(value: number | null) {
  return value === null ? "Chưa xác định số tiết" : `${value} tiết`;
}

function rateText(value: number | null) {
  return value === null ? "Chưa khai đơn giá" : formatVnd(value);
}

function amountText(value: number | null) {
  return value === null ? "Chưa xác định" : formatVnd(value);
}

function fuelAllowanceText(session: TeacherIncomeSession) {
  if (session.gasAllowance === null) return "Chưa có phụ cấp xăng";
  return session.distanceToSchoolKm === null ? formatVnd(session.gasAllowance) : `${formatVnd(session.gasAllowance)} · ${session.distanceToSchoolKm.toLocaleString("vi-VN")} km`;
}

function displayTeachingAmount(session: TeacherIncomeSession, companyTeacher = false) {
  if (companyTeacher) return { value: session.gasAllowance, label: fuelAllowanceText(session), projected: false };
  const estimated = estimateTeachingAmount(session);
  if (session.amount !== null) return { value: session.amount, label: amountText(session.amount), projected: false };
  return estimated === null ? { value: null, label: "Chưa xác định", projected: false } : { value: estimated, label: formatVnd(estimated), projected: true };
}

function displayTotalAmount(session: TeacherIncomeSession, companyTeacher = false) {
  if (companyTeacher) return { value: session.gasAllowance, label: fuelAllowanceText(session), projected: false };
  const estimated = estimateSessionTotal(session);
  if (session.totalAmount !== null) return { value: session.totalAmount, label: amountText(session.totalAmount), projected: false };
  return estimated === null ? { value: null, label: "Chưa xác định", projected: false } : { value: estimated, label: formatVnd(estimated), projected: true };
}

function totalPeriods(sessions: TeacherIncomeSession[]) {
  return sessions.reduce((total, session) => session.periods !== null && Number.isFinite(session.periods) ? total + session.periods : total, 0);
}

function hasCheckinEvidence(session: TeacherIncomeSession) {
  return Boolean(session.checkinAt || session.checkinRequired === false);
}

function hasCheckoutEvidence(session: TeacherIncomeSession) {
  return Boolean(session.checkoutAt || session.checkoutRequired === false || session.checkoutViaAdjacent);
}

function hasCompleteAttendanceEvidence(session: TeacherIncomeSession) {
  return Boolean(hasCheckinEvidence(session) && hasCheckoutEvidence(session) && session.lessonSubmittedAt);
}

function isMissingLessonReport(session: TeacherIncomeSession) {
  return Boolean(hasCheckinEvidence(session) && hasCheckoutEvidence(session) && !session.lessonSubmittedAt);
}

function isLessonReportOverdue(session: TeacherIncomeSession, now = Date.now()) {
  if (!session.lessonReportDueAt) return false;
  const dueAt = new Date(session.lessonReportDueAt).getTime();
  return Number.isFinite(dueAt) && now >= dueAt;
}

function matchesIncompleteFilter(session: TeacherIncomeSession, filter: IncompleteFilter) {
  if (filter === "all") return true;
  if (filter === "checkin") return !hasCheckinEvidence(session);
  if (filter === "checkout") return !hasCheckoutEvidence(session);
  return isMissingLessonReport(session);
}

const fileSizeLabel = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function IncomeLoading() {
  return <div className="income-loading" aria-label="Đang tải dữ liệu thu nhập" aria-busy="true">
    <div className="income-summary-skeleton"><span /><b /><small /></div>
    <div className="income-stats-skeleton">{[1, 2, 3, 4].map((item) => <span key={item} />)}</div>
    <div className="income-list-skeleton">{[1, 2, 3].map((item) => <div key={item}><b /><span /><span /></div>)}</div>
  </div>;
}

function IncomeLessonReportSheet({ session, onClose, onSuccess }: { session: TeacherIncomeSession; onClose: () => void; onSuccess: (session: TeacherIncomeSession) => void | Promise<void> }) {
  const [lessonName, setLessonName] = useState("");
  const [lessonEvaluation, setLessonEvaluation] = useState("");
  const [actualStudentCount, setActualStudentCount] = useState("");
  const [files, setFiles] = useState<FilePreview[]>([]);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const evaluationRef = useRef<HTMLTextAreaElement>(null);
  const countRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  const filesRef = useRef<FilePreview[]>([]);

  useEffect(() => () => { filesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl)); }, []);

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
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
    const next: Record<string, string> = {};
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
    if (submitting || !validate()) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const form: LessonReportForm = { lessonName: lessonName.trim(), lessonEvaluation: lessonEvaluation.trim(), actualStudentCount: Number(actualStudentCount), evidenceFiles: files.map((item) => item.file) };
      const updated = await teacherMiniApi.sessions.lesson(session.id, form);
      await onSuccess(toTeacherIncomeSession(updated));
    } catch (reason) {
      const code = reason instanceof TeacherApiError ? reason.code : null;
      const mapped: Record<string, string> = {
        TEACHING_SESSION_NOT_ATTENDED: "Tiết dạy chưa hoàn tất chấm công",
        TEACHING_SESSION_LESSON_EVIDENCE_REQUIRED: "Vui lòng tải lên ít nhất một ảnh hoặc video minh chứng",
        TEACHING_SESSION_LESSON_ALREADY_SUBMITTED: "Tiết này đã báo giảng",
        TEACHING_SESSION_LESSON_DEADLINE_EXPIRED: "Đã quá hạn báo giảng lúc 08:00 ngày hôm sau",
        LESSON_IMAGE_TOO_LARGE: "Mỗi ảnh hoặc video không được vượt quá 50 MB",
        LESSON_IMAGE_LIMIT_EXCEEDED: "Chỉ được tải lên tối đa 10 file",
      };
      setSubmitError(code && mapped[code] ? mapped[code] : reason instanceof Error ? reason.message : "Không thể gửi báo giảng. Vui lòng thử lại.");
    } finally {
      setSubmitting(false);
    }
  };

  return <div className="mini-sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !submitting && onClose()}>
    <section className="mini-sheet checkout-lesson-sheet" role="dialog" aria-modal="true" aria-labelledby="income-lesson-title">
      <header><div className="sheet-handle" /><h2 id="income-lesson-title">Báo giảng</h2><button onClick={onClose} disabled={submitting} aria-label="Đóng">×</button></header>
      <form className="mini-form checkout-lesson-form" onSubmit={submit} noValidate>
        <div className="sheet-session-summary"><b>{session.subjectName} · {session.className || "—"}</b><span>{formatIncomeDate(session.date)} · {formatIncomeTime(session.startTime)}–{formatIncomeTime(session.endTime)}</span></div>
        <label htmlFor="income-lesson-report-name">Tên bài học <b>*</b><input ref={nameRef} id="income-lesson-report-name" value={lessonName} disabled={submitting} onChange={(event) => { setLessonName(event.target.value); setErrors((current) => ({ ...current, lessonName: undefined })); }} /><small>{lessonName.trim().length}/255</small></label>
        {errors.lessonName && <p className="checkout-field-error" role="alert">{errors.lessonName}</p>}
        <label htmlFor="income-lesson-report-evaluation">Đánh giá buổi học <b>*</b><textarea ref={evaluationRef} id="income-lesson-report-evaluation" rows={5} value={lessonEvaluation} disabled={submitting} onChange={(event) => { setLessonEvaluation(event.target.value); setErrors((current) => ({ ...current, lessonEvaluation: undefined })); }} /><small>{lessonEvaluation.trim().length}/2000</small></label>
        {errors.lessonEvaluation && <p className="checkout-field-error" role="alert">{errors.lessonEvaluation}</p>}
        <label htmlFor="income-lesson-report-count">Sĩ số thực tế <b>*</b><input ref={countRef} id="income-lesson-report-count" type="number" inputMode="numeric" min="0" step="1" value={actualStudentCount} disabled={submitting} onChange={(event) => { setActualStudentCount(event.target.value); setErrors((current) => ({ ...current, actualStudentCount: undefined })); }} /></label>
        {errors.actualStudentCount && <p className="checkout-field-error" role="alert">{errors.actualStudentCount}</p>}
        <fieldset className="lesson-images-fieldset" disabled={submitting}><legend>Ảnh/video minh chứng <b>*</b></legend><p>Từ 1 đến 10 file JPEG, PNG, WebP, MP4, MOV hoặc WebM; tối đa 50 MB/file.</p><div className="lesson-image-actions"><button type="button" onClick={() => inputRef.current?.click()}>Chọn ảnh/video</button><button type="button" onClick={() => cameraRef.current?.click()}>Mở camera</button></div><input ref={inputRef} className="lesson-image-input" type="file" accept={LESSON_EVIDENCE_ACCEPT} multiple aria-label="Chọn ảnh hoặc video minh chứng" onChange={choose} /><input ref={cameraRef} className="lesson-image-input" type="file" accept={LESSON_EVIDENCE_ACCEPT} capture="environment" aria-label="Chụp ảnh hoặc video minh chứng" onChange={choose} /></fieldset>
        {files.length > 0 && <div className="lesson-image-previews" aria-label="Minh chứng đã chọn">{files.map((item, index) => <figure key={item.id}>{isVideoFile(item.file) ? <video src={item.previewUrl} controls preload="metadata" aria-label={`Video minh chứng ${index + 1}: ${item.file.name}`} /> : <img src={item.previewUrl} alt={`Ảnh minh chứng ${index + 1}: ${item.file.name}`} />}<figcaption><span>{item.file.name} · {isVideoFile(item.file) ? "Video" : "Ảnh"} · {fileSizeLabel(item.file.size)}</span><button type="button" onClick={() => remove(item.id)} aria-label={`Xóa file ${item.file.name}`}>×</button></figcaption></figure>)}</div>}
        {errors.evidence && <p className="checkout-field-error" role="alert">{errors.evidence}</p>}
        {submitError && <p className="mini-form-error" role="alert">{submitError}</p>}
        <button className="mini-primary-button checkout-submit-button lesson" disabled={submitting}>{submitting && <span className="mini-action-spinner" aria-hidden />}{submitting ? "Đang tải báo giảng…" : "Gửi báo giảng"}</button>
      </form>
    </section>
  </div>;
}

function IncomeDetailSheet({ session, onClose, onReportLesson, companyTeacher = false }: { session: TeacherIncomeSession; onClose: () => void; onReportLesson: (session: TeacherIncomeSession) => void; companyTeacher?: boolean }) {
  const status = sessionStatus(session);
  const canReportLesson = isMissingLessonReport(session);
  const lessonOverdue = isLessonReportOverdue(session);
  const dueLabel = formatLessonReportDue(session.lessonReportDueAt);
  const teachingAmount = displayTeachingAmount(session, companyTeacher);
  const totalAmount = displayTotalAmount(session, companyTeacher);
  return <div className="mini-sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="mini-sheet income-detail-sheet" role="dialog" aria-modal="true" aria-labelledby="income-detail-title">
      <header><div className="sheet-handle" /><h2 id="income-detail-title">Chi tiết khoản thu nhập</h2><button onClick={onClose} aria-label="Đóng">×</button></header>
      <div className="income-detail-content">
        <div className="income-detail-heading">
          <span>{incomeDayLabel(session.date)}, {formatIncomeDate(session.date)}</span>
          <b>{formatIncomeTime(session.startTime)}–{formatIncomeTime(session.endTime)}</b>
          <em className={`income-badge ${status.state}`}>{status.label}</em>
        </div>
        <dl>
          <div><dt>Trường</dt><dd>{session.schoolName || "Chưa cập nhật"}</dd></div>
          <div><dt>Lớp</dt><dd>{session.className || "Chưa cập nhật"}</dd></div>
          <div><dt>Môn học</dt><dd>{session.subjectName || "Chưa cập nhật"}</dd></div>
          <div><dt>Trạng thái buổi</dt><dd>{session.statusLabel || status.label}</dd></div>
          <div><dt>Số tiết</dt><dd>{periodsText(session.periods)}</dd></div>
          {companyTeacher ? <div><dt>Phụ cấp xăng</dt><dd className={session.gasAllowance === null ? "muted" : ""}>{teachingAmount.label}</dd></div> : <>
            <div><dt>Đơn giá mỗi tiết</dt><dd className={session.ratePerPeriod === null ? "muted" : ""}>{rateText(session.ratePerPeriod)}</dd></div>
            <div><dt>{teachingAmount.projected ? "Dự kiến tiền tiết dạy" : "Tiền tiết dạy"}</dt><dd className={teachingAmount.value === null ? "muted" : ""}>{teachingAmount.label}</dd></div>
          </>}
          <div className="income-detail-other-costs"><dt>Chi phí khác</dt><dd>{session.otherCosts.length ? <>
            <ul>{session.otherCosts.map((cost, index) => <li key={`${cost.name}-${index}`}><span><b>{cost.name}</b>{cost.note && <small>{cost.note}</small>}</span><strong>{formatVnd(cost.amount)}</strong></li>)}</ul>
            <em>Tổng chi phí: {formatVnd(session.otherCostsTotal)}</em>
          </> : <span className="muted">Không có</span>}</dd></div>
          <div className="income-detail-total"><dt>{companyTeacher ? "Phụ cấp hiển thị" : totalAmount.projected ? "Tổng dự kiến" : "Tổng thu nhập"}</dt><dd className={totalAmount.value === null ? "muted" : ""}>{totalAmount.label}</dd></div>
          <div><dt>Check-in</dt><dd>{formatIncomeCheckin(session)}</dd></div>
          <div><dt>Check-out</dt><dd>{formatIncomeCheckout(session)}</dd></div>
          {session.checkedAt && <div><dt>Xác nhận lúc</dt><dd>{formatTimestamp(session.checkedAt)}</dd></div>}
          {session.attendanceNote && <div><dt>Ghi chú chấm công</dt><dd>{session.attendanceNote}</dd></div>}
          {session.lessonName && <div><dt>Nội dung bài học</dt><dd>{session.lessonName}</dd></div>}
          {session.lessonEvaluation && <div><dt>Đánh giá buổi học</dt><dd>{session.lessonEvaluation}</dd></div>}
        </dl>
        {canReportLesson && <div className="income-detail-lesson-action">
          {dueLabel && <span className={lessonOverdue ? "overdue" : ""}>{lessonOverdue ? "Đã quá hạn báo giảng" : `Hạn báo giảng: ${dueLabel}`}</span>}
          <button type="button" className="mini-primary-button checkout-submit-button lesson" disabled={lessonOverdue} onClick={() => onReportLesson(session)}>{lessonOverdue ? "Đã quá hạn báo giảng" : "Báo giảng"}</button>
        </div>}
      </div>
    </section>
  </div>;
}

export function TeacherIncomeScreen({ onProfileMissing, onBackToSchedule, onLessonSubmitted, companyTeacher = false, initialMonth, refreshKey = 0 }: { onProfileMissing: () => void; onBackToSchedule: () => void; onLessonSubmitted?: () => void; companyTeacher?: boolean; initialMonth?: string; refreshKey?: number }) {
  const currentMonth = useMemo(() => currentMonthInVietnam(), []);
  const [month, setMonth] = useState(() => initialMonth ?? currentMonth);
  const [sessions, setSessions] = useState<TeacherIncomeSession[]>([]);
  const [selected, setSelected] = useState<TeacherIncomeSession | null>(null);
  const [reporting, setReporting] = useState<TeacherIncomeSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<IncomeError | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [visibleCount, setVisibleCount] = useState(20);
  const [attendanceTab, setAttendanceTab] = useState<AttendanceTab>("completed");
  const [incompleteFilter, setIncompleteFilter] = useState<IncompleteFilter>("all");

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);
    setSessions([]);
    setSelected(null);
    setReporting(null);
    setVisibleCount(20);
    setAttendanceTab("completed");
    setIncompleteFilter("all");

    fetchTeacherIncomeMonth(teacherMiniApi.sessions.me, month, controller.signal)
      .then((result) => { if (active) setSessions(result); })
      .catch((reason: unknown) => {
        if (!active || reason instanceof Error && reason.name === "AbortError") return;
        if (reason instanceof TeacherApiError && reason.status === 404) { onProfileMissing(); return; }
        if (reason instanceof TeacherApiError && reason.status === 401) {
          setError({ message: "Phiên đăng nhập đã hết hạn. Đang chuyển bạn về màn hình đăng nhập.", retryable: false });
          return;
        }
        if (reason instanceof TeacherApiError && reason.status === 403) {
          setError({ message: "Bạn không có quyền xem thông tin này", retryable: false });
          return;
        }
        setError({ message: "Không thể tải dữ liệu thu nhập. Vui lòng kiểm tra kết nối và thử lại.", retryable: true });
      })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; controller.abort(); };
  }, [month, onProfileMissing, retryKey, refreshKey]);

  const summary = useMemo(() => summarizeTeacherIncome(month, sessions), [month, sessions]);
  const completedSessions = useMemo(() => sessions.filter((session) => hasCompleteAttendanceEvidence(session) && session.status !== "SCHEDULED"), [sessions]);
  const uncheckedSessions = useMemo(() => sessions.filter((session) => hasCompleteAttendanceEvidence(session) && session.status === "SCHEDULED"), [sessions]);
  const incompleteSessions = useMemo(() => sessions.filter((session) => !hasCompleteAttendanceEvidence(session)), [sessions]);
  const completedPeriods = useMemo(() => totalPeriods(completedSessions), [completedSessions]);
  const uncheckedPeriods = useMemo(() => totalPeriods(uncheckedSessions), [uncheckedSessions]);
  const incompletePeriods = useMemo(() => totalPeriods(incompleteSessions), [incompleteSessions]);
  const missingCheckinPeriods = useMemo(() => totalPeriods(incompleteSessions.filter((session) => !hasCheckinEvidence(session))), [incompleteSessions]);
  const missingCheckoutPeriods = useMemo(() => totalPeriods(incompleteSessions.filter((session) => !hasCheckoutEvidence(session))), [incompleteSessions]);
  const missingLessonPeriods = useMemo(() => totalPeriods(incompleteSessions.filter(isMissingLessonReport)), [incompleteSessions]);
  const filteredIncompleteSessions = useMemo(() => incompleteSessions.filter((session) => matchesIncompleteFilter(session, incompleteFilter)), [incompleteSessions, incompleteFilter]);
  const filteredSessions = attendanceTab === "completed" ? completedSessions : attendanceTab === "unchecked" ? uncheckedSessions : filteredIncompleteSessions;
  const visibleSessions = useMemo(() => filteredSessions.slice(0, visibleCount), [filteredSessions, visibleCount]);
  const previousMonth = () => setMonth((value) => shiftMonth(value, -1));
  const nextMonth = () => setMonth((value) => shiftMonth(value, 1));
  const selectAttendanceTab = (tab: AttendanceTab) => { setAttendanceTab(tab); setVisibleCount(20); setSelected(null); };
  const selectIncompleteFilter = (filter: IncompleteFilter) => { setIncompleteFilter(filter); setVisibleCount(20); setSelected(null); };
  const handleLessonSuccess = async (updated: TeacherIncomeSession) => {
    setSessions((items) => items.map((item) => item.id === updated.id ? updated : item));
    setSelected((current) => current?.id === updated.id ? updated : current);
    setReporting(null);
    onLessonSubmitted?.();
  };

  return <div className="teacher-screen income-screen">
    <div className="screen-title"><div><h1>Thu nhập của tôi</h1><p>Theo dõi thu nhập từ các tiết đã được xác nhận</p></div></div>
    <div className="income-month-navigator" aria-label="Chọn tháng thu nhập">
      <button onClick={previousMonth} aria-label="Tháng trước">‹</button>
      <b>Tháng {formatMonth(month)}</b>
      <button onClick={nextMonth} aria-label="Tháng sau">›</button>
    </div>

    {loading ? <IncomeLoading /> : error ? <div className="income-error" role="alert"><span>!</span><b>Chưa thể tải thu nhập</b><p>{error.message}</p>{error.retryable && <button onClick={() => setRetryKey((value) => value + 1)}>Thử lại</button>}</div> : <>
      <section className="income-total-card" aria-label={`Tổng thu nhập tháng ${formatMonth(month)}`}>
        {companyTeacher ? <>
          <span>Tổng phụ cấp xăng tháng {formatMonth(month)}</span>
          <strong>{formatVnd(summary.totalGasAllowance)}</strong>
          <div className="income-total-breakdown">
            <div><small>Tổng số km</small><b>{summary.totalDistanceKm.toLocaleString("vi-VN")} km</b></div>
            <div><small>Số lần đến trường</small><b>{summary.payableVisits} lần</b></div>
          </div>
          <small>Tính theo các lần đến trường đã được xác nhận (Có dạy / Nghỉ có phép có phụ cấp) trong tháng — mỗi lần đến trường tính 1 lần dù dạy liên tục nhiều tiết.</small>
        </> : <>
          <span>Tổng thu nhập nếu hoàn thành tháng {formatMonth(month)}</span>
          <strong>{formatVnd(summary.projectedIncome)}</strong>
          <div className="income-total-breakdown">
            <div><small>Đã chốt</small><b>{formatVnd(summary.totalIncome)}</b></div>
            <div><small>Dự kiến còn lại</small><b>{formatVnd(Math.max(0, summary.projectedIncome - summary.totalIncome))}</b></div>
            <div><small>Số tiết dự kiến</small><b>{summary.projectedPeriods} tiết</b></div>
          </div>
          <small>Gồm các tiết đã chốt và các tiết có thể tính tiền nếu hoàn thành đủ chấm công, báo giảng.</small>
          {summary.sessionsWithoutAmount > 0 && <em>Có tiết đã xác nhận chưa có thành tiền nên chưa được cộng vào tổng.</em>}
        </>}
      </section>
      {sessions.length === 0 ? <div className="income-empty"><span>₫</span><b>Chưa có dữ liệu thu nhập trong tháng này.</b><p>Các buổi dạy sau khi được ghi nhận sẽ xuất hiện tại đây.</p><button onClick={onBackToSchedule}>Về lịch dạy</button></div> : <section className="income-session-section">
        <div className="income-attendance-tabs" role="tablist" aria-label="Lọc trạng thái chấm công">
          <button type="button" role="tab" aria-selected={attendanceTab === "completed"} className={attendanceTab === "completed" ? "active" : ""} onClick={() => selectAttendanceTab("completed")}><span>Hoàn thành</span><b>{completedPeriods} tiết</b></button>
          <button type="button" role="tab" aria-selected={attendanceTab === "unchecked"} className={attendanceTab === "unchecked" ? "active" : ""} onClick={() => selectAttendanceTab("unchecked")}><span>Chưa chấm công từ nhân sự</span><b>{uncheckedPeriods} tiết</b></button>
          <button type="button" role="tab" aria-selected={attendanceTab === "incomplete"} className={attendanceTab === "incomplete" ? "active" : ""} onClick={() => selectAttendanceTab("incomplete")}><span>Chưa đủ 3 yếu tố</span><b>{incompletePeriods} tiết</b></button>
        </div>
        {attendanceTab === "incomplete" && <div className="income-incomplete-filters" aria-label="Lọc yếu tố còn thiếu">
          <button type="button" className={incompleteFilter === "all" ? "active" : ""} aria-pressed={incompleteFilter === "all"} onClick={() => selectIncompleteFilter("all")}><span>Tất cả</span><b>{incompletePeriods} tiết</b></button>
          <button type="button" className={incompleteFilter === "checkin" ? "active" : ""} aria-pressed={incompleteFilter === "checkin"} onClick={() => selectIncompleteFilter("checkin")}><span>Thiếu check-in</span><b>{missingCheckinPeriods} tiết</b></button>
          <button type="button" className={incompleteFilter === "checkout" ? "active" : ""} aria-pressed={incompleteFilter === "checkout"} onClick={() => selectIncompleteFilter("checkout")}><span>Thiếu check-out</span><b>{missingCheckoutPeriods} tiết</b></button>
          <button type="button" className={incompleteFilter === "lesson" ? "active" : ""} aria-pressed={incompleteFilter === "lesson"} onClick={() => selectIncompleteFilter("lesson")}><span>Thiếu báo giảng</span><b>{missingLessonPeriods} tiết</b></button>
        </div>}
        <h2>{attendanceTab === "completed" ? "Các tiết hoàn thành" : attendanceTab === "unchecked" ? "Các tiết chưa chấm công từ nhân sự" : "Các tiết chưa đủ 3 yếu tố để chấm công"}</h2>
        {filteredSessions.length === 0 ? <div className="income-filter-empty"><b>{attendanceTab === "completed" ? "Chưa có tiết hoàn thành" : attendanceTab === "unchecked" ? "Không còn tiết chờ nhân sự chấm công" : "Không còn tiết thiếu thông tin"}</b><p>{attendanceTab === "completed" ? "Tiết đủ check-in, check-out, báo giảng và đã được Nhân sự xác nhận sẽ xuất hiện tại đây." : attendanceTab === "unchecked" ? "Tiết đã đủ 3 yếu tố nhưng chưa được Nhân sự chấm công sẽ xuất hiện tại đây." : "Tiết thiếu check-in, check-out hoặc báo giảng sẽ xuất hiện tại đây."}</p></div> : <div className="income-session-list">{visibleSessions.map((session) => {
          const status = sessionStatus(session);
          const totalAmount = displayTotalAmount(session, companyTeacher);
          return <button type="button" key={session.id} onClick={() => setSelected(session)} aria-label={`Xem chi tiết thu nhập ngày ${formatIncomeDate(session.date)}`}>
            <header><div><b>{incomeDayLabel(session.date)}, {formatIncomeDate(session.date)}</b><span>{formatIncomeTime(session.startTime)}–{formatIncomeTime(session.endTime)}</span></div><em className={`income-badge ${status.state}`}>{status.label}</em></header>
            <div className="income-session-place"><strong>{session.schoolName || "Chưa cập nhật trường"} · Lớp {session.className || "—"}</strong><span>{session.subjectName || "Chưa cập nhật môn học"}</span></div>
            <footer><div><span>{companyTeacher ? "Phụ cấp xăng" : <>{periodsText(session.periods)}{session.periods !== null && " × "}{session.periods !== null && rateText(session.ratePerPeriod)}</>}</span>{companyTeacher && session.gasAllowance === null ? <small>Cần cập nhật vị trí hoặc cấu hình bậc phụ cấp</small> : session.otherCostsTotal > 0 ? <small>Gồm chi phí khác {formatVnd(session.otherCostsTotal)}</small> : !companyTeacher && session.ratePerPeriod === null && <small>Chưa có đơn giá</small>}{totalAmount.projected && <small>Dự kiến nếu hoàn thành</small>}</div><b className={totalAmount.value === null ? "muted" : ""}>{totalAmount.label}</b><i>›</i></footer>
          </button>;
        })}</div>}
        {visibleCount < filteredSessions.length && <button className="income-load-more" onClick={() => setVisibleCount((value) => value + 20)}>Xem thêm</button>}
      </section>}
    </>}
    {selected && <IncomeDetailSheet session={selected} onClose={() => setSelected(null)} onReportLesson={setReporting} companyTeacher={companyTeacher} />}
    {reporting && <IncomeLessonReportSheet session={reporting} onClose={() => setReporting(null)} onSuccess={handleLessonSuccess} />}
  </div>;
}
