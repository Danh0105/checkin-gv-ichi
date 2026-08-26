import { getStorage, setStorage } from "zmp-sdk";

export interface TeacherProfilePreferences {
  name: string;
  phone: string;
  email: string;
  avatarDataUrl: string;
  updatedAt: string;
}

const profileKey = (userId: number) => `teacher_profile_preferences_${userId}`;

export async function getTeacherProfilePreferences(userId: number) {
  const key = profileKey(userId);
  const storage = await getStorage({ keys: [key] });
  const value = storage[key];
  if (!value || typeof value !== "object") return null;
  const profile = value as Partial<TeacherProfilePreferences>;
  return {
    name: typeof profile.name === "string" ? profile.name : "",
    phone: typeof profile.phone === "string" ? profile.phone : "",
    email: typeof profile.email === "string" ? profile.email : "",
    avatarDataUrl: typeof profile.avatarDataUrl === "string" ? profile.avatarDataUrl : "",
    updatedAt: typeof profile.updatedAt === "string" ? profile.updatedAt : "",
  } satisfies TeacherProfilePreferences;
}

export async function saveTeacherProfilePreferences(userId: number, profile: Omit<TeacherProfilePreferences, "updatedAt">) {
  const key = profileKey(userId);
  const value: TeacherProfilePreferences = { ...profile, updatedAt: new Date().toISOString() };
  const result = await setStorage({ data: { [key]: value } });
  if (result.errorKeys?.includes(key)) throw new Error("Không thể lưu hồ sơ trên thiết bị này.");
  return value;
}
