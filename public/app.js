const API = "";
let token = localStorage.getItem("gk_token") || sessionStorage.getItem("gk_token") || null;
let me = null;
let pollTimer = null;

const $ = (sel) => document.querySelector(sel);
const els = {
  balanceChip: $("#balanceChip"), balanceVal: $("#balanceVal"),
  btnLogin: $("#btnLogin"), btnDeposit: $("#btnDeposit"),
  btnAdmin: $("#btnAdmin"), btnLogout: $("#btnLogout"),
  btnHistory: $("#btnHistory"),
  productGrid: $("#productGrid"),
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

// ---------- Modal thành công (dùng chung cho mua hàng & nạp tiền) ----------
function showSuccessModal({ title, subtitle, deliveredItem }) {
  $("#successTitle").textContent = title;
  $("#successSubtitle").textContent = subtitle || "";
  const box = $("#successItemBox");
  if (deliveredItem) {
    box.classList.remove("hidden");
    $("#successItemMasked").textContent = "•".repeat(Math.min(24, Math.max(10, deliveredItem.length)));
    $("#successItemMasked").dataset.real = deliveredItem;
    $("#successRevealBtn").classList.remove("hidden");
    $("#successRevealBtn").textContent = "👁 Hiện";
    $("#successCopyBtn").classList.add("hidden");
  } else {
    box.classList.add("hidden");
  }
  // re-trigger animation của dấu tick (reset rồi cho chạy lại)
  const circle = document.querySelector("#successModal .check-circle");
  const mark = document.querySelector("#successModal .check-mark");
  [circle, mark].forEach(el => { el.style.animation = "none"; });
  void document.querySelector("#successModal svg").offsetWidth; // ép reflow
  [circle, mark].forEach(el => { el.style.animation = ""; });
  openModal("successModal");
}

$("#successRevealBtn").addEventListener("click", () => {
  const el = $("#successItemMasked");
  const revealed = el.textContent === el.dataset.real;
  el.textContent = revealed ? "•".repeat(Math.min(24, Math.max(10, el.dataset.real.length))) : el.dataset.real;
  $("#successRevealBtn").textContent = revealed ? "👁 Hiện" : "🙈 Ẩn";
  $("#successCopyBtn").classList.toggle("hidden", revealed);
});
$("#successCopyBtn").addEventListener("click", async () => {
  const el = $("#successItemMasked");
  try {
    await navigator.clipboard.writeText(el.dataset.real);
    toast("Đã copy vào bộ nhớ tạm");
  } catch (e) {
    toast("Không copy được, hãy tự bôi đen để copy");
  }
});

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
    const remember = $("#loginRemember").checked;
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: $("#loginUsername").value.trim(),
        password: $("#loginPassword").value,
        remember
      })
    });
    onLoginSuccess(data, remember);
  } catch (err) {
    $("#loginError").textContent = err.message;
  }
});

$("#registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#registerError").textContent = "";
  try {
    const remember = $("#regRemember").checked;
    const data = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        username: $("#regUsername").value.trim(),
        phone: $("#regPhone").value.trim(),
        password: $("#regPassword").value,
        remember
      })
    });
    onLoginSuccess(data, remember);
  } catch (err) {
    $("#registerError").textContent = err.message;
  }
});

function onLoginSuccess(data, remember) {
  token = data.token;
  me = data.user;
  // Ghi nhớ -> localStorage (giữ khi tắt trình duyệt). Không ghi nhớ -> sessionStorage (mất khi đóng tab).
  localStorage.removeItem("gk_token");
  sessionStorage.removeItem("gk_token");
  (remember ? localStorage : sessionStorage).setItem("gk_token", token);
  closeModal("authModal");
  updateHeader();
  toast(`Xin chào ${me.username} 👋`);
}

els.btnLogout.addEventListener("click", () => {
  token = null; me = null;
  localStorage.removeItem("gk_token");
  sessionStorage.removeItem("gk_token");
  updateHeader();
});

els.btnAdmin.addEventListener("click", () => window.location.href = "/admin.html");

function updateHeader() {
  const loggedIn = !!token && !!me;
  els.btnLogin.classList.toggle("hidden", loggedIn);
  els.btnDeposit.classList.toggle("hidden", !loggedIn);
  els.btnLogout.classList.toggle("hidden", !loggedIn);
  els.btnHistory.classList.toggle("hidden", !loggedIn);
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
    token = null; me = null;
    localStorage.removeItem("gk_token"); sessionStorage.removeItem("gk_token");
    updateHeader();
  }
}

