import { useEffect, useMemo, useState } from "react";

import Logo from "@/components/logo";
import { AttendanceListParams, attendanceAdminApi, TeacherApiError } from "@/services/teacher-mini-api";
import {
  AttendanceOtherCost,
  AttendanceSummary,
  BulkAttendanceItem,
  SessionStatus,
  TeachingSession,
  TeachingUser,
} from "@/types/teaching";
import {
  ATTENDANCE_OTHER_COST_LIMIT,
  AttendanceDraft,
  AttendanceOtherCostInput,
  attendanceDraftFromSession,
  attendanceOtherCostsTotal,
  attendancePayloadFromDraft,
  isAttendanceDraftDirty,
  normalizeAttendanceOtherCosts,
  parseAttendanceAmount,
} from "@/utils/attendance-other-costs";
import { currentMonthInVietnam, monthRange } from "@/utils/teacher-income";

const moneyFormatter = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });
const statusLabels: Record<SessionStatus, string> = {
  SCHEDULED: "Chưa chấm",
  PRESENT: "Có dạy",
  ABSENT: "Vắng",
  EXCUSED: "Nghỉ có phép",
  CANCELLED: "Đã huỷ",
};
const statuses = Object.keys(statusLabels) as SessionStatus[];

function formatMoney(value: number | null | undefined, emptyWhenZero = false) {
  if (typeof value !== "number" || !Number.isFinite(value) || emptyWhenZero && value === 0) return "—";
  return `${moneyFormatter.format(value)} ₫`;
}

function formatDate(value: string) {
  const parts = value.split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : value;
}

function formatTime(value: string) {
  return value?.slice(0, 5) || "—";
}

async function fetchAttendanceMonth(params: Omit<AttendanceListParams, "page" | "limit">, signal: AbortSignal) {
  const byId = new Map<number, TeachingSession>();
  let page = 1;
  let totalPages = 1;
  do {
    const response = await attendanceAdminApi.list({ ...params, page, limit: 100 }, signal);
    (response.data || []).forEach((session) => byId.set(session.id, {
      ...session,
      otherCosts: Array.isArray(session.otherCosts) ? session.otherCosts : [],
      otherCostsTotal: typeof session.otherCostsTotal === "number" ? session.otherCostsTotal : 0,
    }));
    const reportedPages = Number(response.pagination?.totalPages);
    totalPages = Number.isInteger(reportedPages) && reportedPages > 0 ? reportedPages : 1;
    if (totalPages > 500) throw new Error("Dữ liệu chấm công quá lớn để tải an toàn.");
    page += 1;
  } while (page <= totalPages);
  return [...byId.values()].sort((left, right) => left.date.localeCompare(right.date) || left.startTime.localeCompare(right.startTime) || left.id - right.id);
}

type CostEditorRow = { name: string; amount: string; note: string };

