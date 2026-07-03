# 🏸 Cầu Lông Tính Tiền

Web tính tiền cầu lông theo từng trận: phí sân + phí cầu chia đều cho người tham gia, có danh sách cố định + thêm khách theo trận, và tổng kết chi phí theo tháng cho từng người.

**Kiến trúc:** Trang web tĩnh (HTML/CSS/JS thuần, host trên GitHub Pages) + Google Sheet làm database, truy cập qua Google Apps Script (đóng vai trò API JSON miễn phí).

```
Trình duyệt (GitHub Pages)  --fetch()-->  Apps Script Web App  --->  Google Sheet
```

---

## Bước 1 — Tạo Google Sheet

1. Vào [sheets.google.com](https://sheets.google.com), tạo 1 spreadsheet mới, đặt tên ví dụ "Cầu Lông DB".
2. Không cần tạo sẵn cột/sheet — script sẽ tự tạo 2 tab `Members` và `Matches` với đúng cột khi chạy lần đầu.

## Bước 2 — Gắn Apps Script vào Sheet

1. Trong Google Sheet, chọn **Extensions (Tiện ích mở rộng) → Apps Script**.
2. Xoá hết code mẫu trong `Code.gs`, dán toàn bộ nội dung file `apps-script/Code.gs` (trong bộ file này) vào.
3. Nhấn biểu tượng 💾 để lưu (đặt tên project tuỳ ý, ví dụ "BadmintonAPI").

## Bước 3 — Deploy thành Web App

1. Trong Apps Script, góc trên phải: **Deploy → New deployment**.
2. Bấm biểu tượng ⚙️ cạnh "Select type" → chọn **Web app**.
3. Cấu hình:
   - **Execute as:** Me (tài khoản của bạn)
   - **Who has access:** Anyone
4. Bấm **Deploy**. Lần đầu Google sẽ yêu cầu cấp quyền (Authorize access) — chọn tài khoản Google của bạn, bấm "Advanced" → "Go to (tên project) (unsafe)" nếu thấy cảnh báo (đây là bình thường vì đây là script tự viết).
5. Sau khi deploy xong, copy **Web app URL**, dạng:
   ```
   https://script.google.com/macros/s/AKfycb..................../exec
   ```

   ⚠️ Nếu sau này bạn **sửa lại code** trong `Code.gs`, nhớ **Deploy → Manage deployments → ✏️ (Edit) → New version → Deploy** để bản cập nhật có hiệu lực (chỉ lưu Ctrl+S thôi chưa cập nhật deployment cũ).

## Bước 4 — Điền URL vào trang web

Mở file `config.js`, thay dòng `API_URL` bằng URL vừa copy:

```js
const CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycb..................../exec"
};
```

## Bước 5 — Đưa lên GitHub Pages

1. Tạo 1 repo GitHub mới (public), ví dụ `cau-long-tinh-tien`.
2. Upload toàn bộ các file: `index.html`, `style.css`, `app.js`, `config.js` (thư mục `apps-script/` không cần upload lên đây, nó chỉ dùng để dán vào Apps Script ở Bước 2).
3. Vào **Settings → Pages** của repo → **Source**: chọn nhánh `main`, thư mục `/ (root)` → Save.
4. Sau ~1 phút, trang web sẽ chạy tại: `https://<tên-tài-khoản>.github.io/cau-long-tinh-tien/`

Xong! Mở link đó là dùng được, dữ liệu lưu thẳng vào Google Sheet của bạn.

---

## Cách dùng

- **Tạo trận đấu:** chọn ngày, nhập phí sân + phí cầu, tick chọn người tham gia (từ danh sách cố định), hoặc gõ tên mới ở ô "Thêm người mới cho trận này" nếu người đó không có trong danh sách cố định (chỉ áp dụng cho trận này, không tự thêm vào danh sách cố định).
- **Lịch sử trận đấu:** xem lại các trận đã lưu, lọc theo tháng, bấm "Sửa" để thêm/bỏ người tham gia (tiền mỗi người tự tính lại), hoặc xoá nếu ghi nhầm.
- **Tổng kết theo tháng:** bảng "scoreboard" tổng số tiền mỗi người phải trả trong tháng được chọn (cộng dồn từ tất cả các trận có họ tham gia).
- **Quỹ:** ghi nhận số tiền từng người trong danh sách cố định đã đóng (kèm ngày đóng). Tab này hiển thị số dư quỹ hiện tại của từng người = *Tổng đã đóng − Tổng chi phí các trận đã tham gia (tính từ trước tới nay)*. Số dư âm nghĩa là người đó còn thiếu (đã "xài" nhiều hơn đã đóng), số dư dương nghĩa là còn dư trong quỹ.
- **Danh sách cố định:** thêm/xoá người chơi thường xuyên, để lần sau tạo trận chọn nhanh bằng 1 cú click.

## Ghi chú kỹ thuật

- Cách chia tiền: mỗi trận có `Tổng phí = Phí sân + Phí cầu`, chia đều cho số người tham gia **trận đó** (không phải toàn bộ danh sách cố định) → `Mỗi người = Tổng phí / Số người tham gia`.
- Dữ liệu gốc nằm hoàn toàn trong Google Sheet của bạn — có thể mở Sheet ra xem/sửa tay bất cứ lúc nào, trang web sẽ tự đọc lại đúng dữ liệu mới.
- Vì Apps Script không hỗ trợ preflight CORS cho JSON, các yêu cầu ghi dữ liệu (POST) được gửi với `Content-Type: text/plain` để trình duyệt không gửi preflight — đây là cách làm chuẩn khi dùng Apps Script làm backend tĩnh.
- Nếu nhiều người cùng dùng chung 1 link, tất cả đều ghi vào chung 1 Google Sheet — phù hợp cho 1 nhóm/CLB dùng chung.

## Sự cố thường gặp

| Hiện tượng | Nguyên nhân / cách sửa |
|---|---|
| Báo "Chưa cấu hình API_URL" | Chưa dán URL vào `config.js`, hoặc dán sai định dạng (phải kết thúc bằng `/exec`) |
| Trang trắng / lỗi "Failed to fetch" | Apps Script chưa deploy ở chế độ "Anyone", hoặc URL sai. Kiểm tra lại Bước 3 |
| Sửa code Apps Script nhưng web không đổi | Quên tạo **New version** khi deploy lại (xem lưu ý ⚠️ ở Bước 3) |
| Dữ liệu không đồng bộ giữa nhiều máy | Bình thường — cần load lại trang (F5) để lấy dữ liệu mới nhất từ Sheet |
