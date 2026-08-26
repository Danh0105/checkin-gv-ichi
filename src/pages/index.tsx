import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSnackbar } from "zmp-ui";

import Logo from "@/components/logo";
import AttendanceAdminScreen from "@/components/attendance/AttendanceAdminScreen";
import TeacherMiniApp, { NotificationSheet } from "@/components/teacher-mini/TeacherMiniApp";
import homeReference from "@/static/kido-home-reference.jpg";
import {
  clearAccessToken,
  clearPendingDraft,
  decodeToken,
  initializeAuthSession,
  isTokenExpired,
  saveAccessToken,
  setUnauthorizedHandler,
} from "@/services/auth-session";
import { teacherMiniApi, TeacherApiError } from "@/services/teacher-mini-api";
import { getTeacherProfilePreferences, saveTeacherProfilePreferences, TeacherProfilePreferences } from "@/services/profile-preferences";
import { readZaloIdentity, requestFollowOA, ZaloIdentity } from "@/services/zalo-identity";
import { registerFcmToken, unregisterFcmToken } from "@/services/fcm";
import { connectSocket, disconnectSocket, onSocketResync, onTeacherNotification } from "@/services/socket";
import { Teacher, TeachingRole, TeachingUser } from "@/types/teaching";
import { createProfileAvatarDataUrl, PROFILE_AVATAR_ACCEPT } from "@/utils/profile-avatar";

type ProtectedFeature = "schedule" | "attendance" | "income" | "open" | "notifications" | "profile";
type AppView = "home" | "login" | "teacher" | "profile" | "hr-attendance";
type PublicIconName = "bell" | "calendar" | "attendance" | "income" | "home" | "user" | "arrow" | "logout" | "edit" | "camera";