function OtherCostsEditor({ draft, onClose, onSave }: { draft: AttendanceDraft; onClose: () => void; onSave: (costs: AttendanceOtherCost[]) => void }) {
  const [rows, setRows] = useState<CostEditorRow[]>(() => draft.otherCosts.map((cost) => ({
    name: cost.name,
    amount: String(cost.amount),
    note: cost.note ?? "",
  })));
  const [error, setError] = useState("");

  const change = (index: number, field: keyof CostEditorRow, value: string) => {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
    setError("");
  };
  const add = (name: string) => {
    if (rows.length >= ATTENDANCE_OTHER_COST_LIMIT) {
      setError(`Mỗi buổi chỉ được thêm tối đa ${ATTENDANCE_OTHER_COST_LIMIT} khoản chi phí.`);
      return;
    }
    setRows((current) => [...current, { name, amount: "", note: "" }]);
    setError("");
  };
  const remove = (index: number) => {
    setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
    setError("");
  };
  const previewAmounts = rows.map((row) => {
    try { return parseAttendanceAmount(row.amount); }
    catch { return 0; }
  });
  const total = previewAmounts.reduce((sum, amount) => sum + amount, 0);

  const save = () => {
    try {
      const inputs: AttendanceOtherCostInput[] = rows.map((row) => row);
      onSave(normalizeAttendanceOtherCosts(inputs));
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Chi phí khác không hợp lệ.");
    }
  };

  return <div className="attendance-cost-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="attendance-cost-modal" role="dialog" aria-modal="true" aria-labelledby="attendance-cost-title">
      <header><div><span className="attendance-modal-handle" /><h2 id="attendance-cost-title">Chi phí khác</h2><p>Thêm các khoản phát sinh của buổi dạy</p></div><button type="button" onClick={onClose} aria-label="Đóng">×</button></header>
      <div className="attendance-cost-content">
        {draft.status !== "PRESENT" && <p className="attendance-cost-notice">Chi phí chỉ được cộng vào bảng thanh toán khi buổi dạy ở trạng thái “Có dạy”.</p>}
        <div className="attendance-cost-quick-actions" aria-label="Thêm nhanh chi phí">
          <button type="button" onClick={() => add("Xăng xe")}>+ Xăng xe</button>
          <button type="button" onClick={() => add("Phụ cấp")}>+ Phụ cấp</button>
          <button type="button" onClick={() => add("")}>+ Khoản khác</button>
        </div>
        {rows.length === 0 ? <div className="attendance-cost-empty"><b>Chưa có chi phí khác</b><span>Chọn một nút thêm nhanh ở trên để bắt đầu.</span></div> : <div className="attendance-cost-list">
          {rows.map((row, index) => <fieldset key={index} className="attendance-cost-row">
            <legend>Khoản {index + 1}</legend>
            <label>Tên khoản <b>*</b><input value={row.name} maxLength={100} onChange={(event) => change(index, "name", event.target.value)} placeholder="Ví dụ: Xăng xe" /></label>
            <label>Số tiền <b>*</b><div className="attendance-amount-input"><input value={row.amount} inputMode="decimal" maxLength={30} onChange={(event) => change(index, "amount", event.target.value)} placeholder="0" /><span>₫</span></div></label>
            <label className="attendance-cost-note">Ghi chú <small>Không bắt buộc</small><textarea value={row.note} maxLength={500} rows={2} onChange={(event) => change(index, "note", event.target.value)} placeholder="Nhập ghi chú" /></label>
            <button className="attendance-cost-delete" type="button" onClick={() => remove(index)} aria-label={`Xóa khoản ${index + 1}`}>Xóa</button>
          </fieldset>)}
        </div>}
        {error && <p className="attendance-cost-error" role="alert">{error}</p>}
      </div>
      <footer><div><span>Tổng chi phí</span><strong>{formatMoney(total)}</strong></div><button type="button" onClick={save}>Áp dụng</button></footer>
    </section>
  </div>;
}

function SummarySection({ summary }: { summary: AttendanceSummary | null }) {
  const rows = summary?.teachers ?? summary?.data ?? [];
  const grandTotal = summary?.grandTotal;
  return <section className="attendance-summary" aria-labelledby="attendance-summary-title">
    <div className="attendance-section-heading"><div><h2 id="attendance-summary-title">Bảng tổng hợp thanh toán</h2><p>Số liệu do backend tổng hợp từ các buổi đã chấm “Có dạy”.</p></div></div>
    <div className="attendance-summary-cards">
      <div><span>Tiền tiết dạy</span><strong>{formatMoney(grandTotal?.payableAmount ?? 0)}</strong></div>
      <div><span>Chi phí khác</span><strong>{formatMoney(grandTotal?.otherCostsAmount ?? 0)}</strong></div>
      <div className="total"><span>Tổng thanh toán</span><strong>{formatMoney(grandTotal?.totalPayableAmount ?? 0)}</strong></div>
    </div>
    {rows.length > 0 && <div className="attendance-summary-table-wrap"><table className="attendance-summary-table">
      <thead><tr><th>Giáo viên</th><th>Tiền tiết dạy</th><th>Chi phí khác</th><th>Tổng thanh toán</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.teacherId}><td>{row.teacherName}</td><td data-label="Tiền tiết dạy">{formatMoney(row.payableAmount)}</td><td data-label="Chi phí khác">{formatMoney(row.otherCostsAmount)}</td><td data-label="Tổng thanh toán"><b>{formatMoney(row.totalPayableAmount)}</b></td></tr>)}</tbody>
    </table></div>}
  </section>;
}

