require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const db = require("./db");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const JWT_SECRET = process.env.JWT_SECRET || "doi-chuoi-bi-mat-nay-truoc-khi-deploy";
const SEPAY_WEBHOOK_TOKEN = process.env.SEPAY_WEBHOOK_TOKEN || "doi-token-webhook-nay";
const BANK_INFO = {
  bankCode: process.env.BANK_CODE || "MBBank",     // mã ngân hàng dùng cho VietQR (vd MBBank, VCB, TCB...)
  accountNo: process.env.BANK_ACCOUNT_NO || "0000000000",
  accountName: process.env.BANK_ACCOUNT_NAME || "TEN CHU TAI KHOAN"
};

// ---------- Helpers ----------
function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role, username: user.username }, JWT_SECRET, { expiresIn: "7d" });
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Chưa đăng nhập" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: "Token không hợp lệ hoặc hết hạn" });
  }
}

function adminRequired(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Chỉ admin mới được phép" });
  next();
}

function genDepositCode(userId) {
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `NAPGK${userId}${rand}`; // đổi "NAPGK" thành tiền tố bạn muốn
}

function vietQrUrl(amount, code) {
  const { bankCode, accountNo, accountName } = BANK_INFO;
  const params = new URLSearchParams({
    amount: String(amount),
    addInfo: code,
    accountName
  });
  return `https://img.vietqr.io/image/${bankCode}-${accountNo}-compact2.png?${params.toString()}`;
}

// ---------- Khởi tạo tài khoản admin đầu tiên nếu chưa có ----------
(function ensureAdmin() {
  const data = db.load();
  if (!data.users.some(u => u.role === "admin")) {
    const id = db.nextId(data);
    const passwordHash = bcrypt.hashSync("admin123", 10);
    data.users.push({
      id, username: "admin", phone: "0000000000",
      passwordHash, role: "admin", balance: 0
    });
    db.save(data);
    console.log("✅ Đã tạo tài khoản admin mặc định -> username: admin / mật khẩu: admin123 (ĐỔI NGAY sau khi đăng nhập lần đầu!)");
  }
})();

// ================= AUTH =================
app.post("/api/auth/register", (req, res) => {
  const { username, phone, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Thiếu tên đăng nhập hoặc mật khẩu" });
  const data = db.load();
  if (data.users.some(u => u.username === username)) {
    return res.status(409).json({ error: "Tên đăng nhập đã tồn tại" });
  }
  const id = db.nextId(data);
  const passwordHash = bcrypt.hashSync(password, 10);
  const user = { id, username, phone: phone || "", passwordHash, role: "user", balance: 0 };
  data.users.push(user);
  db.save(data);
  const token = signToken(user);
  res.json({ token, user: { id, username, role: user.role, balance: user.balance } });
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  const data = db.load();
  const user = data.users.find(u => u.username === username);
  if (!user || !bcrypt.compareSync(password || "", user.passwordHash)) {
    return res.status(401).json({ error: "Sai tên đăng nhập hoặc mật khẩu" });
  }
  const token = signToken(user);
  res.json({ token, user: { id: user.id, username: user.username, role: user.role, balance: user.balance } });
});

app.get("/api/auth/me", authRequired, (req, res) => {
  const data = db.load();
  const user = data.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "Không tìm thấy user" });
  res.json({ id: user.id, username: user.username, role: user.role, balance: user.balance });
});

// ================= SẢN PHẨM (công khai) =================
app.get("/api/products", (req, res) => {
  const data = db.load();
  const list = data.products.map(p => ({
    id: p.id, name: p.name, price: p.price, imageUrl: p.imageUrl,
    description: p.description, remaining: (p.stock || []).length
  }));
  res.json(list);
});

// ================= ADMIN: quản lý sản phẩm =================
app.get("/api/admin/products", authRequired, adminRequired, (req, res) => {
  const data = db.load();
  res.json(data.products);
});

app.post("/api/admin/products", authRequired, adminRequired, (req, res) => {
  const { name, price, imageUrl, description, stockText } = req.body || {};
  if (!name || !price) return res.status(400).json({ error: "Thiếu tên hoặc giá sản phẩm" });
  const data = db.load();
  const id = db.nextId(data);
  const stock = (stockText || "").split("\n").map(s => s.trim()).filter(Boolean);
  data.products.push({ id, name, price: Number(price), imageUrl: imageUrl || "", description: description || "", stock });
  db.save(data);
  res.json({ ok: true, id });
});

app.put("/api/admin/products/:id", authRequired, adminRequired, (req, res) => {
  const id = Number(req.params.id);
  const { name, price, imageUrl, description, stockText } = req.body || {};
  const data = db.load();
  const p = data.products.find(x => x.id === id);
  if (!p) return res.status(404).json({ error: "Không tìm thấy sản phẩm" });
  if (name !== undefined) p.name = name;
  if (price !== undefined) p.price = Number(price);
  if (imageUrl !== undefined) p.imageUrl = imageUrl;
  if (description !== undefined) p.description = description;
  if (stockText !== undefined) p.stock = stockText.split("\n").map(s => s.trim()).filter(Boolean);
  db.save(data);
  res.json({ ok: true });
});

app.delete("/api/admin/products/:id", authRequired, adminRequired, (req, res) => {
  const id = Number(req.params.id);
  const data = db.load();
  data.products = data.products.filter(p => p.id !== id);
  db.save(data);
  res.json({ ok: true });
});

app.get("/api/admin/deposits", authRequired, adminRequired, (req, res) => {
  const data = db.load();
  res.json(data.deposits.slice().reverse());
});

