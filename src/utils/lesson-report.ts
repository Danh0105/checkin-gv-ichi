import { TeachingSession } from "@/types/teaching";

export const MAX_LESSON_FILES = 10;
export const MAX_LESSON_FILE_SIZE = 50 * 1024 * 1024;
export const LESSON_EVIDENCE_ACCEPT = "image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,.jpg,.jpeg,.png,.webp,.mp4,.mov,.webm";
export const CHECKIN_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";
export const MAX_CHECKIN_IMAGE_SIZE = 10 * 1024 * 1024;

const imageMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const videoMimeTypes = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const imageExtension = /\.(jpe?g|png|webp)$/i;
const videoExtension = /\.(mp4|mov|webm)$/i;

export function isVideoFile(file: Pick<File, "type" | "name">) {
  return videoMimeTypes.has(file.type.toLowerCase()) && videoExtension.test(file.name);
}

export function isVideoMedia(media: string | { url: string; mimeType?: string; mediaType?: "video" }) {
  if (typeof media === "string") return /\.(mp4|mov|webm)(?:$|[?#])/i.test(media);
  return media.mediaType === "video" || media.mimeType?.startsWith("video/") === true || /\.(mp4|mov|webm)(?:$|[?#])/i.test(media.url);
}

export function validateCheckinImage(file: File | null) {
  if (!file) return "Vui lòng chụp ảnh khi check-in";
  if (!imageMimeTypes.has(file.type.toLowerCase()) || !imageExtension.test(file.name)) return "Ảnh phải là JPEG, PNG hoặc WebP";
  if (file.size > MAX_CHECKIN_IMAGE_SIZE) return "Ảnh check-in không được vượt quá 10 MB";
  return null;
}

export function validateLessonEvidenceBatch(currentCount: number, files: File[]) {
  if (currentCount + files.length > MAX_LESSON_FILES) return "Chỉ được tải lên tối đa 10 file";
  if (files.some((file) => {
    const image = imageMimeTypes.has(file.type.toLowerCase()) && imageExtension.test(file.name);
    const video = videoMimeTypes.has(file.type.toLowerCase()) && videoExtension.test(file.name);
    return !image && !video;
  })) return "Chỉ hỗ trợ ảnh JPEG, PNG, WebP hoặc video MP4, MOV, WebM";
  if (files.some((file) => file.size > MAX_LESSON_FILE_SIZE)) return "Mỗi ảnh hoặc video không được vượt quá 50 MB";
  return null;
}

export function lessonReportTiming(session: TeachingSession, now = Date.now()) {
  const dueAt = session.lessonReportDueAt ? new Date(session.lessonReportDueAt).getTime() : Number.NaN;
  const warningAt = new Date(`${session.date}T19:00:00+07:00`).getTime();
  return {
    overdue: Number.isFinite(dueAt) && now >= dueAt,
    warning: now >= warningAt && (!Number.isFinite(dueAt) || now < dueAt),
  };
}

export function formatLessonReportDue(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour12: false,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("hour")}:${part("minute")} ngày ${part("day")}/${part("month")}/${part("year")}`;
}
