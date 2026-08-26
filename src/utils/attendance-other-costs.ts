import { AttendanceOtherCost, AttendancePayload, SessionStatus, TeachingSession } from "@/types/teaching";

export const ATTENDANCE_OTHER_COST_LIMIT = 20;
export const ATTENDANCE_OTHER_COST_MAX_AMOUNT = 100_000_000;

export type AttendanceOtherCostInput = {
  name: string;
  amount: string | number;
  note?: string | null;
};

export type AttendanceDraft = {
  status: SessionStatus;
  attendanceNote: string;
  otherCosts: AttendanceOtherCost[];
};

function invalidAmount() {
  return new Error("Số tiền phải từ 0 đến 100.000.000 và có tối đa 2 chữ số thập phân.");
}

/** Accepts plain numbers and common vi-VN/en-US grouping, then returns an API-safe number. */
export function parseAttendanceAmount(value: string | number) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || value > ATTENDANCE_OTHER_COST_MAX_AMOUNT || Math.abs(value * 100 - Math.round(value * 100)) > 1e-7) throw invalidAmount();
    return value;
  }

  const raw = value.trim().replace(/[\s₫đĐ]/g, "");
  if (!raw || raw.startsWith("-") || !/^\d+(?:[.,]\d+)*$/.test(raw)) throw invalidAmount();

  const dot = raw.lastIndexOf(".");
  const comma = raw.lastIndexOf(",");
  const lastSeparator = Math.max(dot, comma);
  let normalized = raw;

  if (lastSeparator >= 0) {
    const separator = raw[lastSeparator];
    const occurrences = [...raw].filter((character) => character === separator).length;
    const fractionLength = raw.length - lastSeparator - 1;
    const hasOtherSeparator = separator === "." ? comma >= 0 : dot >= 0;
    const isDecimal = fractionLength <= 2 && (hasOtherSeparator || occurrences === 1 || !raw.slice(0, lastSeparator).includes(separator));

    if (isDecimal) {
      const integerPart = raw.slice(0, lastSeparator);
      if (/[.,]/.test(integerPart) && !/^\d{1,3}([.,])\d{3}(?:\1\d{3})*$/.test(integerPart)) throw invalidAmount();
      const integer = integerPart.replace(/[.,]/g, "");
      const fraction = raw.slice(lastSeparator + 1);
      normalized = `${integer}.${fraction}`;
    } else {
      if (!/^\d{1,3}([.,])\d{3}(?:\1\d{3})*$/.test(raw)) throw invalidAmount();
      normalized = raw.replace(/[.,]/g, "");
    }
  }

  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0 || amount > ATTENDANCE_OTHER_COST_MAX_AMOUNT || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7) throw invalidAmount();
  return amount;
}

export function normalizeAttendanceOtherCosts(costs: readonly AttendanceOtherCostInput[]) {
  if (costs.length > ATTENDANCE_OTHER_COST_LIMIT) throw new Error(`Mỗi buổi chỉ được thêm tối đa ${ATTENDANCE_OTHER_COST_LIMIT} khoản chi phí.`);

  return costs.map<AttendanceOtherCost>((cost, index) => {
    const name = cost.name.trim();
    const note = cost.note?.trim() || null;
    if (!name) throw new Error(`Khoản ${index + 1}: tên khoản không được để trống.`);
    if (name.length > 100) throw new Error(`Khoản ${index + 1}: tên khoản tối đa 100 ký tự.`);
    if (note && note.length > 500) throw new Error(`Khoản ${index + 1}: ghi chú tối đa 500 ký tự.`);
    return { name, amount: parseAttendanceAmount(cost.amount), note };
  });
}

export function attendanceOtherCostsOf(session: Pick<TeachingSession, "otherCosts">) {
  return Array.isArray(session.otherCosts) ? session.otherCosts.map((cost) => ({ ...cost, note: cost.note ?? null })) : [];
}

export function attendanceOtherCostsTotal(costs: readonly Pick<AttendanceOtherCost, "amount">[]) {
  return costs.reduce((total, cost) => total + (Number.isFinite(cost.amount) ? cost.amount : 0), 0);
}

export function attendanceDraftFromSession(session: TeachingSession): AttendanceDraft {
  return {
    status: session.status,
    attendanceNote: session.attendanceNote ?? "",
    otherCosts: attendanceOtherCostsOf(session),
  };
}

export function attendancePayloadFromDraft(draft: AttendanceDraft): AttendancePayload {
  return {
    status: draft.status,
    attendanceNote: draft.attendanceNote.trim() || null,
    otherCosts: normalizeAttendanceOtherCosts(draft.otherCosts),
  };
}

function stableCosts(costs: readonly AttendanceOtherCostInput[]) {
  return normalizeAttendanceOtherCosts(costs).map((cost) => ({ name: cost.name, amount: cost.amount, note: cost.note ?? null }));
}

export function isAttendanceDraftDirty(session: TeachingSession, draft: AttendanceDraft) {
  if (session.status !== draft.status) return true;
  if ((session.attendanceNote?.trim() || null) !== (draft.attendanceNote.trim() || null)) return true;
  return JSON.stringify(stableCosts(attendanceOtherCostsOf(session))) !== JSON.stringify(stableCosts(draft.otherCosts));
}
