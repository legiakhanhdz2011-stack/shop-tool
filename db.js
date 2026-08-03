// db.js — CSDL đơn giản dạng file JSON (đủ dùng cho shop nhỏ/vừa).
// Nếu sau này cần scale lớn, có thể thay bằng PostgreSQL/MongoDB nhưng
// interface (đọc/ghi hàm) vẫn giữ nguyên để không phải sửa nhiều code.

const fs = require("fs");
const path = require("path");

const DB_FILE = path.join(__dirname, "data.json");

function defaultData() {
  return {
    users: [],       // {id, username, phone, passwordHash, role, balance}
    products: [],     // {id, name, price, imageUrl, description, stock: [string,...]}
    deposits: [],     // {id, userId, code, amount, status, forProductId, createdAt}
    orders: []        // {id, userId, productId, productName, price, deliveredItem, createdAt}
  };
}

function load() {
  if (!fs.existsSync(DB_FILE)) {
    save(defaultData());
  }
  const raw = fs.readFileSync(DB_FILE, "utf-8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error("Lỗi đọc data.json, khởi tạo lại:", e);
    const fresh = defaultData();
    save(fresh);
    return fresh;
  }
}

function save(data) {
  // Ghi ra file tạm rồi rename để tránh mất dữ liệu nếu server crash giữa chừng
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

let nextIdCounter = null;
function nextId(data) {
  if (nextIdCounter === null) {
    const all = [
      ...data.users, ...data.products, ...data.deposits, ...data.orders
    ];
    nextIdCounter = all.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1;
  }
  return nextIdCounter++;
}

module.exports = { load, save, nextId, DB_FILE };
