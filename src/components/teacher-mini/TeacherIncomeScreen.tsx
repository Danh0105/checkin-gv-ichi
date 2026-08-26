import { useEffect, useMemo, useState } from "react";

import { TeacherApiError, teacherMiniApi } from "@/services/teacher-mini-api";
import {
  currentMonthInVietnam,
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
} from "@/utils/teacher-income";

type IncomeError = { message: string; retryable: boolean };
type AttendanceTab = "checked" | "unchecked";

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

function IncomeLoading() {
  return <div className="income-loading" aria-label="Đang tải dữ liệu thu nhập" aria-busy="true">
    <div className="income-summary-skeleton"><span /><b /><small /></div>
    <div className="income-stats-skeleton">{[1, 2, 3, 4].map((item) => <span key={item} />)}</div>
    <div className="income-list-skeleton">{[1, 2, 3].map((item) => <div key={item}><b /><span /><span /></div>)}</div>
  </div>;
}

function IncomeDetailSheet({ session, onClose }: { session: TeacherIncomeSession; onClose: () => void }) {
  const status = sessionStatus(session);
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
          <div><dt>Đơn giá mỗi tiết</dt><dd className={session.ratePerPeriod === null ? "muted" : ""}>{rateText(session.ratePerPeriod)}</dd></div>
          <div><dt>Tiền tiết dạy</dt><dd className={session.amount === null ? "muted" : ""}>{amountText(session.amount)}</dd></div>
          <div className="income-detail-other-costs"><dt>Chi phí khác</dt><dd>{session.otherCosts.length ? <>
            <ul>{session.otherCosts.map((cost, index) => <li key={`${cost.name}-${index}`}><span><b>{cost.name}</b>{cost.note && <small>{cost.note}</small>}</span><strong>{formatVnd(cost.amount)}</strong></li>)}</ul>
            <em>Tổng chi phí: {formatVnd(session.otherCostsTotal)}</em>
          </> : <span className="muted">Không có</span>}</dd></div>
          <div className="income-detail-total"><dt>Tổng thu nhập</dt><dd className={session.totalAmount === null ? "muted" : ""}>{amountText(session.totalAmount)}</dd></div>
          <div><dt>Check-in</dt><dd>{formatTimestamp(session.checkinAt)}</dd></div>
          <div><dt>Check-out</dt><dd>{formatTimestamp(session.checkoutAt)}</dd></div>
          {session.checkedAt && <div><dt>Xác nhận lúc</dt><dd>{formatTimestamp(session.checkedAt)}</dd></div>}
          {session.attendanceNote && <div><dt>Ghi chú chấm công</dt><dd>{session.attendanceNote}</dd></div>}
          {session.lessonName && <div><dt>Nội dung bài học</dt><dd>{session.lessonName}</dd></div>}
          {session.lessonEvaluation && <div><dt>Đánh giá buổi học</dt><dd>{session.lessonEvaluation}</dd></div>}
        </dl>
      </div>
    </section>
  </div>;
}