export default function AttendanceAdminScreen({ user, onLogout }: { user: TeachingUser; onLogout: () => void }) {
  const [month, setMonth] = useState(() => currentMonthInVietnam());
  const [sessions, setSessions] = useState<TeachingSession[]>([]);
  const [drafts, setDrafts] = useState<Record<number, AttendanceDraft>>({});
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [editingCostsId, setEditingCostsId] = useState<number | null>(null);
  const [savingIds, setSavingIds] = useState<Set<number>>(() => new Set());
  const [bulkSaving, setBulkSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState<{ text: string; tone: "success" | "error" } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const range = useMemo(() => monthRange(month), [month]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setLoadError("");
    setEditingCostsId(null);
    Promise.all([
      fetchAttendanceMonth(range, controller.signal),
      attendanceAdminApi.summary(range, controller.signal),
    ]).then(([loadedSessions, loadedSummary]) => {
      if (!active) return;
      setSessions(loadedSessions);
      setDrafts(Object.fromEntries(loadedSessions.map((session) => [session.id, attendanceDraftFromSession(session)])));
      setSummary(loadedSummary);
      setSelectedIds(new Set());
    }).catch((reason: unknown) => {
      if (!active || reason instanceof Error && reason.name === "AbortError") return;
      setLoadError(reason instanceof TeacherApiError ? reason.message : "Không thể tải dữ liệu chấm công. Vui lòng thử lại.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [range, reloadKey]);

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [message]);

  const updateDraft = (sessionId: number, updater: (draft: AttendanceDraft) => AttendanceDraft) => {
    setDrafts((current) => {
      const existing = current[sessionId];
      return existing ? { ...current, [sessionId]: updater(existing) } : current;
    });
    setSelectedIds((current) => new Set(current).add(sessionId));
  };

  const changeStatus = (session: TeachingSession, status: SessionStatus) => {
    const draft = drafts[session.id];
    if (!draft || draft.status === status) return;
    let otherCosts = draft.otherCosts;
    if (status === "SCHEDULED" && draft.status !== "SCHEDULED" && otherCosts.length > 0) {
      const confirmed = window.confirm("Bỏ chấm sẽ xóa toàn bộ chi phí khác của buổi này. Bạn có chắc muốn tiếp tục?");
      if (!confirmed) return;
      otherCosts = [];
    }
    updateDraft(session.id, (current) => ({ ...current, status, otherCosts }));
  };

  const refreshSummary = async () => {
    try { setSummary(await attendanceAdminApi.summary(range)); }
    catch { setMessage({ text: "Đã lưu buổi dạy nhưng chưa thể tải lại bảng tổng hợp.", tone: "error" }); }
  };

  const saveOne = async (session: TeachingSession) => {
    const draft = drafts[session.id];
    if (!draft) return;
    try {
      const payload = attendancePayloadFromDraft(draft);
      setSavingIds((current) => new Set(current).add(session.id));
      const response = await attendanceAdminApi.update(session.id, payload);
      const updated: TeachingSession = {
        ...session,
        ...response,
        otherCosts: Array.isArray(response.otherCosts) ? response.otherCosts : payload.otherCosts ?? [],
        otherCostsTotal: typeof response.otherCostsTotal === "number" ? response.otherCostsTotal : 0,
      };
      setSessions((current) => current.map((item) => item.id === session.id ? updated : item));
      setDrafts((current) => ({ ...current, [session.id]: attendanceDraftFromSession(updated) }));
      setSelectedIds((current) => { const next = new Set(current); next.delete(session.id); return next; });
      setMessage({ text: "Đã lưu chấm công và chi phí khác.", tone: "success" });
      void refreshSummary();
    } catch (reason) {
      setMessage({ text: reason instanceof Error ? reason.message : "Không thể lưu chấm công.", tone: "error" });
    } finally {
      setSavingIds((current) => { const next = new Set(current); next.delete(session.id); return next; });
    }
  };

  const dirtySelected = sessions.filter((session) => selectedIds.has(session.id) && drafts[session.id] && isAttendanceDraftDirty(session, drafts[session.id]));
  const saveBulk = async () => {
    if (!dirtySelected.length) return;
    try {
      const items: BulkAttendanceItem[] = dirtySelected.map((session) => ({
        sessionId: session.id,
        ...attendancePayloadFromDraft(drafts[session.id]),
      }));
      setBulkSaving(true);
      await attendanceAdminApi.bulkUpdate(items);
      setMessage({ text: `Đã lưu ${items.length} buổi chấm công.`, tone: "success" });
      setReloadKey((value) => value + 1);
    } catch (reason) {
      setMessage({ text: reason instanceof Error ? reason.message : "Không thể lưu chấm công hàng loạt.", tone: "error" });
    } finally { setBulkSaving(false); }
  };

  const editingDraft = editingCostsId === null ? null : drafts[editingCostsId];
  const allSelected = sessions.length > 0 && sessions.every((session) => selectedIds.has(session.id));

  return <main className="attendance-admin-page">
    <header className="attendance-admin-header"><Logo /><div><span>Giảng dạy <i>›</i> Chấm công</span><strong>Chi tiết chấm công</strong></div><section><small>{user.name}</small><button type="button" onClick={onLogout}>Đăng xuất</button></section></header>
    <div className="attendance-admin-content">
      <section className="attendance-toolbar">
        <div><h1>Chi tiết chấm công</h1><p>Chốt trạng thái, ghi chú và các khoản phát sinh theo từng buổi dạy.</p></div>
        <label>Tháng<input type="month" value={month} onChange={(event) => event.target.value && setMonth(event.target.value)} /></label>
      </section>

      {loading ? <div className="attendance-admin-loading" aria-busy="true"><span /><span /><span /></div> : loadError ? <div className="attendance-admin-error" role="alert"><b>Chưa thể tải dữ liệu</b><p>{loadError}</p><button type="button" onClick={() => setReloadKey((value) => value + 1)}>Thử lại</button></div> : <>
        <SummarySection summary={summary} />
        <section className="attendance-detail-section" aria-labelledby="attendance-detail-title">
          <div className="attendance-section-heading"><div><h2 id="attendance-detail-title">Danh sách buổi dạy</h2><p>{sessions.length} buổi trong tháng đã chọn</p></div><button type="button" onClick={saveBulk} disabled={bulkSaving || dirtySelected.length === 0}>{bulkSaving ? "Đang lưu…" : `Lưu hàng loạt (${dirtySelected.length})`}</button></div>
          {sessions.length === 0 ? <div className="attendance-admin-empty">Không có buổi dạy trong tháng này.</div> : <div className="attendance-detail-table-wrap"><table className="attendance-detail-table">
            <thead><tr><th className="attendance-check-cell"><input type="checkbox" checked={allSelected} onChange={(event) => setSelectedIds(event.target.checked ? new Set(sessions.map((session) => session.id)) : new Set())} aria-label="Chọn tất cả buổi dạy" /></th><th>Buổi dạy</th><th>Giáo viên</th><th>Trạng thái</th><th>Ghi chú chấm công</th><th>Tiền tiết dạy</th><th>Chi phí khác</th><th>Tổng tiền</th><th /></tr></thead>
            <tbody>{sessions.map((session) => {
              const draft = drafts[session.id];
              if (!draft) return null;
              const dirty = isAttendanceDraftDirty(session, draft);
              const savedCostTotal = typeof session.otherCostsTotal === "number" ? session.otherCostsTotal : 0;
              const costTotal = dirty ? attendanceOtherCostsTotal(draft.otherCosts) : savedCostTotal;
              const saving = savingIds.has(session.id);
              return <tr key={session.id} className={dirty ? "dirty" : ""}>
                <td className="attendance-check-cell"><input type="checkbox" checked={selectedIds.has(session.id)} onChange={(event) => setSelectedIds((current) => { const next = new Set(current); if (event.target.checked) next.add(session.id); else next.delete(session.id); return next; })} aria-label={`Chọn buổi ${formatDate(session.date)} của ${session.teacherName || "giáo viên"}`} /></td>
                <td data-label="Buổi dạy"><div className="attendance-session-cell"><b>{formatDate(session.date)} · {formatTime(session.startTime)}–{formatTime(session.endTime)}</b><span>{session.subjectName} · {session.className || "—"}</span><small>{session.schoolName}</small></div></td>
                <td data-label="Giáo viên"><b>{session.teacherName || "Chưa phân công"}</b></td>
                <td data-label="Trạng thái"><select value={draft.status} onChange={(event) => changeStatus(session, event.target.value as SessionStatus)} aria-label={`Trạng thái buổi ${session.id}`}>{statuses.map((status) => <option value={status} key={status}>{statusLabels[status]}</option>)}</select></td>
                <td data-label="Ghi chú chấm công"><textarea rows={2} maxLength={500} value={draft.attendanceNote} onChange={(event) => updateDraft(session.id, (current) => ({ ...current, attendanceNote: event.target.value }))} placeholder="Nhập ghi chú" aria-label={`Ghi chú chấm công buổi ${session.id}`} /></td>
                <td data-label="Tiền tiết dạy" className="attendance-money-cell">{formatMoney(session.amount)}</td>
                <td data-label="Chi phí khác"><button type="button" className="attendance-cost-open" onClick={() => setEditingCostsId(session.id)}><b>{formatMoney(costTotal, true)}</b><span>{draft.otherCosts.length ? `${draft.otherCosts.length} khoản · Sửa` : "+ Thêm khoản"}</span></button></td>
                <td data-label="Tổng tiền" className="attendance-money-cell total">{formatMoney(session.totalAmount ?? session.amount)}</td>
                <td className="attendance-row-action"><button type="button" onClick={() => void saveOne(session)} disabled={!dirty || saving || bulkSaving}>{saving ? "Đang lưu…" : "Lưu"}</button>{dirty && <small>Đã sửa</small>}</td>
              </tr>;
            })}</tbody>
          </table></div>}
        </section>
      </>}
    </div>
    {editingDraft && <OtherCostsEditor draft={editingDraft} onClose={() => setEditingCostsId(null)} onSave={(otherCosts) => editingCostsId !== null && updateDraft(editingCostsId, (current) => ({ ...current, otherCosts }))} />}
    {message && <div className={`attendance-admin-toast ${message.tone}`} role="status">{message.text}</div>}
  </main>;
}
