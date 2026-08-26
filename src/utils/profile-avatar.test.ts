import { describe, expect, it } from "vitest";

import { PROFILE_AVATAR_MAX_BYTES, validateProfileAvatar } from "@/utils/profile-avatar";

describe("validateProfileAvatar", () => {
  it.each([
    ["avatar.jpg", "image/jpeg"],
    ["avatar.jpeg", "image/jpeg"],
    ["avatar.png", "image/png"],
    ["avatar.webp", "image/webp"],
  ])("chấp nhận %s", (name, type) => {
    expect(validateProfileAvatar(new File(["image"], name, { type }))).toBeNull();
  });

  it("từ chối định dạng không hỗ trợ hoặc phần mở rộng giả", () => {
    expect(validateProfileAvatar(new File(["image"], "avatar.gif", { type: "image/gif" }))).toBe("Chỉ hỗ trợ ảnh JPEG, PNG hoặc WebP.");
    expect(validateProfileAvatar(new File(["image"], "avatar.gif", { type: "image/jpeg" }))).toBe("Chỉ hỗ trợ ảnh JPEG, PNG hoặc WebP.");
  });

  it("từ chối ảnh vượt quá giới hạn", () => {
    const file = new File([new Uint8Array(PROFILE_AVATAR_MAX_BYTES + 1)], "avatar.jpg", { type: "image/jpeg" });
    expect(validateProfileAvatar(file)).toBe("Ảnh đại diện không được vượt quá 10 MB.");
  });
});
