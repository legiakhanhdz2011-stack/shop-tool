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
function showSuccessModal({ title, subtitle, deliveredItems }) {
  $("#successTitle").textContent = title;
  $("#successSubtitle").textContent = subtitle || "";
  const box = $("#successItemBox");
  if (deliveredItems && deliveredItems.length) {
    box.classList.remove("hidden");
    const joined = deliveredItems.join("\n");
    $("#successItemMasked").textContent = deliveredItems.length > 1
      ? `🔒 ${deliveredItems.length} sản phẩm — bấm "Hiện" để xem`
      : "🔒 Đã ẩn — bấm \"Hiện\" để xem";
    $("#successItemMasked").dataset.real = joined;
    $("#successItemMasked").classList.remove("revealed");
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
  const isRevealed = el.classList.contains("revealed");
  if (isRevealed) {
    const count = el.dataset.real.split("\n").length;
    el.textContent = count > 1 ? `🔒 ${count} sản phẩm — bấm "Hiện" để xem` : "🔒 Đã ẩn — bấm \"Hiện\" để xem";
    el.classList.remove("revealed");
  } else {
    el.textContent = el.dataset.real;
    el.classList.add("revealed");
  }
  $("#successRevealBtn").textContent = isRevealed ? "👁 Hiện" : "🙈 Ẩn";
  $("#successCopyBtn").classList.toggle("hidden", isRevealed);
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

function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "vừa xong";
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  return `${days} ngày trước`;
}

// ---------- Nav / liên kết mở modal ----------
document.getElementById("navDeposit")?.addEventListener("click", (e) => { e.preventDefault(); openDepositEntry(); });
document.getElementById("footerDeposit")?.addEventListener("click", (e) => { e.preventDefault(); openDepositEntry(); });
document.getElementById("heroDepositBtn")?.addEventListener("click", () => openDepositEntry());
document.getElementById("navHistory")?.addEventListener("click", (e) => { e.preventDefault(); openHistory(); });

function openDepositEntry() {
  if (!token) { openModal("authModal"); return; }
  currentForProductId = null;
  currentForQuantity = 1;
  resetDepositModal();
  openModal("depositModal");
}

// ---------- Thống kê & hoạt động gần đây (trang chủ) ----------
async function loadPublicStats() {
  try {
    const stats = await api("/api/public/stats");
    document.getElementById("statOrders").textContent = stats.totalOrders + "+";
    document.getElementById("statUsers").textContent = stats.totalUsers + "+";
    document.getElementById("statProducts").textContent = stats.totalProducts + "+";
  } catch (e) { /* im lặng nếu lỗi, không quan trọng bằng chức năng chính */ }
}

async function loadPublicActivity() {
  try {
    const { recentDeposits, recentOrders } = await api("/api/public/activity");
    const depEl = document.getElementById("activityDeposits");
    const ordEl = document.getElementById("activityOrders");
    depEl.innerHTML = recentDeposits.length ? recentDeposits.map(d => `
      <div class="activity-item">
        <div><div class="who">${d.username}</div><div class="what">đã nạp tiền</div></div>
        <div style="text-align:right;">
          <div class="amount">+${Number(d.amount).toLocaleString("vi-VN")}đ</div>
          <div class="time">${timeAgo(d.createdAt)}</div>
        </div>
      </div>
    `).join("") : `<p class="hint">Chưa có giao dịch nào</p>`;

    ordEl.innerHTML = recentOrders.length ? recentOrders.map(o => `
      <div class="activity-item">
        <div><div class="who">${o.username}</div><div class="what">đã mua ${o.productName}</div></div>
        <div style="text-align:right;">
          <div class="amount buy">${Number(o.price).toLocaleString("vi-VN")}đ</div>
          <div class="time">${timeAgo(o.createdAt)}</div>
        </div>
      </div>
    `).join("") : `<p class="hint">Chưa có giao dịch nào</p>`;
  } catch (e) { /* im lặng nếu lỗi */ }
}

// ---------- Đánh giá khách hàng (chỉnh sửa nội dung mẫu này theo đánh giá thật của shop bạn) ----------
const TESTIMONIALS = [
  { name: "GamerPro99", tag: "Sản phẩm A", text: "Chất lượng, giao ngay sau khi thanh toán. Rất hài lòng!" },
  { name: "TurboPlay", tag: "Sản phẩm B", text: "Đúng mô tả, giao hàng nhanh, đã xác nhận thành công." },
  { name: "SoloQ_VN", tag: "Sản phẩm A", text: "Ổn mọi thứ, hỗ trợ nhanh khi có thắc mắc." },
  { name: "ProSmurfer", tag: "Sản phẩm C", text: "Đúng mô tả, hỗ trợ tốt, sẽ ủng hộ tiếp." },
  { name: "WhaleMaster", tag: "Sản phẩm B", text: "Chuẩn mô tả, đáng tiền luôn!" },
];

function renderTestimonials() {
  const track = document.getElementById("marqueeTrack");
  if (!track) return;
  const cardsHtml = TESTIMONIALS.map(t => `
    <div class="testimonial-card">
      <div class="testimonial-head">
        <div class="testimonial-avatar">${t.name[0]}</div>
        <div><div class="testimonial-name">${t.name}</div><div class="testimonial-game">${t.tag}</div></div>
      </div>
      <div class="testimonial-text">"${t.text}"</div>
    </div>
  `).join("");
  // Lặp lại 2 lần để chạy marquee liền mạch không bị đứt đoạn
  track.innerHTML = cardsHtml + cardsHtml;
}
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
els.btnHistory.addEventListener("click", () => openHistory());

async function openHistory() {
  if (!token) { openModal("authModal"); return; }
  openModal("historyModal");
  const list = document.getElementById("historyList");
  list.innerHTML = `<p class="hint">Đang tải...</p>`;
  try {
    const orders = await api("/api/orders/me");
    if (orders.length === 0) {
      list.innerHTML = `<p class="hint">Chưa có giao dịch nào</p>`;
      return;
    }
    list.innerHTML = orders.map((o, idx) => {
      const items = o.deliveredItems || (o.deliveredItem ? [o.deliveredItem] : []);
      const joined = items.join("\n");
      const qty = o.quantity || items.length || 1;
      return `
      <div class="history-item">
        <div class="row1"><span>${o.productName}${qty > 1 ? ` × ${qty}` : ""}</span><span class="price">${Number(o.price).toLocaleString("vi-VN")}đ</span></div>
        <div class="key-row">
          <span class="key-masked" id="hist-key-${idx}" data-real="${encodeURIComponent(joined)}">${items.length > 1 ? `🔒 ${items.length} sản phẩm` : "🔒 Đã ẩn"} — bấm "Hiện" để xem</span>
          <button class="btn btn-ghost small-btn" data-reveal="${idx}">👁 Hiện</button>
          <button class="btn btn-ghost small-btn hidden" data-copy="${idx}">📋 Copy</button>
        </div>
        <div class="date">${new Date(o.createdAt).toLocaleString("vi-VN")}</div>
      </div>
    `;
    }).join("");

    document.querySelectorAll("[data-reveal]").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = btn.dataset.reveal;
        const el = document.getElementById(`hist-key-${idx}`);
        const real = decodeURIComponent(el.dataset.real);
        const isRevealed = el.classList.contains("revealed");
        if (isRevealed) {
          const count = real.split("\n").length;
          el.textContent = `${count > 1 ? `🔒 ${count} sản phẩm` : "🔒 Đã ẩn"} — bấm "Hiện" để xem`;
          el.classList.remove("revealed");
        } else {
          el.textContent = real;
          el.classList.add("revealed");
        }
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
}

// ---------- Sản phẩm ----------
async function loadProducts() {
  const list = await api("/api/products");
  els.productGrid.innerHTML = list.map(p => `
    <div class="card">
      <img src="${p.imageUrl || "https://placehold.co/300x300?text=" + encodeURIComponent(p.name)}" alt="${p.name}" />
      ${p.isWholesale ? `<span class="wholesale-badge">🏷️ Giá sỉ dành cho bạn</span>` : ""}
      <h3>${p.name}</h3>
      <div class="desc">${p.description || ""}</div>
      <div class="price">${Number(p.price).toLocaleString("vi-VN")}đ<span class="price-unit"> / sản phẩm</span></div>
      <div class="stock-row">
        <span class="stock">${p.remaining > 0 ? "Còn " + p.remaining : "Hết hàng"}</span>
        <span class="sold">Đã bán ${p.soldCount}</span>
      </div>
      ${p.remaining > 0 ? `
        <div class="qty-row">
          <label class="qty-label">Số lượng</label>
          <div class="qty-control">
            <button type="button" class="qty-btn" data-qty-dec="${p.id}">−</button>
            <input type="number" class="qty-input" id="qty-${p.id}" value="1" min="1" max="${p.remaining}" />
            <button type="button" class="qty-btn" data-qty-inc="${p.id}">+</button>
          </div>
        </div>
        <button class="btn btn-primary full" data-buy="${p.id}" data-price="${p.price}">Mua ngay</button>
      ` : `
        <button class="btn btn-primary full" disabled>Hết hàng</button>
      `}
    </div>
  `).join("");

  document.querySelectorAll("[data-qty-inc]").forEach(btn => {
    btn.addEventListener("click", () => {
      const input = document.getElementById("qty-" + btn.dataset.qtyInc);
      const max = Number(input.max) || 999;
      input.value = Math.min(max, (Number(input.value) || 1) + 1);
    });
  });
  document.querySelectorAll("[data-qty-dec]").forEach(btn => {
    btn.addEventListener("click", () => {
      const input = document.getElementById("qty-" + btn.dataset.qtyDec);
      input.value = Math.max(1, (Number(input.value) || 1) - 1);
    });
  });

  document.querySelectorAll("[data-buy]").forEach(btn => {
    btn.addEventListener("click", () => {
      const productId = Number(btn.dataset.buy);
      const qtyInput = document.getElementById("qty-" + productId);
      const qty = qtyInput ? Math.max(1, Number(qtyInput.value) || 1) : 1;
      buyProduct(productId, Number(btn.dataset.price), qty);
    });
  });
}

async function buyProduct(productId, unitPrice, quantity) {
  if (!token) { openModal("authModal"); return; }
  try {
    const data = await api("/api/purchase", { method: "POST", body: JSON.stringify({ productId, quantity }) });
    me.balance -= data.order.price;
    updateHeader();
    loadProducts();
    showSuccessModal({
      title: quantity > 1 ? `🎉 Mua ${quantity} sản phẩm thành công!` : "🎉 Mua hàng thành công!",
      subtitle: "Cảm ơn bạn đã ủng hộ shop.",
      deliveredItems: data.order.deliveredItems
    });
  } catch (err) {
    if (err.message.includes("Số dư không đủ")) {
      toast("Số dư không đủ, vui lòng nạp tiền để mua ngay sản phẩm này");
      openDepositForProduct(productId, unitPrice * quantity, quantity);
    } else {
      toast("❌ " + err.message);
    }
  }
}

// ---------- Nạp tiền ----------
let currentForProductId = null;
let currentForQuantity = 1;

els.btnDeposit.addEventListener("click", () => {
  currentForProductId = null;
  currentForQuantity = 1;
  resetDepositModal();
  openModal("depositModal");
});

function openDepositForProduct(productId, totalAmount, quantity) {
  currentForProductId = productId;
  currentForQuantity = quantity;
  resetDepositModal();
  $("#depositAmount").value = totalAmount;
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
      body: JSON.stringify({ amount, forProductId: currentForProductId, forQuantity: currentForQuantity })
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
        if (s.deliveredItems && s.deliveredItems.length) {
          showSuccessModal({
            title: s.deliveredItems.length > 1 ? `🎉 Nạp tiền & mua ${s.deliveredItems.length} sản phẩm thành công!` : "🎉 Nạp tiền & mua hàng thành công!",
            subtitle: "Hệ thống đã tự động giao sản phẩm cho bạn.",
            deliveredItems: s.deliveredItems
          });
        } else {
          showSuccessModal({
            title: "✅ Nạp tiền thành công!",
            subtitle: "Số dư của bạn đã được cập nhật, sẵn sàng mua sắm.",
            deliveredItems: null
          });
        }
      }
    } catch (e) { /* bỏ qua lỗi tạm thời khi poll */ }
  }, 3000);
}

// ---------- Init ----------
(async function init() {
  renderTestimonials();
  await refreshMe();
  await loadProducts();
  await loadPublicStats();
  await loadPublicActivity();
  setInterval(loadPublicActivity, 15000); // làm mới hoạt động gần đây mỗi 15s cho cảm giác "LIVE"
})();