// Admin xác nhận nạp tiền thủ công (dùng khi chưa gắn webhook ngân hàng thật)
app.post("/api/admin/deposits/:id/confirm", authRequired, adminRequired, (req, res) => {
  const id = Number(req.params.id);
  const data = db.load();
  const dep = data.deposits.find(d => d.id === id);
  if (!dep) return res.status(404).json({ error: "Không tìm thấy giao dịch" });
  if (dep.status === "completed") return res.json({ ok: true, note: "Giao dịch đã được xác nhận trước đó" });
  const result = applyDeposit(data, dep);
  db.save(data);
  res.json({ ok: true, result });
});

// ================= VÍ / NẠP TIỀN =================
// Tạo yêu cầu nạp tiền: trả về mã QR + nội dung chuyển khoản
app.post("/api/wallet/deposit", authRequired, (req, res) => {
  const { amount, forProductId } = req.body || {};
  const amt = Number(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: "Số tiền không hợp lệ" });
  const data = db.load();
  const id = db.nextId(data);
  const code = genDepositCode(req.user.id);
  const deposit = {
    id, userId: req.user.id, code, amount: amt,
    status: "pending", forProductId: forProductId || null,
    createdAt: new Date().toISOString()
  };
  data.deposits.push(deposit);
  db.save(data);
  res.json({
    depositId: id,
    code,
    amount: amt,
    bank: BANK_INFO,
    qrUrl: vietQrUrl(amt, code)
  });
});

// Client polling để biết giao dịch đã được cộng tiền chưa
app.get("/api/wallet/deposit/:id/status", authRequired, (req, res) => {
  const id = Number(req.params.id);
  const data = db.load();
  const dep = data.deposits.find(d => d.id === id && d.userId === req.user.id);
  if (!dep) return res.status(404).json({ error: "Không tìm thấy" });
  res.json({ status: dep.status });
});

// ================= MUA HÀNG (trừ ví có sẵn) =================
app.post("/api/purchase", authRequired, (req, res) => {
  const { productId } = req.body || {};
  const data = db.load();
  const user = data.users.find(u => u.id === req.user.id);
  const product = data.products.find(p => p.id === Number(productId));
  if (!product) return res.status(404).json({ error: "Sản phẩm không tồn tại" });
  if (!product.stock || product.stock.length === 0) return res.status(400).json({ error: "Sản phẩm đã hết hàng" });
  if (user.balance < product.price) {
    return res.status(402).json({ error: "Số dư không đủ, vui lòng nạp thêm tiền", needAmount: product.price - user.balance });
  }
  user.balance -= product.price;
  const item = product.stock.shift();
  const orderId = db.nextId(data);
  const order = {
    id: orderId, userId: user.id, productId: product.id,
    productName: product.name, price: product.price,
    deliveredItem: item, createdAt: new Date().toISOString()
  };
  data.orders.push(order);
  db.save(data);
  res.json({ ok: true, order });
});

app.get("/api/orders/me", authRequired, (req, res) => {
  const data = db.load();
  const list = data.orders.filter(o => o.userId === req.user.id).reverse();
  res.json(list);
});

// ================= WEBHOOK NGÂN HÀNG (SePay / Casso...) =================
// Cấu hình URL này trong dashboard SePay: https://<domain-cua-ban>/api/webhook/sepay
// SePay sẽ gọi POST kèm header Authorization: Apikey <token> (tùy cấu hình) — kiểm tra tài liệu SePay để chỉnh lại tên header cho đúng.
app.post("/api/webhook/sepay", (req, res) => {
  const auth = req.headers.authorization || "";
  if (!auth.includes(SEPAY_WEBHOOK_TOKEN)) {
    return res.status(401).json({ error: "Token webhook không hợp lệ" });
  }
  // Payload SePay thường có dạng { content, transferAmount, ... } — chỉnh lại field cho khớp tài liệu thực tế của SePay khi bạn tích hợp
  const { content, transferAmount } = req.body || {};
  if (!content || !transferAmount) return res.status(400).json({ error: "Payload thiếu dữ liệu" });

  const data = db.load();
  const dep = data.deposits.find(d => d.status === "pending" && content.includes(d.code));
  if (!dep) {
    console.log("Không khớp giao dịch nào với nội dung:", content);
    return res.json({ ok: true, matched: false });
  }
  if (Number(transferAmount) < dep.amount) {
    console.log(`Số tiền chuyển (${transferAmount}) nhỏ hơn số tiền cần (${dep.amount}) cho mã ${dep.code}`);
    return res.json({ ok: true, matched: false, reason: "amount_mismatch" });
  }
  const result = applyDeposit(data, dep);
  db.save(data);
  res.json({ ok: true, matched: true, result });
});

// Cộng tiền + (nếu là mua hàng) tự động giao hàng
function applyDeposit(data, dep) {
  dep.status = "completed";
  const user = data.users.find(u => u.id === dep.userId);
  if (!user) return { error: "Không tìm thấy user" };
  user.balance += dep.amount;

  if (dep.forProductId) {
    const product = data.products.find(p => p.id === dep.forProductId);
    if (product && product.stock && product.stock.length > 0 && user.balance >= product.price) {
      user.balance -= product.price;
      const item = product.stock.shift();
      const orderId = db.nextId(data);
      const order = {
        id: orderId, userId: user.id, productId: product.id,
        productName: product.name, price: product.price,
        deliveredItem: item, createdAt: new Date().toISOString()
      };
      data.orders.push(order);
      return { type: "purchase_delivered", order };
    }
  }
  return { type: "topup", newBalance: user.balance };
}

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Gia Khánh Shop chạy tại http://localhost:${PORT}`));
