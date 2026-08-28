import { AttendanceOtherCost, ListResponse, SessionStatus, TeachingSession } from "@/types/teaching";

export type TeacherIncomeSession = {
  id: number;
  date: string;
  startTime: string;
  endTime: string;
  schoolName: string;
  className: string | null;
  subjectName: string;
  periods: number | null;
  ratePerPeriod: number | null;
  amount: number | null;
  distanceToSchoolKm: number | null;
  gasAllowance: number | null;
  otherCosts: AttendanceOtherCost[];
  otherCostsTotal: number;
  totalAmount: number | null;
  status: SessionStatus;
  statusLabel: string | null;
  checkedAt: string | null;
  checkinRequired: boolean | null;
  checkinAt: string | null;
  checkoutRequired: boolean | null;
  checkoutAt: string | null;
  checkoutViaAdjacent: boolean | null;
  attendanceNote: string | null;
  lessonName: string | null;
  lessonEvaluation: string | null;
  lessonSubmittedAt: string | null;
  lessonReportDueAt: string | null;
};

export type TeacherIncomeSummary = {
  month: string;
  totalIncome: number;
  projectedIncome: number;
  projectedSessions: number;
  projectedPeriods: number;
  payableSessions: number;
  payablePeriods: number;
  pendingSessions: number;
  sessionsWithoutRate: number;
  sessionsWithoutAmount: number;
  /** Phụ cấp xăng chỉ tính 1 lần cho mỗi lần đến trường (session mở block, checkinRequired === true) — tránh cộng trùng các tiết liên tục cùng buổi. */
  totalGasAllowance: number;
  totalDistanceKm: number;
  payableVisits: number;
};

export type IncomeState = "confirmed" | "pending" | "not-payable";

type MineParams = {
  fromDate: string;
  toDate: string;
  page?: number;
  limit?: number;
};

export type IncomePageLoader = (params: MineParams, signal?: AbortSignal) => Promise<ListResponse<TeachingSession>>;

const VND_FORMATTER = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
});

const pad = (value: number) => String(value).padStart(2, "0");
const finiteMoney = (value: number | null): value is number => value !== null && Number.isFinite(value);
const finiteNumberOrNull = (value: number | null | undefined) => typeof value === "number" && Number.isFinite(value) ? value : null;

export function currentMonthInVietnam(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!year || !month) throw new Error("Không thể xác định tháng hiện tại.");
  return `${year}-${month}`;
}

export function monthRange(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error("Tháng không hợp lệ.");
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) throw new Error("Tháng không hợp lệ.");
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return { fromDate: `${year}-${pad(monthIndex + 1)}-01`, toDate: `${year}-${pad(monthIndex + 1)}-${pad(lastDay)}` };
}

