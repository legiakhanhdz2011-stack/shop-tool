const API = "";
let token = localStorage.getItem("gk_token") || null;
let me = null;
let pollTimer = null;

const $ = (sel) => document.querySelector(sel);
const els = {
  balanceChip: $("#balanceChip"), balanceVal: $("#balanceVal"),
  btnLogin: $("#btnLogin"), btnDeposit: $("#btnDeposit"),
  btnAdmin: $("#btnAdmin"), btnLogout: $("#btnLogout"),
  productGrid: $("#productGrid"),
  authModal: $("#authModal"), depositModal: $("#depositModal"),
};

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function openModal(id) { $("#" + id).classList.remove("hidden"); }
function closeModal(id) { $("#" + id).classList.add("hidden"); }
document.querySelectorAll("[data-close]").forEach(btn => {
  btn.addEventListener("click", () => closeModal(btn.dataset.close));
});

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(API + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Lỗi không xác định");
  return data;
}

// ---------- Auth ----------
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    tab.classList.add("active");
    $("#" + tab.dataset.tab + "Form").classList.add("active");
  });
});

els.btnLogin.addEventListener("click", () => openModal("authModal"));

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#loginError").textContent = "";
  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: $("#loginUsername").value.trim(),
        password: $("#loginPassword").value
      })
    });
    onLoginSuccess(data);
  } catch (err) {
    $("#loginError").textContent = err.message;
  }
});

$("#registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#registerError").textContent = "";
  try {
    const data = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        username: $("#regUsername").value.trim(),
        phone: $("#regPhone").value.trim(),
        password: $("#regPassword").value
      })
    });
    onLoginSuccess(data);
  } catch (err) {
    $("#registerError").textContent = err.message;
  }
});

function onLoginSuccess(data) {
  token = data.token;
  me = data.user;
  localStorage.setItem("gk_token", token);
  closeModal("authModal");
  updateHeader();
  toast(`Xin chào ${me.username} 👋`);
}

els.btnLogout.addEventListener("click", () => {
  token = null; me = null;
  localStorage.removeItem("gk_token");
  updateHeader();
});

els.btnAdmin.addEventListener("click", () => window.location.href = "/admin.html");

function updateHeader() {
  const loggedIn = !!token && !!me;
  els.btnLogin.classList.toggle("hidden", loggedIn);
  els.btnDeposit.classList.toggle("hidden", !loggedIn);
  els.btnLogout.classList.toggle("hidden", !loggedIn);
  els.balanceChip.classList.toggle("hidden", !loggedIn);
  els.btnAdmin.classList.toggle("hidden", !(loggedIn && me.role === "admin"));
  if (loggedIn) els.balanceVal.textContent = Number(me.balance).toLocaleString("vi-VN");
}

async function refreshMe() {
  if (!token) return;
  try {
    me = await api("/api/auth/me");
    updateHeader();
  } catch (e) {
    token = null; me = null; localStorage.removeItem("gk_token"); updateHeader();
  }
}

// ---------- Sản phẩm ----------
async function loadProducts() {
  const list = await api("/api/products");
  els.productGrid.innerHTML = list.map(p => `
    <div class="card">
      <img src="${p.imageUrl || "https://placehold.co/300x300?text=" + encodeURIComponent(p.name)}" alt="${p.name}" />
      <h3>${p.name}</h3>
      <div class="desc">${p.description || ""}</div>
      <div class="price">${Number(p.price).toLocaleString("vi-VN")}đ</div>
      <div class="stock">${p.remaining > 0 ? "Còn " + p.remaining + " sản phẩm" : "Hết hàng"}</div>
      <button class="btn btn-primary full" ${p.remaining <= 0 ? "disabled" : ""} data-buy="${p.id}" data-price="${p.price}">Mua ngay</button>
    </div>
  `).join("");

  document.querySelectorAll("[data-buy]").forEach(btn => {
    btn.addEventListener("click", () => buyProduct(Number(btn.dataset.buy), Number(btn.dataset.price)));
  });
}

async function buyProduct(productId, price) {
  if (!token) { openModal("authModal"); return; }
  try {
    const data = await api("/api/purchase", { method: "POST", body: JSON.stringify({ productId }) });
    toast(`🎉 Mua thành công! Đồ của bạn: ${data.order.deliveredItem}`);
    me.balance -= price;
    updateHeader();
    loadProducts();
  } catch (err) {
    if (err.message.includes("Số dư không đủ")) {
      toast("Số dư không đủ, vui lòng nạp tiền để mua ngay sản phẩm này");
      openDepositForProduct(productId, price);
    } else {
      toast("❌ " + err.message);
    }
  }
}

// ---------- Nạp tiền ----------
let currentForProductId = null;

els.btnDeposit.addEventListener("click", () => {
  currentForProductId = null;
  resetDepositModal();
  openModal("depositModal");
});

function openDepositForProduct(productId, price) {
  currentForProductId = productId;
  resetDepositModal();
  $("#depositAmount").value = price;
  openModal("depositModal");
}

function resetDepositModal() {
  $("#depositStep1").classList.remove("hidden");
  $("#depositStep2").classList.add("hidden");
  $("#depositWaitStatus").textContent = "";
  if (pollTimer) clearInterval(pollTimer);
}

$("#btnCreateDeposit").addEventListener("click", async () => {
  const amount = Number($("#depositAmount").value);
  if (!amount || amount < 1000) return toast("Nhập số tiền hợp lệ (tối thiểu 1,000đ)");
  try {
    const data = await api("/api/wallet/deposit", {
      method: "POST",
      body: JSON.stringify({ amount, forProductId: currentForProductId })
    });
    $("#depositStep1").classList.add("hidden");
    $("#depositStep2").classList.remove("hidden");
    $("#depositQr").src = data.qrUrl;
    $("#bankName").textContent = data.bank.bankCode;
    $("#bankAccount").textContent = data.bank.accountNo;
    $("#bankOwner").textContent = data.bank.accountName;
    $("#depAmountShow").textContent = Number(data.amount).toLocaleString("vi-VN");
    $("#depCode").textContent = data.code;
    startPolling(data.depositId);
  } catch (err) {
    toast("❌ " + err.message);
  }
});

function startPolling(depositId) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const s = await api(`/api/wallet/deposit/${depositId}/status`);
      if (s.status === "completed") {
        clearInterval(pollTimer);
        $("#depositWaitStatus").textContent = "✅ Đã nhận được thanh toán!";
        await refreshMe();
        await loadProducts();
        toast("✅ Nạp tiền / mua hàng thành công!");
        setTimeout(() => closeModal("depositModal"), 1500);
      }
    } catch (e) { /* bỏ qua lỗi tạm thời khi poll */ }
  }, 3000);
}

// ---------- Init ----------
(async function init() {
  await refreshMe();
  await loadProducts();
})();