function PublicIcon({ name, size = 28 }: { name: PublicIconName; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  const icons: Record<PublicIconName, ReactNode> = {
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" /></>,
    attendance: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 3.5V2h6v1.5m-6 10 2 2 4-5" /></>,
    income: <><circle cx="12" cy="12" r="9" /><path d="M8.5 9h5a2 2 0 0 1 0 4h-3a2 2 0 0 0 0 4h5M12 6v12" /></>,
    home: <><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10M9 20v-6h6v6" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    arrow: <path d="m9 18 6-6-6-6" />,
    logout: <><path d="M10 17l5-5-5-5m5 5H3" /><path d="M14 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5" /></>,
    edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" /></>,
    camera: <><path d="M14.5 4 16 6h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l1.5-2Z" /><circle cx="12" cy="13" r="3.5" /></>,
  };
  return <svg {...common}>{icons[name]}</svg>;
}

const publicUtilities: { feature: ProtectedFeature; label: string; icon: PublicIconName }[] = [
  { feature: "schedule", label: "Lịch dạy của tôi", icon: "calendar" },
  { feature: "attendance", label: "Chấm công", icon: "attendance" },
  { feature: "income", label: "Thu nhập của tôi", icon: "income" },
];

function PublicHome({ user, notificationsOpen, onFeature, onCloseNotifications }: { user: TeachingUser | null; notificationsOpen: boolean; onFeature: (feature: ProtectedFeature) => void; onCloseNotifications: () => void }) {
  const { openSnackbar } = useSnackbar();
  const [unread, setUnread] = useState(0);
  const notify = useCallback((message: string, tone: "success" | "error" | "warning" = "success") => openSnackbar({ text: message, type: tone, position: "bottom", duration: 3200, icon: true, zIndex: 250 }), [openSnackbar]);

  const refreshUnread = useCallback(() => { teacherMiniApi.notifications.unreadCount().then(setUnread).catch(() => undefined); }, []);
  useEffect(() => {
    if (!user) { setUnread(0); return; }
    refreshUnread();
  }, [user, refreshUnread]);

  useEffect(() => {
    if (!user) return;
    const offNotification = onTeacherNotification((item) => {
      setUnread((value) => value + 1);
      if (item.type === "TEACHING_SCHEDULE_CONFIRM_REQUEST" || item.type === "TEACHING_SCHEDULE_CONFIRM_ALERT") notify(item.message || "Bạn có lịch dạy cần xác nhận", "warning");
    });
    const offResync = onSocketResync(refreshUnread);
    return () => { offNotification(); offResync(); };
  }, [user, notify, refreshUnread]);

  return (
    <main className="public-home-page">
      <header className="public-home-header">
        <div className="public-header-brand">
          <Logo />
          <span><strong>ICHI SKILL</strong><small>Mini App giáo viên</small></span>
        </div>
        <button onClick={() => onFeature("notifications")} aria-label="Thông báo"><PublicIcon name="bell" size={29} />{unread > 0 && <b className="public-notification-count">{unread > 99 ? "99+" : unread}</b>}</button>
      </header>

      <div className="public-home-content">
        <section className="public-hero" aria-label="Hoạt động nổi bật của ICHI SKILL">
          <div className="reference-photo-crop"><img src={homeReference} alt="Tập thể ICHI SKILL trong hoạt động kết nối" /></div>
          <div className="public-carousel-dots" aria-hidden><span /><span className="active" /><span /></div>
        </section>

        {!user && <div className="public-login-hint"><span>🔒</span><p><b>Khám phá trước, đăng nhập khi cần</b><small>Chọn một tiện ích để đăng nhập và sử dụng.</small></p></div>}
        {user && <div className="public-welcome"><span>✓</span><p>Xin chào, <b>{user.name}</b></p></div>}

        <section className="public-utilities">
          <h1>Tiện ích số</h1>
          <div>{publicUtilities.map((item) => <button key={item.feature} onClick={() => onFeature(item.feature)}><span><PublicIcon name={item.icon} size={39} /></span><b>{item.label}</b></button>)}</div>
        </section>

        <section className="public-connection">
          <h2>Thông tin kết nối</h2>
          <div className="public-connection-card">
            <div className="reference-photo-crop"><img src={homeReference} alt="Hoạt động Team Building ICHI SKILL" /></div>
            <span className="connection-caption"><small>HOẠT ĐỘNG NỔI BẬT</small><strong>Team Building 2025</strong></span>
          </div>
        </section>
      </div>

      <nav className="public-bottom-nav" aria-label="Điều hướng trang chủ">
        <button className="active"><PublicIcon name="home" size={27} /><span>Trang chủ</span></button>
        <button onClick={() => onFeature("profile")}><PublicIcon name="user" size={27} /><span>{user ? "Cá nhân" : "Đăng nhập"}</span></button>
      </nav>
      {notificationsOpen && user && <NotificationSheet onClose={onCloseNotifications} notify={notify} onCountChange={(change) => setUnread((value) => Math.max(0, value + change))} onNavigateScheduleConfirmation={() => { onCloseNotifications(); onFeature("schedule"); }} />}
    </main>
  );
}

type EditableProfile = Pick<TeacherProfilePreferences, "name" | "phone" | "email" | "avatarDataUrl">;

function ProfileEditor({ profile, onClose, onSave }: { profile: EditableProfile; onClose: () => void; onSave: (profile: EditableProfile) => Promise<void> }) {
  const [name, setName] = useState(profile.name);
  const [phone, setPhone] = useState(profile.phone);
  const [email, setEmail] = useState(profile.email);
  const [avatarDataUrl, setAvatarDataUrl] = useState(profile.avatarDataUrl);
  const [imageBusy, setImageBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const imageInputRef = useRef<HTMLInputElement>(null);

  const chooseImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setImageBusy(true);
    setError("");
    try { setAvatarDataUrl(await createProfileAvatarDataUrl(file)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Không thể xử lý ảnh đại diện."); }
    finally { setImageBusy(false); }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedName = name.trim();
    const normalizedPhone = phone.replace(/\s+/g, "").trim();
    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedName.length < 2 || normalizedName.length > 100) { setError("Họ tên phải có từ 2 đến 100 ký tự."); return; }
    if (normalizedPhone && !/^\+?\d{8,15}$/.test(normalizedPhone)) { setError("Số điện thoại phải có từ 8 đến 15 chữ số."); return; }
    if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) { setError("Email không đúng định dạng."); return; }
    setSubmitting(true);
    setError("");
    try { await onSave({ name: normalizedName, phone: normalizedPhone, email: normalizedEmail, avatarDataUrl }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Không thể lưu thay đổi."); }
    finally { setSubmitting(false); }
  };

  return <div className="profile-editor-backdrop" onMouseDown={(event) => !submitting && event.target === event.currentTarget && onClose()}><section className="profile-editor" role="dialog" aria-modal="true" aria-labelledby="profile-editor-title">
    <header><h2 id="profile-editor-title">Chỉnh sửa thông tin</h2><button type="button" onClick={onClose} disabled={submitting} aria-label="Đóng">×</button></header>
    <form onSubmit={submit} noValidate>
      <div className="profile-editor-avatar">{avatarDataUrl ? <img src={avatarDataUrl} alt="Ảnh đại diện mới" /> : <span>{name.trim().charAt(0).toUpperCase() || "G"}</span>}<button type="button" onClick={() => imageInputRef.current?.click()} disabled={imageBusy || submitting}><PublicIcon name="camera" size={18} />{imageBusy ? "Đang xử lý…" : "Chọn ảnh"}</button>{avatarDataUrl && <button type="button" className="remove-avatar" onClick={() => setAvatarDataUrl("")} disabled={submitting}>Xóa ảnh</button>}<input ref={imageInputRef} type="file" accept={PROFILE_AVATAR_ACCEPT} onChange={chooseImage} aria-label="Chọn ảnh đại diện" /></div>
      <label htmlFor="profile-name">Họ và tên<input id="profile-name" value={name} maxLength={100} disabled={submitting} onChange={(event) => { setName(event.target.value); setError(""); }} /></label>
      <label htmlFor="profile-phone">Số điện thoại<input id="profile-phone" type="tel" inputMode="tel" value={phone} maxLength={16} disabled={submitting} onChange={(event) => { setPhone(event.target.value); setError(""); }} placeholder="Nhập số điện thoại" /></label>
      <label htmlFor="profile-email">Email<input id="profile-email" type="email" inputMode="email" value={email} maxLength={150} disabled={submitting} onChange={(event) => { setEmail(event.target.value); setError(""); }} placeholder="Nhập email" /></label>
      <p className="profile-storage-note">Thay đổi được lưu trên thiết bị này và chưa cập nhật vào hồ sơ Nhân sự.</p>
      {error && <p className="profile-editor-error" role="alert">{error}</p>}
      <button className="profile-save-button" disabled={submitting || imageBusy}>{submitting ? "Đang lưu…" : "Lưu thay đổi"}</button>
    </form>
  </section></div>;
}

function ProfilePage({ user, onHome, onIncome, onLogout, onProfileChange }: { user: TeachingUser; onHome: () => void; onIncome: () => void; onLogout: () => void; onProfileChange: (profile: Pick<TeachingUser, "name" | "phone" | "email">) => void }) {
  const { openSnackbar } = useSnackbar();
  const [profile, setProfile] = useState<Teacher | null>(null);
  const [preferences, setPreferences] = useState<TeacherProfilePreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let active = true;
    teacherMiniApi.teacher.me().then((result) => { if (active) setProfile(result); }).catch(() => { if (active) setLoadError("Không thể tải đầy đủ thông tin hồ sơ."); }).then(() => { if (active) setLoading(false); });
    getTeacherProfilePreferences(user.id).then((result) => { if (active) setPreferences(result); }).catch(() => undefined);
    return () => { active = false; };
  }, [user.id]);

  const name = preferences?.name || profile?.name || user.name;
  const phone = preferences?.phone || profile?.phone || user.phone || "";
  const email = preferences?.email || profile?.email || user.email || "";
  const avatarDataUrl = preferences?.avatarDataUrl || "";
  const unavailable = (feature: string) => openSnackbar({ text: `${feature} chưa khả dụng trên Mini App.`, type: "warning", position: "bottom", duration: 2800, icon: true, zIndex: 250 });
  const saveProfile = async (next: EditableProfile) => {
    const saved = await saveTeacherProfilePreferences(user.id, next);
    setPreferences(saved);
    onProfileChange({ name: saved.name, phone: saved.phone, email: saved.email });
    setEditing(false);
    openSnackbar({ text: "Đã lưu thay đổi thông tin.", type: "success", position: "bottom", duration: 2800, icon: true, zIndex: 250 });
  };

  return <main className="profile-page">
    <section className="profile-hero" aria-label="Ảnh bìa hồ sơ"><button type="button" className="profile-avatar" onClick={() => setEditing(true)} aria-label="Đổi ảnh đại diện">{avatarDataUrl ? <img src={avatarDataUrl} alt="Ảnh đại diện" /> : <span>{name.trim().charAt(0).toUpperCase() || "G"}</span>}<em><PublicIcon name="camera" size={17} /></em></button></section>
    <div className="profile-content">
      <header className="profile-heading"><h1>{name}</h1><p>{email || "Tài khoản giáo viên ICHI SKILL"}</p></header>
      <section className="profile-info-card" aria-label="Thông tin liên hệ">
        <div><span>Số điện thoại</span><b>{loading && !phone ? "Đang tải…" : phone || "Chưa cập nhật"}</b></div>
        <div><span>Email</span><b>{loading && !email ? "Đang tải…" : email || "Chưa cập nhật"}</b></div>
        {loadError && <p role="status">{loadError}</p>}
      </section>
      <section className="profile-actions" aria-label="Tác vụ tài khoản">
        <button type="button" onClick={onIncome}><span><PublicIcon name="income" size={19} /> Thu nhập của tôi</span><em>›</em></button>
        <button type="button" onClick={() => setEditing(true)}><span><PublicIcon name="edit" size={18} /> Chỉnh sửa thông tin</span><em>›</em></button>
        <button type="button" onClick={() => unavailable("Đổi mật khẩu")}><span>Đổi mật khẩu</span><em>›</em></button>
        <button type="button" onClick={() => unavailable("Đăng ký FaceID")}><span>Đăng ký FaceID</span><em>›</em></button>
        <button type="button" className="profile-logout" onClick={onLogout}><span><PublicIcon name="logout" size={19} /> Đăng xuất</span><em>›</em></button>
      </section>
    </div>
    <nav className="public-bottom-nav" aria-label="Điều hướng trang cá nhân">
      <button onClick={onHome}><PublicIcon name="home" size={27} /><span>Trang chủ</span></button>
      <button className="active"><PublicIcon name="user" size={27} /><span>Cá nhân</span></button>
    </nav>
    {editing && <ProfileEditor profile={{ name, phone, email, avatarDataUrl }} onClose={() => setEditing(false)} onSave={saveProfile} />}
  </main>;
}

function LoginPage({ message, onLogin, onBack }: { message: string; onLogin: (phone: string, password: string, zalo?: ZaloIdentity) => Promise<void>; onBack: () => void }) {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(message);
  const [zaloIdentity, setZaloIdentity] = useState<ZaloIdentity | null>(null);
  const [identityChecked, setIdentityChecked] = useState(false);
  const [oaGate, setOaGate] = useState(false);
  const [oaGateMessage, setOaGateMessage] = useState("");
  const [oaError, setOaError] = useState("");
  const [followBusy, setFollowBusy] = useState(false);

  useEffect(() => setError(message), [message]);

  useEffect(() => {
    let active = true;
    readZaloIdentity().then((identity) => { if (active) { setZaloIdentity(identity); setIdentityChecked(true); } });
    return () => { active = false; };
  }, []);

  const attemptLogin = async (identity: ZaloIdentity | null) => {
    setSubmitting(true);
    setError("");
    try {
      await onLogin(phone.trim(), password, identity ?? undefined);
      setOaGate(false);
    } catch (loginError) {
      if (loginError instanceof TeacherApiError && loginError.status === 400) {
        setOaGateMessage(loginError.message);
        setOaGate(true);
      } else {
        setError(loginError instanceof Error ? loginError.message : "Không thể đăng nhập");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!phone.trim() || !password) {
      setError("Vui lòng nhập số điện thoại và mật khẩu");
      return;
    }
    await attemptLogin(zaloIdentity);
  };

  const handleFollowOA = async () => {
    setFollowBusy(true);
    setOaError("");
    try {
      await requestFollowOA();
      const identity = await readZaloIdentity();
      setZaloIdentity(identity);
      setIdentityChecked(true);
      if (!identity) {
        setOaError("Chưa nhận được xác nhận quan tâm OA, vui lòng thử lại.");
        return;
      }
      if (oaGate) await attemptLogin(identity);
    } catch (reason) {
      setOaError(reason instanceof Error ? reason.message : "Không thể mở Official Account.");
    } finally {
      setFollowBusy(false);
    }
  };

  return (
    <main className="login-page">
      <button className="login-back-button" onClick={onBack} aria-label="Quay lại trang chủ"><PublicIcon name="home" size={19} /><span>Trang chủ</span></button>
      <div className="login-brand"><Logo className="login-logo" /><h1>ICHI SKILL</h1><p>Đăng nhập hệ thống</p></div>
      <section className="login-card" aria-label="Đăng nhập giáo viên">
        <div className="login-card-title"><span aria-hidden>🔑</span><div><strong>Đăng nhập để tiếp tục</strong><small>Sử dụng tài khoản giáo viên ICHI SKILL</small></div></div>

        {oaGate ? (
          <div className="login-oa-gate">
            <span aria-hidden>🔔</span>
            <strong>Cần quan tâm OA để đăng nhập</strong>
            <p>{oaGateMessage || "Vui lòng quan tâm OA của trường rồi thử đăng nhập lại."}</p>
            <button type="button" className="primary-button" onClick={handleFollowOA} disabled={followBusy}>{followBusy ? <span className="spinner" aria-label="Đang xử lý" /> : "Quan tâm OA"}</button>
            <button type="button" className="login-oa-secondary" onClick={() => { setOaGate(false); setOaError(""); }} disabled={followBusy}>Quay lại đăng nhập</button>
            {oaError && <p className="login-error" role="alert">{oaError}</p>}
          </div>
        ) : (
          <>
            {identityChecked && !zaloIdentity && (
              <div className="login-oa-banner">
                <span aria-hidden>🔔</span>
                <div><strong>Quan tâm OA để nhận cảnh báo lịch dạy</strong><p>Giáo viên nên quan tâm OA của trường để nhận thông báo khi sắp tới giờ dạy mà chưa check-in.</p></div>
                <button type="button" onClick={handleFollowOA} disabled={followBusy}>{followBusy ? "Đang mở…" : "Mở OA"}</button>
              </div>
            )}
            {oaError && <p className="login-error" role="alert">{oaError}</p>}
            <form className="login-form" onSubmit={submit}>
              <label htmlFor="phone">Số điện thoại</label>
              <input id="phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Nhập số điện thoại" />
              <label htmlFor="password">Mật khẩu</label>
              <input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Nhập mật khẩu" />
              <button className="primary-button" disabled={submitting} type="submit">{submitting ? <span className="spinner" aria-label="Đang đăng nhập" /> : "Đăng nhập"}</button>
              {error && <p className="login-error" role="alert">{error}</p>}
            </form>
          </>
        )}

        <p className="login-security-note">Mini App chỉ lưu phiên đăng nhập, không lưu mật khẩu. Nếu đang dùng mật khẩu mặc định 123456, vui lòng liên hệ phòng Nhân sự để được hỗ trợ.</p>
      </section>
    </main>
  );
}

function BootScreen() {
  return <main className="boot-screen"><Logo /><span className="spinner" /><p>Đang khởi động Mini App…</p></main>;
}

export default function HomePage({ initialFeature }: { initialFeature?: ProtectedFeature }) {
  const navigate = useNavigate();
  const [booting, setBooting] = useState(true);
  const [view, setView] = useState<AppView>(initialFeature ? "login" : "home");
  const [currentUser, setCurrentUser] = useState<TeachingUser | null>(null);
  const [pendingFeature, setPendingFeature] = useState<ProtectedFeature>(initialFeature || "schedule");
  const [publicNotificationsOpen, setPublicNotificationsOpen] = useState(false);
  const [sessionMessage, setSessionMessage] = useState("");

  useEffect(() => {
    let active = true;
    const restore = async () => {
      try {
        const token = await initializeAuthSession();
        const payload = token ? decodeToken(token) : null;
        if (!token || !payload) return;
        if (isTokenExpired(payload)) {
          await clearAccessToken();
          if (active) setSessionMessage("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.");
          return;
        }
        if (!payload.roles.includes("giaovien") && !payload.roles.includes("nhansu")) {
          await clearAccessToken();
          if (active) setSessionMessage("Tài khoản này không có quyền sử dụng chức năng chấm công.");
          return;
        }
        if (active) {
          const preferences = payload.roles.includes("giaovien") ? await getTeacherProfilePreferences(payload.sub).catch(() => null) : null;
          setCurrentUser({ id: payload.sub, name: preferences?.name || payload.name, phone: preferences?.phone || undefined, email: preferences?.email || undefined, roles: payload.roles as TeachingRole[] });
          if (payload.roles.includes("nhansu")) setView("hr-attendance");
          else if (initialFeature) setView(initialFeature === "profile" ? "profile" : initialFeature === "notifications" ? "home" : "teacher");
        }
      } catch {
        if (active) setSessionMessage("Không thể khôi phục phiên đăng nhập. Vui lòng đăng nhập lại.");
      } finally {
        if (active) setBooting(false);
      }
    };

    setUnauthorizedHandler((message) => {
      if (!active) return;
      setCurrentUser(null);
      setSessionMessage(message);
      setView("login");
    });
    void restore();
    return () => { active = false; setUnauthorizedHandler(null); };
  }, [initialFeature]);

  // Socket.IO (thông báo realtime khi app đang mở) + đăng ký FCM token — chạy cho mọi phiên đăng nhập
  // thành công, kể cả khôi phục phiên lúc mở lại app, không chỉ lần bấm nút Đăng nhập.
  useEffect(() => {
    if (!currentUser?.roles.includes("giaovien")) {
      disconnectSocket();
      return;
    }
    connectSocket(currentUser.id);
    void registerFcmToken();
    return () => disconnectSocket();
  }, [currentUser]);

  const backToHome = () => {
    if (initialFeature) navigate("/", { direction: "backward" });
    else setView("home");
  };

  const openFeature = (feature: ProtectedFeature) => {
    setPendingFeature(feature);
    if (!currentUser) {
      setView("login");
      return;
    }
    if (currentUser.roles.includes("nhansu")) {
      setPublicNotificationsOpen(false);
      setView("hr-attendance");
      return;
    }
    if (feature === "notifications") {
      setPublicNotificationsOpen(true);
      setView("home");
      return;
    }
    if (feature === "profile") {
      setPublicNotificationsOpen(false);
      setView("profile");
      return;
    }
    setPublicNotificationsOpen(false);
    setView("teacher");
  };

  const login = async (phone: string, password: string, zalo?: ZaloIdentity) => {
    const result = await teacherMiniApi.auth.login(phone, password, zalo);
    if (!result.user.roles.includes("giaovien") && !result.user.roles.includes("nhansu")) throw new Error("Tài khoản này không có quyền sử dụng chức năng chấm công.");
    await saveAccessToken(result.access_token);
    setSessionMessage("");
    const preferences = result.user.roles.includes("giaovien") ? await getTeacherProfilePreferences(result.user.id).catch(() => null) : null;
    setCurrentUser({ ...result.user, name: preferences?.name || result.user.name, phone: preferences?.phone || result.user.phone, email: preferences?.email || result.user.email });
    if (result.user.roles.includes("nhansu")) {
      setView("hr-attendance");
    } else if (pendingFeature === "notifications") {
      setPublicNotificationsOpen(true);
      setView("home");
    } else if (pendingFeature === "profile") {
      setView("profile");
    } else {
      setView("teacher");
    }
  };

  const logout = async () => {
    await unregisterFcmToken();
    await clearAccessToken();
    await clearPendingDraft();
    setCurrentUser(null);
    setPublicNotificationsOpen(false);
    setSessionMessage("");
    setView("home");
    if (initialFeature) navigate("/", { replace: true, animate: false });
  };

  if (booting) return <BootScreen />;
  if (view === "login") return <LoginPage message={sessionMessage} onLogin={login} onBack={backToHome} />;
  if (view === "hr-attendance" && currentUser) return <AttendanceAdminScreen user={currentUser} onLogout={() => void logout()} />;
  if (view === "profile" && currentUser) return <ProfilePage user={currentUser} onHome={backToHome} onIncome={() => navigate("/teacher/income")} onLogout={() => void logout()} onProfileChange={(updated) => setCurrentUser((current) => current ? { ...current, ...updated } : current)} />;
  if (view === "teacher" && currentUser) return <TeacherMiniApp user={currentUser} initialTab={pendingFeature === "attendance" ? "attendance" : pendingFeature === "income" ? "income" : pendingFeature === "open" ? "open" : "schedule"} onHome={backToHome} onLogout={() => void logout()} />;
  return <PublicHome user={currentUser} notificationsOpen={publicNotificationsOpen} onFeature={openFeature} onCloseNotifications={() => setPublicNotificationsOpen(false)} />;
}