export function shiftMonth(month: string, amount: number) {
  const { fromDate } = monthRange(month);
  const [year, monthNumber] = fromDate.split("-").map(Number);
  const shifted = new Date(year, monthNumber - 1 + amount, 1);
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}`;
}

export function formatMonth(month: string) {
  const { fromDate } = monthRange(month);
  const [year, monthNumber] = fromDate.split("-");
  return `${monthNumber}/${year}`;
}

export function formatIncomeDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function incomeDayLabel(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return "";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"][date.getDay()];
}

export function formatIncomeTime(value: string | null | undefined) {
  return value ? value.slice(0, 5) : "—";
}

export function formatVnd(value: number) {
  return VND_FORMATTER.format(value).replace(/\u00a0/g, " ");
}

export function estimateTeachingAmount(session: Pick<TeacherIncomeSession, "amount" | "periods" | "ratePerPeriod">) {
  if (finiteMoney(session.amount)) return session.amount;
  if (session.periods !== null && Number.isFinite(session.periods) && finiteMoney(session.ratePerPeriod)) return session.periods * session.ratePerPeriod;
  return null;
}

export function estimateSessionTotal(session: Pick<TeacherIncomeSession, "amount" | "periods" | "ratePerPeriod" | "otherCostsTotal" | "totalAmount">) {
  if (finiteMoney(session.totalAmount)) return session.totalAmount;
  const teachingAmount = estimateTeachingAmount(session);
  return teachingAmount === null ? null : teachingAmount + session.otherCostsTotal;
}

export function toTeacherIncomeSession(session: TeachingSession): TeacherIncomeSession {
  const amount = finiteNumberOrNull(session.amount);
  return {
    id: session.id,
    date: session.date,
    startTime: session.startTime,
    endTime: session.endTime,
    schoolName: session.schoolName,
    className: session.className ?? null,
    subjectName: session.subjectName,
    periods: finiteNumberOrNull(session.periods),
    ratePerPeriod: finiteNumberOrNull(session.ratePerPeriod),
    amount,
    distanceToSchoolKm: finiteNumberOrNull(session.distanceToSchoolKm),
    gasAllowance: finiteNumberOrNull(session.gasAllowance),
    otherCosts: Array.isArray(session.otherCosts) ? session.otherCosts.map((cost) => ({ ...cost, note: cost.note ?? null })) : [],
    otherCostsTotal: finiteNumberOrNull(session.otherCostsTotal) ?? 0,
    // Sessions cached before the other-costs rollout do not have totalAmount.
    totalAmount: finiteNumberOrNull(session.totalAmount) ?? amount,
    status: session.status,
    statusLabel: session.statusLabel,
    checkedAt: session.checkedAt,
    checkinRequired: session.checkinRequired ?? null,
    checkinAt: session.checkinAt,
    checkoutRequired: session.checkoutRequired ?? null,
    checkoutAt: session.checkoutAt ?? null,
    checkoutViaAdjacent: session.checkoutViaAdjacent ?? null,
    attendanceNote: session.attendanceNote,
    lessonName: session.lessonName ?? null,
    lessonEvaluation: session.lessonEvaluation ?? null,
    lessonSubmittedAt: session.lessonSubmittedAt ?? null,
    lessonReportDueAt: session.lessonReportDueAt ?? null,
  };
}

export function incomeState(session: TeacherIncomeSession): IncomeState {
  if (session.status === "PRESENT") return "confirmed";
  if (session.status === "EXCUSED" && finiteMoney(session.amount) && session.amount > 0) return "confirmed";
  if (session.status === "SCHEDULED") return "pending";
  return "not-payable";
}

/**
 * Gộp các tiết liên tục cùng 1 lần đến trường thành 1 nhóm — ranh giới là session có
 * checkinRequired === true (session mở block). Backend không đặt gasAllowance/distanceToSchoolKm
 * cố định trên đúng session mở block: giá trị thật có thể nằm ở bất kỳ tiết nào trong nhóm (các
 * tiết còn lại trả về 0), nên lấy giá trị lớn nhất trong nhóm thay vì chỉ đọc tiết mở block.
 */
function groupSessionsIntoVisits(sessions: TeacherIncomeSession[]) {
  const sorted = [...sessions].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  const visits: TeacherIncomeSession[][] = [];
  sorted.forEach((session) => {
    if (session.checkinRequired === true || visits.length === 0) visits.push([session]);
    else visits[visits.length - 1].push(session);
  });
  return visits;
}

function visitMax(visit: TeacherIncomeSession[], pick: (session: TeacherIncomeSession) => number | null) {
  return visit.reduce<number | null>((max, session) => {
    const value = pick(session);
    if (value === null) return max;
    return max === null ? value : Math.max(max, value);
  }, null);
}

export function summarizeTeacherIncome(month: string, sessions: TeacherIncomeSession[]): TeacherIncomeSummary {
  const payable = sessions.filter((session) => incomeState(session) === "confirmed");
  const projected = sessions.filter((session) => incomeState(session) !== "not-payable");
  const payableVisits = groupSessionsIntoVisits(payable);
  return {
    month,
    totalIncome: payable.reduce((total, session) => finiteMoney(session.totalAmount) ? total + session.totalAmount : total, 0),
    projectedIncome: projected.reduce((total, session) => {
      const estimate = estimateSessionTotal(session);
      return estimate === null ? total : total + estimate;
    }, 0),
    projectedSessions: projected.length,
    projectedPeriods: projected.reduce((total, session) => session.periods !== null && Number.isFinite(session.periods) ? total + session.periods : total, 0),
    payableSessions: payable.length,
    payablePeriods: payable.reduce((total, session) => session.periods !== null && Number.isFinite(session.periods) ? total + session.periods : total, 0),
    pendingSessions: sessions.filter((session) => incomeState(session) === "pending").length,
    sessionsWithoutRate: sessions.filter((session) => incomeState(session) !== "not-payable" && session.ratePerPeriod === null).length,
    sessionsWithoutAmount: payable.filter((session) => !finiteMoney(session.totalAmount)).length,
    totalGasAllowance: payableVisits.reduce((total, visit) => total + (visitMax(visit, (session) => session.gasAllowance) ?? 0), 0),
    totalDistanceKm: payableVisits.reduce((total, visit) => total + (visitMax(visit, (session) => session.distanceToSchoolKm) ?? 0), 0),
    payableVisits: payableVisits.length,
  };
}

export function sortIncomeSessions(sessions: TeacherIncomeSession[]) {
  return [...sessions].sort((left, right) => {
    const byDate = right.date.localeCompare(left.date);
    return byDate || right.startTime.localeCompare(left.startTime) || right.id - left.id;
  });
}

export async function fetchTeacherIncomeMonth(loader: IncomePageLoader, month: string, signal?: AbortSignal) {
  const range = monthRange(month);
  const pageSize = 100;
  const byId = new Map<number, TeacherIncomeSession>();
  let page = 1;
  let totalPages = 1;

  do {
    const result = await loader({ ...range, page, limit: pageSize }, signal);
    result.data.forEach((session) => byId.set(session.id, toTeacherIncomeSession(session)));
    const reportedTotalPages = Number(result.pagination?.totalPages);
    totalPages = Math.max(totalPages, Number.isInteger(reportedTotalPages) && reportedTotalPages > 0 ? reportedTotalPages : 1);
    if (totalPages > 500) throw new Error("Dữ liệu tháng quá lớn để tải an toàn.");
    page += 1;
  } while (page <= totalPages);

  return sortIncomeSessions([...byId.values()]);
}
