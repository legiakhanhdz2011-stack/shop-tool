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
function signToken(user, remember) {
  const expiresIn = remember ? "30d" : "12h";
  return jwt.sign({ id: user.id, role: user.role, username: user.username }, JWT_SECRET, { expiresIn });
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

// Xác thực "tuỳ chọn": nếu có token hợp lệ thì gắn req.user, không có/lỗi thì bỏ qua (không chặn request)
function authOptional(req, res, next) {
  const header = req.headers.authorization || "";
  const tokenStr = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (tokenStr) {
    try { req.user = jwt.verify(tokenStr, JWT_SECRET); } catch (e) { /* token sai/hết hạn thì coi như khách vãng lai */ }
  }
  next();
}

function isSellerRole(role) {
  return role === "seller" || role === "admin";
}

// Tính giá thực tế cho 1 sản phẩm tuỳ theo người mua có phải seller không (có giá sỉ riêng)
function effectivePrice(product, role) {
  if (isSellerRole(role) && product.wholesalePrice) return product.wholesalePrice;
  return product.price;
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
  const { username, phone, password, remember } = req.body || {};
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
  const token = signToken(user, remember);
  res.json({ token, user: { id, username, role: user.role, balance: user.balance } });
});

app.post("/api/auth/login", (req, res) => {
  const { username, password, remember } = req.body || {};
  const data = db.load();
  const user = data.users.find(u => u.username === username);
  if (!user || !bcrypt.compareSync(password || "", user.passwordHash)) {
    return res.status(401).json({ error: "Sai tên đăng nhập hoặc mật khẩu" });
  }
  const token = signToken(user, remember);
  res.json({ token, user: { id: user.id, username: user.username, role: user.role, balance: user.balance } });
});

app.get("/api/auth/me", authRequired, (req, res) => {
  const data = db.load();
  const user = data.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "Không tìm thấy user" });
  res.json({ id: user.id, username: user.username, role: user.role, balance: user.balance });
});

// ================= SẢN PHẨM (công khai, có tính giá sỉ nếu người xem là seller) =================
app.get("/api/products", authOptional, (req, res) => {
  const data = db.load();
  const role = req.user?.role;
  const list = data.products.map(p => {
    const price = effectivePrice(p, role);
    return {
      id: p.id, name: p.name, price,
      isWholesale: price !== p.price,
      imageUrl: p.imageUrl, description: p.description,
      remaining: (p.stock || []).length,
      soldCount: p.soldCount || 0
    };
  });
  res.json(list);
});

// ================= ADMIN: quản lý sản phẩm =================
app.get("/api/admin/products", authRequired, adminRequired, (req, res) => {
  const data = db.load();
  const list = data.products.map(p => ({ ...p, soldCount: p.soldCount || 0 }));
  res.json(list);
});

app.post("/api/admin/products", authRequired, adminRequired, (req, res) => {
  const { name, price, wholesalePrice, imageUrl, description, stockText } = req.body || {};
  if (!name || !price) return res.status(400).json({ error: "Thiếu tên hoặc giá sản phẩm" });
  const data = db.load();
  const id = db.nextId(data);
  const stock = (stockText || "").split("\n").map(s => s.trim()).filter(Boolean);
  data.products.push({
    id, name, price: Number(price),
    wholesalePrice: wholesalePrice ? Number(wholesalePrice) : null,
    imageUrl: imageUrl || "", description: description || "", stock
  });
  db.save(data);
  res.json({ ok: true, id });
});

app.put("/api/admin/products/:id", authRequired, adminRequired, (req, res) => {
  const id = Number(req.params.id);
  const { name, price, wholesalePrice, imageUrl, description, stockText } = req.body || {};
  const data = db.load();
  const p = data.products.find(x => x.id === id);
  if (!p) return res.status(404).json({ error: "Không tìm thấy sản phẩm" });
  if (name !== undefined) p.name = name;
  if (price !== undefined) p.price = Number(price);
  if (wholesalePrice !== undefined) p.wholesalePrice = wholesalePrice ? Number(wholesalePrice) : null;
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

// ================= ADMIN: quản lý người dùng / cấp quyền seller =================
app.get("/api/admin/users", authRequired, adminRequired, (req, res) => {
  const data = db.load();
  res.json(data.users.map(u => ({ id: u.id, username: u.username, phone: u.phone, role: u.role, balance: u.balance })));
});

app.post("/api/admin/users/:id/role", authRequired, adminRequired, (req, res) => {
  const id = Number(req.params.id);
  const { role } = req.body || {};
  if (!["user", "seller", "admin"].includes(role)) return res.status(400).json({ error: "Vai trò không hợp lệ" });
  const data = db.load();
  const user = data.users.find(u => u.id === id);
  if (!user) return res.status(404).json({ error: "Không tìm thấy user" });
  user.role = role;
  db.save(data);
  res.json({ ok: true });
});

// ================= PUBLIC: thống kê & hoạt động gần đây (dùng cho trang chủ) =================
function maskUsername(username) {
  if (!username) return "***";
  if (username.length <= 4) return "***" + username;
  return "***" + username.slice(-5);
}

app.get("/api/public/stats", (req, res) => {
  const data = db.load();
  res.json({
    totalOrders: data.orders.length,
    totalProducts: data.products.length,
    totalUsers: data.users.length
  });
});

app.get("/api/public/activity", (req, res) => {
  const data = db.load();
  const usersById = Object.fromEntries(data.users.map(u => [u.id, u]));

  const recentDeposits = data.deposits
    .filter(d => d.status === "completed")
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 8)
    .map(d => ({
      username: maskUsername(usersById[d.userId]?.username),
      amount: d.amount,
      createdAt: d.createdAt
    }));

  const recentOrders = data.orders
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 8)
    .map(o => ({
      username: maskUsername(usersById[o.userId]?.username),
      productName: o.productName,
      price: o.price,
      createdAt: o.createdAt
    }));

  res.json({ recentDeposits, recentOrders });
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
  const { amount, forProductId, forQuantity } = req.body || {};
  const amt = Number(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: "Số tiền không hợp lệ" });
  const data = db.load();
  const id = db.nextId(data);
  const code = genDepositCode(req.user.id);
  const deposit = {
    id, userId: req.user.id, code, amount: amt,
    status: "pending", forProductId: forProductId || null,
    forQuantity: Math.max(1, parseInt(forQuantity, 10) || 1),
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
  let deliveredOrder = null;
  if (dep.status === "completed" && dep.forProductId) {
    // Tìm đơn hàng được tạo cùng lúc nạp tiền này (gần đúng theo userId + productId + thời điểm sau khi tạo deposit)
    deliveredOrder = data.orders
      .filter(o => o.userId === dep.userId && o.productId === dep.forProductId && new Date(o.createdAt) >= new Date(dep.createdAt))
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0] || null;
  }
  res.json({ status: dep.status, deliveredItems: deliveredOrder ? deliveredOrder.deliveredItems : null });
});

