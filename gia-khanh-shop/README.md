# Gia Khánh Store — Web bán hàng số hoá

Web bán hàng có: đăng nhập/đăng ký, ví nạp tiền qua QR ngân hàng (tự động cộng
tiền), trang admin quản lý sản phẩm, và tự động giao hàng ngay khi thanh toán
khớp.

## 1. Chạy thử ở máy tính (local)

Cần cài [Node.js](https://nodejs.org) bản 18 trở lên.

```bash
cd gia-khanh-shop
npm install
cp .env.example .env      # rồi mở file .env sửa lại thông tin ngân hàng của bạn
npm start
```

Mở trình duyệt vào `http://localhost:3000`.

Tài khoản admin mặc định được tạo tự động lần chạy đầu tiên:
- **Tên đăng nhập:** `admin`
- **Mật khẩu:** `admin123`

⚠️ **Đổi mật khẩu admin ngay** (hiện tại chưa có trang đổi mật khẩu trong bản
demo này — cách nhanh nhất là mở file `data.json`, xoá user admin, sửa
`server.js` phần `ensureAdmin` để đặt mật khẩu khác, hoặc tự thêm API đổi mật
khẩu).

## 2. Cách hoạt động của việc nạp tiền tự động

1. Khách bấm "Nạp tiền", nhập số tiền → server tạo một **mã nội dung chuyển
   khoản duy nhất** (ví dụ `GK12A9F3`) và trả về ảnh QR (dùng ảnh QR động miễn
   phí từ VietQR).
2. Khách quét QR bằng app ngân hàng, chuyển khoản đúng **nội dung** đó.
3. Có 2 cách để hệ thống biết tiền đã về:
   - **Cách thủ công (có sẵn, dùng ngay được):** Admin vào `/admin.html` →
     mục "Giao dịch nạp tiền" → bấm "Xác nhận" sau khi tự kiểm tra đã nhận
     tiền trên app ngân hàng.
   - **Cách tự động hoàn toàn (khuyên dùng khi vận hành thật):** Đăng ký tài
     khoản tại [SePay](https://sepay.vn) hoặc [Casso](https://casso.vn),
     kết nối với tài khoản ngân hàng của bạn, rồi cấu hình **Webhook URL**
     trỏ về:
     ```
     https://<domain-cua-ban>/api/webhook/sepay
     ```
     Nhớ đặt `SEPAY_WEBHOOK_TOKEN` trong `.env` trùng với token bạn cấu hình
     bên SePay, và **kiểm tra lại tên field** (`content`, `transferAmount`)
     trong tài liệu SePay hiện tại — nếu họ đổi tên field, sửa lại trong
     `server.js` (hàm xử lý route `/api/webhook/sepay`).

Khi nạp tiền để mua thẳng 1 sản phẩm (số dư không đủ lúc bấm "Mua ngay"),
web sẽ tự động gắn giao dịch nạp tiền đó với sản phẩm — khi tiền về, hệ thống
**tự trừ tiền và giao hàng ngay lập tức**, không cần thao tác gì thêm.

## 3. Quản lý sản phẩm (trang admin)

Vào `/admin.html` (đăng nhập bằng tài khoản có role admin). Mỗi sản phẩm có
một ô "Kho hàng" — mỗi dòng là 1 tài khoản/mã sẽ được giao **lần lượt** cho
khách khi có người mua (giao xong thì dòng đó biến mất khỏi kho).

## 4. Đưa web lên internet (deploy)

Khuyên dùng **Render.com** hoặc **Railway.app** (có gói miễn phí, hỗ trợ
Node.js sẵn):

1. Đẩy code này lên một repo GitHub.
2. Trên Render/Railway: tạo **Web Service** mới, trỏ vào repo đó.
3. Build command: `npm install` — Start command: `npm start`.
4. Thêm các biến môi trường trong phần **Environment** (giống nội dung file
   `.env`).
5. Sau khi deploy xong, bạn sẽ có 1 domain dạng
   `https://ten-app.onrender.com` — dùng domain này để cấu hình webhook SePay
   ở bước 2 phía trên.

## 5. Lưu ý bảo mật trước khi vận hành thật

- Đổi `JWT_SECRET` và `SEPAY_WEBHOOK_TOKEN` thành chuỗi ngẫu nhiên dài, không
  dùng giá trị mẫu.
- File `data.json` là toàn bộ dữ liệu (user, sản phẩm, đơn hàng) — nhớ backup
  định kỳ.
- Cân nhắc thêm HTTPS (Render/Railway tự cấp sẵn), giới hạn số lần đăng nhập
  sai (chống dò mật khẩu), và log lại các giao dịch webhook để đối soát.
