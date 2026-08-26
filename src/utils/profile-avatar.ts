export const PROFILE_AVATAR_ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";
export const PROFILE_AVATAR_MAX_BYTES = 10 * 1024 * 1024;

const allowedAvatarTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export function validateProfileAvatar(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!allowedAvatarTypes.has(file.type) || !extension || !["jpg", "jpeg", "png", "webp"].includes(extension)) return "Chỉ hỗ trợ ảnh JPEG, PNG hoặc WebP.";
  if (file.size > PROFILE_AVATAR_MAX_BYTES) return "Ảnh đại diện không được vượt quá 10 MB.";
  return null;
}

export function createProfileAvatarDataUrl(file: File) {
  const validationError = validateProfileAvatar(file);
  if (validationError) return Promise.reject(new Error(validationError));

  return new Promise<string>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      try {
        const size = Math.min(image.naturalWidth, image.naturalHeight);
        const sourceX = (image.naturalWidth - size) / 2;
        const sourceY = (image.naturalHeight - size) / 2;
        const canvas = document.createElement("canvas");
        canvas.width = 384;
        canvas.height = 384;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Thiết bị không hỗ trợ xử lý ảnh.");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, sourceX, sourceY, size, size, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", .86));
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Không thể xử lý ảnh đại diện."));
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Không thể đọc ảnh đã chọn.")); };
    image.src = objectUrl;
  });
}