// ================= MUA HÀNG (trừ ví có sẵn) =================
app.post("/api/purchase", authRequired, (req, res) => {
  const { productId, quantity } = req.body || {};
  const qty = Math.max(1, parseInt(quantity, 10) || 1);
  const data = db.load();
  const user = data.users.find(u => u.id === req.user.id);
  const product = data.products.find(p => p.id === Number(productId));
  if (!product) return res.status(404).json({ error: "Sản phẩm không tồn tại" });
  if (!product.stock || product.stock.length < qty) {
    return res.status(400).json({ error: `Kho chỉ còn ${product.stock ? product.stock.length : 0} sản phẩm, không đủ số lượng bạn chọn` });
  }
  const unitPrice = effectivePrice(product, user.role);
  const totalPrice = unitPrice * qty;
  if (user.balance < totalPrice) {
    return res.status(402).json({ error: "Số dư không đủ, vui lòng nạp thêm tiền", needAmount: totalPrice - user.balance });
  }
  user.balance -= totalPrice;
  const deliveredItems = product.stock.splice(0, qty);
  product.soldCount = (product.soldCount || 0) + qty;
  const orderId = db.nextId(data);
  const order = {
    id: orderId, userId: user.id, productId: product.id,
    productName: product.name, price: totalPrice, unitPrice, quantity: qty,
    deliveredItems, createdAt: new Date().toISOString()
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
    return res.status(401).json({ success: false, error: "Token webhook không hợp lệ" });
  }
  // Payload thật của SePay: { id, gateway, transactionDate, accountNumber, code, content, transferType, transferAmount, accumulated, referenceCode }
  const { id: sepayTxId, content, transferAmount, transferType } = req.body || {};
  if (!content || transferAmount === undefined) {
    return res.status(400).json({ success: false, error: "Payload thiếu dữ liệu" });
  }
  // Chỉ xử lý giao dịch tiền VÀO, bỏ qua tiền ra
  if (transferType && transferType !== "in") {
    return res.status(200).json({ success: true });
  }

  const data = db.load();

  // Chống xử lý trùng nếu SePay gửi lại webhook cùng 1 giao dịch (retry)
  data.processedWebhookIds = data.processedWebhookIds || [];
  if (sepayTxId && data.processedWebhookIds.includes(sepayTxId)) {
    return res.status(200).json({ success: true, note: "Đã xử lý trước đó" });
  }

  const dep = data.deposits.find(d => d.status === "pending" && content.includes(d.code));
  if (!dep) {
    console.log("Không khớp giao dịch nào với nội dung:", content);
    if (sepayTxId) data.processedWebhookIds.push(sepayTxId);
    db.save(data);
    return res.status(200).json({ success: true, matched: false });
  }
  if (Number(transferAmount) < dep.amount) {
    console.log(`Số tiền chuyển (${transferAmount}) nhỏ hơn số tiền cần (${dep.amount}) cho mã ${dep.code}`);
    if (sepayTxId) data.processedWebhookIds.push(sepayTxId);
    db.save(data);
    return res.status(200).json({ success: true, matched: false, reason: "amount_mismatch" });
  }

  const result = applyDeposit(data, dep);
  if (sepayTxId) data.processedWebhookIds.push(sepayTxId);
  db.save(data);
  // SePay coi là thành công khi nhận HTTP 200/201 kèm {"success": true} trong 30 giây
  res.status(200).json({ success: true, matched: true, result });
});

// Cộng tiền + (nếu là mua hàng) tự động giao hàng
function applyDeposit(data, dep) {
  dep.status = "completed";
  const user = data.users.find(u => u.id === dep.userId);
  if (!user) return { error: "Không tìm thấy user" };
  user.balance += dep.amount;

  if (dep.forProductId) {
    const product = data.products.find(p => p.id === dep.forProductId);
    const qty = Math.max(1, dep.forQuantity || 1);
    const unitPrice = product ? effectivePrice(product, user.role) : null;
    const totalPrice = unitPrice !== null ? unitPrice * qty : null;
    if (product && product.stock && product.stock.length >= qty && totalPrice !== null && user.balance >= totalPrice) {
      user.balance -= totalPrice;
      const deliveredItems = product.stock.splice(0, qty);
      product.soldCount = (product.soldCount || 0) + qty;
      const orderId = db.nextId(data);
      const order = {
        id: orderId, userId: user.id, productId: product.id,
        productName: product.name, price: totalPrice, unitPrice, quantity: qty,
        deliveredItems, createdAt: new Date().toISOString()
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
