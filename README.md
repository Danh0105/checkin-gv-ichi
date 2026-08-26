# ICHI SKILL — Zalo Mini App giáo viên

## Hướng dẫn dành cho người dùng

Xem [Hướng dẫn sử dụng ICHI SKILL Mini App](./HUONG_DAN_SU_DUNG.md) dành cho giáo viên và Nhân sự.

Mini App dành riêng cho tài khoản có role `giaovien`, gồm ba tab chính:

- Lịch của tôi: lịch ngày/tuần/tháng và các buổi dự kiến.
- Chấm công: check-in/check-out và lịch sử chấm công.
- Thu nhập: tổng hợp thu nhập theo tháng và chi tiết từng buổi dạy.

App mở vào trang chủ công khai để người dùng thấy trước tiện ích Lịch dạy, Chấm công và Thu nhập của tôi. Chỉ khi bấm một tiện ích, chuông thông báo hoặc mục Cá nhân, app mới yêu cầu đăng nhập; đăng nhập thành công sẽ mở thẳng chức năng vừa chọn. JWT còn hạn được tái sử dụng nên không hỏi đăng nhập lại.

Trang Cá nhân hiển thị hồ sơ liên hệ của giáo viên, có lối vào `Thu nhập của tôi`, cho phép tùy chỉnh tên, số điện thoại, email, ảnh đại diện và cung cấp thao tác đăng xuất. Các tùy chỉnh hồ sơ được lưu trên thiết bị vì backend hiện chưa có API tự cập nhật hồ sơ/avatar cho giáo viên; Đổi mật khẩu và FaceID cũng được ghi rõ là chưa khả dụng trên Mini App cho đến khi có API tương ứng.

## Thu nhập của tôi

Route `/teacher/income` và tab Thu nhập dùng `GET /teaching-sessions/me` với `fromDate`, `toDate`, `page`, `limit`. Backend hiện chưa có endpoint summary thu nhập riêng, vì vậy Mini App tải đủ toàn bộ `totalPages` của tháng, khử trùng theo `session.id`, rồi mới tổng hợp.

Tổng tiền chỉ gồm buổi `PRESENT`; buổi `EXCUSED` chỉ được tính khi backend trả `amount` dương. Buổi `SCHEDULED` hiển thị là chờ xác nhận, còn `ABSENT` và `CANCELLED` không được cộng. `amount` do backend trả là nguồn cuối cùng; Mini App không tự nhân đơn giá để thay thế dữ liệu còn thiếu và không dùng trạng thái “Đã thanh toán”. Dữ liệu thu nhập không được lưu vào storage hoặc nhận `teacherId` từ URL.

## Cấu hình API

API client đọc một base URL duy nhất từ `VITE_API_HOST` và không thêm `/api`.
Nếu không khai báo, ứng dụng dùng production `https://sales.kidoedu.vn`.

```powershell
$env:VITE_API_HOST='http://160.250.132.143:3011'
npm run dev
```

Trước khi chạy trên thiết bị thật, vào trang quản trị Zalo Mini App, mục **Quản lý API Domain**, đăng ký:

- `https://sales.kidoedu.vn` cho production.
- `http://160.250.132.143:3011` chỉ cho bản development.

Request domain do nền tảng quản lý, không có thuộc tính domain hợp lệ để tự thêm vào `app-config.json`. Đồng thời cần xin duyệt quyền vị trí cho Mini App.

## Định vị Zalo

Check-in, check-out và đăng ký nhận tiết chỉ xin vị trí sau khi giáo viên bấm nút tương ứng. Mini App lấy location token và Zalo access token đồng thời, sau đó gửi một lần tới `POST /zalo/location/resolve` để nhận tọa độ; token không được lưu, log hoặc đưa vào URL.

Tọa độ đã resolve được dùng cho API nghiệp vụ hiện có. Ứng dụng vẫn tính khoảng cách Haversine để cảnh báo trước khi chấm công ngoài bán kính, còn backend là nơi quyết định và lưu kết quả ngoài vùng.

Khi Check-out, giáo viên phải nhập tên bài học và đánh giá; có thể đính kèm tối đa 10 ảnh JPEG, PNG hoặc WebP. Dữ liệu được gửi bằng `multipart/form-data` tới API Check-out sau khi resolve vị trí thành công.

## Chạy và kiểm tra

```powershell
npm install
npm run dev
npm run build
```

Để chạy trong Zalo, có thể dùng Zalo Mini App Extension hoặc `zmp start`. Token JWT được lưu bằng storage bất đồng bộ của `zmp-sdk`; ứng dụng không lưu mật khẩu và không có tài khoản demo.
