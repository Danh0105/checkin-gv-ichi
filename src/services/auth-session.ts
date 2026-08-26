import { getStorage, removeStorage, setStorage } from "zmp-sdk";

const TOKEN_KEY = "access_token";
const DRAFT_KEY = "teacher_pending_draft";

let memoryToken: string | null = null;
let unauthorizedHandler: ((message: string) => void) | null = null;
let draftWriteQueue: Promise<void> = Promise.resolve();

export interface TokenPayload {
  sub: number;
  roles: string[];
  name: string;
  iat?: number;
  exp?: number;
}

export function decodeToken(token: string): TokenPayload | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = window.atob(padded);
    const json = decodeURIComponent(Array.from(binary).map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""));
    const payload = JSON.parse(json) as TokenPayload;
    return typeof payload.sub === "number" && Array.isArray(payload.roles) ? payload : null;
  } catch {
    return null;
  }
}

export const isTokenExpired = (payload: TokenPayload | null) => !payload?.exp || payload.exp <= Date.now() / 1000;

export async function initializeAuthSession() {
  const storage = await getStorage({ keys: [TOKEN_KEY] });
  memoryToken = typeof storage[TOKEN_KEY] === "string" ? storage[TOKEN_KEY] : null;
  return memoryToken;
}

export function getAccessToken() {
  return memoryToken;
}

export async function saveAccessToken(token: string) {
  memoryToken = token;
  const result = await setStorage({ data: { [TOKEN_KEY]: token } });
  if (result.errorKeys?.includes(TOKEN_KEY)) {
    memoryToken = null;
    throw new Error("Không thể lưu phiên đăng nhập trên thiết bị");
  }
}

export async function clearAccessToken() {
  memoryToken = null;
  await removeStorage({ keys: [TOKEN_KEY] }).catch(() => undefined);
}

export function setUnauthorizedHandler(handler: ((message: string) => void) | null) {
  unauthorizedHandler = handler;
}

export function emitUnauthorized() {
  unauthorizedHandler?.("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.");
}

export function savePendingDraft(value: unknown) {
  draftWriteQueue = draftWriteQueue.catch(() => undefined).then(async () => {
    await setStorage({ data: { [DRAFT_KEY]: value } });
  });
  return draftWriteQueue;
}

export async function getPendingDraft<T>() {
  const storage = await getStorage({ keys: [DRAFT_KEY] });
  return (storage[DRAFT_KEY] ?? null) as T | null;
}

export function clearPendingDraft() {
  draftWriteQueue = draftWriteQueue.catch(() => undefined).then(async () => {
    await removeStorage({ keys: [DRAFT_KEY] }).catch(() => undefined);
  });
  return draftWriteQueue;
}
