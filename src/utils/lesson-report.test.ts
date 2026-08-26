import { describe, expect, it } from "vitest";

import { formatLessonReportDue, isVideoMedia, lessonReportTiming, validateCheckinImage, validateLessonEvidenceBatch } from "@/utils/lesson-report";

const file = (name: string, type: string, size = 10) => {
  const result = new File(["x"], name, { type });
  Object.defineProperty(result, "size", { value: size });
  return result;
};

describe("lesson report evidence", () => {
  it("validates the required check-in photo", () => {
    expect(validateCheckinImage(null)).toBe("Vui lòng chụp ảnh khi check-in");
    expect(validateCheckinImage(file("photo.jpg", "image/jpeg"))).toBeNull();
    expect(validateCheckinImage(file("photo.pdf", "application/pdf"))).toBe("Ảnh phải là JPEG, PNG hoặc WebP");
  });

  it("accepts supported photos and videos and rejects limits", () => {
    expect(validateLessonEvidenceBatch(0, [file("photo.webp", "image/webp"), file("clip.mov", "video/quicktime")])).toBeNull();
    expect(validateLessonEvidenceBatch(10, [file("extra.jpg", "image/jpeg")])).toBe("Chỉ được tải lên tối đa 10 file");
    expect(validateLessonEvidenceBatch(0, [file("large.mp4", "video/mp4", 50 * 1024 * 1024 + 1)])).toBe("Mỗi ảnh hoặc video không được vượt quá 50 MB");
  });

  it("detects backend video metadata and URL fallbacks", () => {
    expect(isVideoMedia({ url: "https://cdn.test/evidence", mediaType: "video" })).toBe(true);
    expect(isVideoMedia({ url: "https://cdn.test/evidence", mimeType: "video/webm" })).toBe(true);
    expect(isVideoMedia("https://cdn.test/evidence.mp4?token=1")).toBe(true);
    expect(isVideoMedia({ url: "https://cdn.test/photo.webp" })).toBe(false);
  });
});

describe("lesson report deadline", () => {
  const session = { date: "2026-08-25", lessonReportDueAt: "2026-08-26T01:00:00.000Z" } as never;
  it("warns after 19:00 Vietnam time and expires at the backend due timestamp", () => {
    expect(lessonReportTiming(session, Date.parse("2026-08-25T12:01:00.000Z"))).toMatchObject({ warning: true, overdue: false });
    expect(lessonReportTiming(session, Date.parse("2026-08-26T01:00:00.000Z"))).toMatchObject({ warning: false, overdue: true });
  });
  it("formats the backend timestamp in Vietnam time", () => {
    expect(formatLessonReportDue("2026-08-26T01:00:00.000Z")).toBe("08:00 ngày 26/08/2026");
  });
});
