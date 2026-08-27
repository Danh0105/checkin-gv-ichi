// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const zalo = vi.hoisted(() => ({
  readZaloIdentity: vi.fn(),
  requestFollowOA: vi.fn(),
}));
const auth = vi.hoisted(() => ({
  clearAccessToken: vi.fn(),
  clearPendingDraft: vi.fn(),
  clearLoginCredentials: vi.fn(),
  decodeToken: vi.fn(),
  getSavedLoginCredentials: vi.fn(),
  initializeAuthSession: vi.fn(),
  isTokenExpired: vi.fn(),
  saveAccessToken: vi.fn(),
  saveLoginCredentials: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
}));

vi.mock("@/components/logo", () => ({ default: () => <div data-testid="logo" /> }));
vi.mock("@/components/attendance/AttendanceAdminScreen", () => ({ default: () => null }));
vi.mock("@/components/teacher-mini/TeacherMiniApp", () => ({ default: () => null, NotificationSheet: () => null }));
vi.mock("@/services/auth-session", () => auth);
vi.mock("@/services/zalo-identity", () => zalo);
vi.mock("@/services/fcm", () => ({ registerFcmToken: vi.fn(), unregisterFcmToken: vi.fn() }));
vi.mock("@/services/socket", () => ({ connectSocket: vi.fn(), disconnectSocket: vi.fn(), onSocketResync: vi.fn(() => vi.fn()), onTeacherNotification: vi.fn(() => vi.fn()) }));
vi.mock("zmp-ui", () => ({ useNavigate: () => vi.fn(), useSnackbar: () => ({ openSnackbar: vi.fn() }) }));

import { LoginPage } from "@/pages/index";
import { TeacherApiError } from "@/services/teacher-mini-api";

function fillLoginForm(container: HTMLElement) {
  fireEvent.change(container.querySelector("#phone")!, { target: { value: "0900000018" } });
  fireEvent.change(container.querySelector("#password")!, { target: { value: "123456" } });
}

describe("LoginPage zaloId errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    zalo.readZaloIdentity.mockResolvedValue({ uid: "zalo-uid-2", zaloId: "zalo-id-2" });
    auth.getSavedLoginCredentials.mockResolvedValue(null);
    auth.clearLoginCredentials.mockResolvedValue(undefined);
    auth.saveLoginCredentials.mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  it("hiển thị đúng cảnh báo khi zaloId không khớp tài khoản đã liên kết", async () => {
    const message = "Tài khoản Zalo không khớp với tài khoản đã liên kết trước đó. Vui lòng liên hệ Nhân sự để được hỗ trợ.";
    const onLogin = vi.fn().mockRejectedValue(new TeacherApiError(401, message, "ZALO_ID_MISMATCH"));
    const { container } = render(<LoginPage message="" onLogin={onLogin} onBack={vi.fn()} />);

    fillLoginForm(container);
    fireEvent.click(screen.getByRole("button", { name: /đăng nhập/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("alert")).toHaveClass("account-link");
    expect(screen.queryByText("Sai số điện thoại hoặc mật khẩu")).not.toBeInTheDocument();
  });

  it("giữ luồng quan tâm OA khi backend trả ZALO_ID_REQUIRED", async () => {
    const message = "Thiếu zaloId. Vui lòng quan tâm OA của trường rồi mở lại ứng dụng để đăng nhập.";
    const onLogin = vi.fn().mockRejectedValue(new TeacherApiError(400, message, "ZALO_ID_REQUIRED"));
    const { container } = render(<LoginPage message="" onLogin={onLogin} onBack={vi.fn()} />);

    fillLoginForm(container);
    fireEvent.click(screen.getByRole("button", { name: /đăng nhập/i }));

    await waitFor(() => expect(screen.getByText(message)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Quan tâm OA" })).toBeInTheDocument();
  });

  it("giữ lỗi đăng nhập thường khi 401 không có code", async () => {
    const onLogin = vi.fn().mockRejectedValue(new TeacherApiError(401, "Sai số điện thoại hoặc mật khẩu"));
    const { container } = render(<LoginPage message="" onLogin={onLogin} onBack={vi.fn()} />);

    fillLoginForm(container);
    fireEvent.click(screen.getByRole("button", { name: /đăng nhập/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Sai số điện thoại hoặc mật khẩu");
    expect(screen.getByRole("alert")).not.toHaveClass("account-link");
  });

  it("tự điền số điện thoại và mật khẩu đã lưu", async () => {
    auth.getSavedLoginCredentials.mockResolvedValue({ phone: "0900000018", password: "123456" });
    const { container } = render(<LoginPage message="" onLogin={vi.fn()} onBack={vi.fn()} />);

    await waitFor(() => expect(container.querySelector<HTMLInputElement>("#phone")).toHaveValue("0900000018"));
    expect(container.querySelector<HTMLInputElement>("#password")).toHaveValue("123456");
    expect(container.querySelector<HTMLInputElement>("#remember-password")).toBeChecked();
  });

  it("lưu mật khẩu sau khi đăng nhập thành công nếu người dùng bật ghi nhớ", async () => {
    const onLogin = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<LoginPage message="" onLogin={onLogin} onBack={vi.fn()} />);

    fillLoginForm(container);
    fireEvent.click(container.querySelector<HTMLInputElement>("#remember-password")!);
    fireEvent.click(screen.getByRole("button", { name: /đăng nhập/i }));

    await waitFor(() => expect(onLogin).toHaveBeenCalled());
    await waitFor(() => expect(auth.saveLoginCredentials).toHaveBeenCalledWith({ phone: "0900000018", password: "123456" }));
  });

  it("xoá mật khẩu đã lưu khi người dùng bỏ chọn ghi nhớ", async () => {
    auth.getSavedLoginCredentials.mockResolvedValue({ phone: "0900000018", password: "123456" });
    const { container } = render(<LoginPage message="" onLogin={vi.fn()} onBack={vi.fn()} />);

    await waitFor(() => expect(container.querySelector<HTMLInputElement>("#remember-password")).toBeChecked());
    fireEvent.click(container.querySelector<HTMLInputElement>("#remember-password")!);

    expect(auth.clearLoginCredentials).toHaveBeenCalled();
  });
});