export function TeacherIncomeScreen({ onProfileMissing, onBackToSchedule, initialMonth }: { onProfileMissing: () => void; onBackToSchedule: () => void; initialMonth?: string }) {
  const currentMonth = useMemo(() => currentMonthInVietnam(), []);
  const [month, setMonth] = useState(() => initialMonth && initialMonth <= currentMonth ? initialMonth : currentMonth);
  const [sessions, setSessions] = useState<TeacherIncomeSession[]>([]);
  const [selected, setSelected] = useState<TeacherIncomeSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<IncomeError | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [visibleCount, setVisibleCount] = useState(20);
  const [attendanceTab, setAttendanceTab] = useState<AttendanceTab>("checked");

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);
    setSessions([]);
    setSelected(null);
    setVisibleCount(20);
    setAttendanceTab("checked");

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
  }, [month, onProfileMissing, retryKey]);

  const summary = useMemo(() => summarizeTeacherIncome(month, sessions), [month, sessions]);
  const checkedSessions = useMemo(() => sessions.filter((session) => session.status !== "SCHEDULED"), [sessions]);
  const uncheckedSessions = useMemo(() => sessions.filter((session) => session.status === "SCHEDULED"), [sessions]);
  const filteredSessions = attendanceTab === "checked" ? checkedSessions : uncheckedSessions;
  const visibleSessions = useMemo(() => filteredSessions.slice(0, visibleCount), [filteredSessions, visibleCount]);
  const previousMonth = () => setMonth((value) => shiftMonth(value, -1));
  const nextMonth = () => setMonth((value) => value < currentMonth ? shiftMonth(value, 1) : value);
  const selectAttendanceTab = (tab: AttendanceTab) => { setAttendanceTab(tab); setVisibleCount(20); setSelected(null); };

  return <div className="teacher-screen income-screen">
    <div className="screen-title"><div><h1>Thu nhập của tôi</h1><p>Theo dõi thu nhập từ các buổi đã được xác nhận</p></div></div>
    <div className="income-month-navigator" aria-label="Chọn tháng thu nhập">
      <button onClick={previousMonth} aria-label="Tháng trước">‹</button>
      <b>Tháng {formatMonth(month)}</b>
      <button onClick={nextMonth} disabled={month >= currentMonth} aria-label="Tháng sau">›</button>
    </div>

    {loading ? <IncomeLoading /> : error ? <div className="income-error" role="alert"><span>!</span><b>Chưa thể tải thu nhập</b><p>{error.message}</p>{error.retryable && <button onClick={() => setRetryKey((value) => value + 1)}>Thử lại</button>}</div> : <>
      <section className="income-total-card" aria-label={`Tổng thu nhập tháng ${formatMonth(month)}`}>
        <span>Tổng thu nhập tháng {formatMonth(month)}</span>
        <strong>{formatVnd(summary.totalIncome)}</strong>
        <small>Thu nhập tạm tính dựa trên các buổi đã được xác nhận.</small>
        {summary.sessionsWithoutAmount > 0 && <em>{summary.sessionsWithoutAmount} buổi đã xác nhận chưa có thành tiền nên chưa được cộng vào tổng.</em>}
      </section>
      <section className="income-stat-grid" aria-label="Thống kê thu nhập">
        <div><b>{summary.payableSessions}</b><span>Buổi được tính công</span></div>
        <div><b>{summary.payablePeriods}</b><span>Tiết được tính công</span></div>
        <div><b>{summary.pendingSessions}</b><span>Buổi chờ xác nhận</span></div>
        <div><b>{summary.sessionsWithoutRate}</b><span>Buổi chưa có đơn giá</span></div>
      </section>

      {sessions.length === 0 ? <div className="income-empty"><span>₫</span><b>Chưa có dữ liệu thu nhập trong tháng này.</b><p>Các buổi dạy sau khi được ghi nhận sẽ xuất hiện tại đây.</p><button onClick={onBackToSchedule}>Về lịch dạy</button></div> : <section className="income-session-section">
        <div className="income-attendance-tabs" role="tablist" aria-label="Lọc trạng thái chấm công">
          <button type="button" role="tab" aria-selected={attendanceTab === "checked"} className={attendanceTab === "checked" ? "active" : ""} onClick={() => selectAttendanceTab("checked")}><span>Đã chấm công</span><b>{checkedSessions.length}</b></button>
          <button type="button" role="tab" aria-selected={attendanceTab === "unchecked"} className={attendanceTab === "unchecked" ? "active" : ""} onClick={() => selectAttendanceTab("unchecked")}><span>Chưa chấm công</span><b>{uncheckedSessions.length}</b></button>
        </div>
        <h2>{attendanceTab === "checked" ? "Các buổi đã chấm công" : "Các buổi chưa chấm công"}</h2>
        {filteredSessions.length === 0 ? <div className="income-filter-empty"><b>{attendanceTab === "checked" ? "Chưa có buổi đã chấm công" : "Không còn buổi chưa chấm công"}</b><p>{attendanceTab === "checked" ? "Buổi dạy sau khi được Nhân sự xác nhận sẽ xuất hiện tại đây." : "Tất cả buổi dạy trong tháng đã được xử lý."}</p></div> : <div className="income-session-list">{visibleSessions.map((session) => {
          const status = sessionStatus(session);
          return <button type="button" key={session.id} onClick={() => setSelected(session)} aria-label={`Xem chi tiết thu nhập ngày ${formatIncomeDate(session.date)}`}>
            <header><div><b>{incomeDayLabel(session.date)}, {formatIncomeDate(session.date)}</b><span>{formatIncomeTime(session.startTime)}–{formatIncomeTime(session.endTime)}</span></div><em className={`income-badge ${status.state}`}>{status.label}</em></header>
            <div className="income-session-place"><strong>{session.schoolName || "Chưa cập nhật trường"} · Lớp {session.className || "—"}</strong><span>{session.subjectName || "Chưa cập nhật môn học"}</span></div>
            <footer><div><span>{periodsText(session.periods)}{session.periods !== null && " × "}{session.periods !== null && rateText(session.ratePerPeriod)}</span>{session.otherCostsTotal > 0 ? <small>Gồm chi phí khác {formatVnd(session.otherCostsTotal)}</small> : session.ratePerPeriod === null && <small>Chưa có đơn giá</small>}</div><b className={session.totalAmount === null ? "muted" : ""}>{amountText(session.totalAmount)}</b><i>›</i></footer>
          </button>;
        })}</div>}
        {visibleCount < filteredSessions.length && <button className="income-load-more" onClick={() => setVisibleCount((value) => value + 20)}>Xem thêm</button>}
      </section>}
    </>}
    {selected && <IncomeDetailSheet session={selected} onClose={() => setSelected(null)} />}
  </div>;
}
