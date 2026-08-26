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
  otherCosts: AttendanceOtherCost[];
  otherCostsTotal: number;
  totalAmount: number | null;
  status: SessionStatus;
  statusLabel: string | null;
  checkedAt: string | null;
  checkinAt: string | null;
  checkoutAt: string | null;
  attendanceNote: string | null;
  lessonName: string | null;
  lessonEvaluation: string | null;
};

export type TeacherIncomeSummary = {
  month: string;
  totalIncome: number;
  payableSessions: number;
  payablePeriods: number;
  pendingSessions: number;
  sessionsWithoutRate: number;
  sessionsWithoutAmount: number;
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
    otherCosts: Array.isArray(session.otherCosts) ? session.otherCosts.map((cost) => ({ ...cost, note: cost.note ?? null })) : [],
    otherCostsTotal: finiteNumberOrNull(session.otherCostsTotal) ?? 0,
    // Sessions cached before the other-costs rollout do not have totalAmount.
    totalAmount: finiteNumberOrNull(session.totalAmount) ?? amount,
    status: session.status,
    statusLabel: session.statusLabel,
    checkedAt: session.checkedAt,
    checkinAt: session.checkinAt,
    checkoutAt: session.checkoutAt ?? null,
    attendanceNote: session.attendanceNote,
    lessonName: session.lessonName ?? null,
    lessonEvaluation: session.lessonEvaluation ?? null,
  };
}

export function incomeState(session: TeacherIncomeSession): IncomeState {
  if (session.status === "PRESENT") return "confirmed";
  if (session.status === "EXCUSED" && finiteMoney(session.amount) && session.amount > 0) return "confirmed";
  if (session.status === "SCHEDULED") return "pending";
  return "not-payable";
}

export function summarizeTeacherIncome(month: string, sessions: TeacherIncomeSession[]): TeacherIncomeSummary {
  const payable = sessions.filter((session) => incomeState(session) === "confirmed");
  return {
    month,
    totalIncome: payable.reduce((total, session) => finiteMoney(session.totalAmount) ? total + session.totalAmount : total, 0),
    payableSessions: payable.length,
    payablePeriods: payable.reduce((total, session) => session.periods !== null && Number.isFinite(session.periods) ? total + session.periods : total, 0),
    pendingSessions: sessions.filter((session) => incomeState(session) === "pending").length,
    sessionsWithoutRate: sessions.filter((session) => incomeState(session) !== "not-payable" && session.ratePerPeriod === null).length,
    sessionsWithoutAmount: payable.filter((session) => !finiteMoney(session.totalAmount)).length,
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