// ---------- Lịch sử giao dịch (ẩn key, bấm mới hiện) ----------
els.btnHistory.addEventListener("click", async () => {
  openModal("historyModal");
  const list = document.getElementById("historyList");
  list.innerHTML = `<p class="hint">Đang tải...</p>`;
  try {
    const orders = await api("/api/orders/me");
    if (orders.length === 0) {
      list.innerHTML = `<p class="hint">Chưa có giao dịch nào</p>`;
      return;
    }
    list.innerHTML = orders.map((o, idx) => `
      <div class="history-item">
        <div class="row1"><span>${o.productName}</span><span class="price">${Number(o.price).toLocaleString("vi-VN")}đ</span></div>
        <div class="key-row">
          <span class="key-masked" id="hist-key-${idx}" data-real="${encodeURIComponent(o.deliveredItem)}">${"•".repeat(Math.min(24, Math.max(10, o.deliveredItem.length)))}</span>
          <button class="btn btn-ghost small-btn" data-reveal="${idx}">👁 Hiện</button>
          <button class="btn btn-ghost small-btn hidden" data-copy="${idx}">📋 Copy</button>
        </div>
        <div class="date">${new Date(o.createdAt).toLocaleString("vi-VN")}</div>
      </div>
    `).join("");

    document.querySelectorAll("[data-reveal]").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = btn.dataset.reveal;
        const el = document.getElementById(`hist-key-${idx}`);
        const real = decodeURIComponent(el.dataset.real);
        const isRevealed = el.textContent === real;
        el.textContent = isRevealed ? "•".repeat(Math.min(24, Math.max(10, real.length))) : real;
        btn.textContent = isRevealed ? "👁 Hiện" : "🙈 Ẩn";
        const copyBtn = document.querySelector(`[data-copy="${idx}"]`);
        copyBtn.classList.toggle("hidden", isRevealed);
      });
    });
    document.querySelectorAll("[data-copy]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const el = document.getElementById(`hist-key-${btn.dataset.copy}`);
        try {
          await navigator.clipboard.writeText(decodeURIComponent(el.dataset.real));
          toast("Đã copy vào bộ nhớ tạm");
        } catch (e) {
          toast("Không copy được, hãy tự bôi đen để copy");
        }
      });
    });
  } catch (err) {
    list.innerHTML = `<p class="hint">Lỗi tải lịch sử: ${err.message}</p>`;
  }
});

// ---------- Sản phẩm ----------
async function loadProducts() {
  const list = await api("/api/products");
  els.productGrid.innerHTML = list.map(p => `
    <div class="card">
      <img src="${p.imageUrl || "https://placehold.co/300x300?text=" + encodeURIComponent(p.name)}" alt="${p.name}" />
      ${p.isWholesale ? `<span class="wholesale-badge">🏷️ Giá sỉ dành cho bạn</span>` : ""}
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
    me.balance -= price;
    updateHeader();
    loadProducts();
    showSuccessModal({
      title: "🎉 Mua hàng thành công!",
      subtitle: "Cảm ơn bạn đã ủng hộ shop.",
      deliveredItem: data.order.deliveredItem
    });
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
  $("#depositWaitStatus").textContent = "Đang chờ thanh toán... hệ thống sẽ tự cộng tiền khi nhận được chuyển khoản đúng nội dung.";
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
    $("#depAmountShow").textContent = Number(data.amount).toLocaleString("vi-VN") + "đ";
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
        await refreshMe();
        await loadProducts();
        closeModal("depositModal");
        if (s.deliveredItem) {
          showSuccessModal({
            title: "🎉 Nạp tiền & mua hàng thành công!",
            subtitle: "Hệ thống đã tự động giao sản phẩm cho bạn.",
            deliveredItem: s.deliveredItem
          });
        } else {
          showSuccessModal({
            title: "✅ Nạp tiền thành công!",
            subtitle: "Số dư của bạn đã được cập nhật, sẵn sàng mua sắm.",
            deliveredItem: null
          });
        }
      }
    } catch (e) { /* bỏ qua lỗi tạm thời khi poll */ }
  }, 3000);
}

// ---------- Init ----------
(async function init() {
  await refreshMe();
  await loadProducts();
})();
