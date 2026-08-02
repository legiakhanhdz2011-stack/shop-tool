const token = localStorage.getItem("gk_token");
const $ = (sel) => document.querySelector(sel);

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Lỗi không xác định");
  return data;
}

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

async function init() {
  if (!token) { $("#notAdmin").classList.remove("hidden"); return; }
  try {
    const me = await api("/api/auth/me");
    if (me.role !== "admin") { $("#notAdmin").classList.remove("hidden"); return; }
  } catch (e) {
    $("#notAdmin").classList.remove("hidden"); return;
  }
  $("#adminContent").classList.remove("hidden");
  await loadProducts();
  await loadDeposits();
  await loadUsers();
}

async function loadUsers() {
  const list = await api("/api/admin/users");
  const roleLabel = { admin: "Admin", seller: "Người bán", user: "Khách" };
  $("#userTableBody").innerHTML = list.map(u => `
    <tr>
      <td>${u.id}</td>
      <td>${u.username}</td>
      <td>${u.phone || "-"}</td>
      <td><span class="badge ${u.role === "seller" ? "completed" : "pending"}">${roleLabel[u.role] || u.role}</span></td>
      <td>
        ${u.role !== "admin" ? (
          u.role === "seller"
            ? `<button class="btn btn-ghost small-btn" data-revoke="${u.id}">Thu quyền</button>`
            : `<button class="btn btn-primary small-btn" data-grant="${u.id}">Cấp quyền bán</button>`
        ) : `<span style="color:var(--muted); font-size:0.8rem;">—</span>`}
      </td>
    </tr>
  `).join("") || `<tr><td colspan="5" style="color:var(--muted)">Chưa có người dùng nào</td></tr>`;

  document.querySelectorAll("[data-grant]").forEach(btn => {
    btn.addEventListener("click", async () => {
      await api(`/api/admin/users/${btn.dataset.grant}/role`, { method: "POST", body: JSON.stringify({ role: "seller" }) });
      toast("Đã cấp quyền người bán");
      loadUsers();
    });
  });
  document.querySelectorAll("[data-revoke]").forEach(btn => {
    btn.addEventListener("click", async () => {
      await api(`/api/admin/users/${btn.dataset.revoke}/role`, { method: "POST", body: JSON.stringify({ role: "user" }) });
      toast("Đã thu quyền người bán");
      loadUsers();
    });
  });
}

async function loadProducts() {
  const list = await api("/api/admin/products");
  $("#productTableBody").innerHTML = list.map(p => `
    <tr>
      <td>${p.id}</td>
      <td>${p.name}</td>
      <td>${Number(p.price).toLocaleString("vi-VN")}đ</td>
      <td>${(p.stock || []).length}</td>
      <td>
        <button class="btn btn-ghost small-btn" data-edit="${p.id}">Sửa</button>
        <button class="btn btn-ghost small-btn" data-del="${p.id}">Xoá</button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="5" style="color:var(--muted)">Chưa có sản phẩm nào</td></tr>`;

  const productsCache = list;
  document.querySelectorAll("[data-edit]").forEach(btn => {
    btn.addEventListener("click", () => {
      const p = productsCache.find(x => x.id === Number(btn.dataset.edit));
      $("#editId").value = p.id;
      $("#pName").value = p.name;
      $("#pPrice").value = p.price;
      $("#pImage").value = p.imageUrl || "";
      $("#pDesc").value = p.description || "";
      $("#pStock").value = (p.stock || []).join("\n");
      $("#btnCancelEdit").classList.remove("hidden");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
  document.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Xoá sản phẩm này?")) return;
      await api(`/api/admin/products/${btn.dataset.del}`, { method: "DELETE" });
      toast("Đã xoá sản phẩm");
      loadProducts();
    });
  });
}

$("#pStockFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $("#pStockFileName").textContent = file.name;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const content = ev.target.result;
    const existing = $("#pStock").value;
    const lines = content.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    $("#pStock").value = existing ? existing + "\n" + lines.join("\n") : lines.join("\n");
    toast(`Đã thêm ${lines.length} dòng từ file vào kho hàng`);
    e.target.value = ""; // reset để chọn lại cùng file nếu cần
  };
  reader.onerror = () => toast("❌ Không đọc được file, thử lại file .txt khác");
  reader.readAsText(file, "utf-8");
});

$("#btnCancelEdit").addEventListener("click", () => {
  $("#productForm").reset();
  $("#editId").value = "";
  $("#btnCancelEdit").classList.add("hidden");
});

$("#productForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    name: $("#pName").value.trim(),
    price: Number($("#pPrice").value),
    imageUrl: $("#pImage").value.trim(),
    description: $("#pDesc").value.trim(),
    stockText: $("#pStock").value
  };
  const editId = $("#editId").value;
  try {
    if (editId) {
      await api(`/api/admin/products/${editId}`, { method: "PUT", body: JSON.stringify(payload) });
      toast("Đã cập nhật sản phẩm");
    } else {
      await api("/api/admin/products", { method: "POST", body: JSON.stringify(payload) });
      toast("Đã thêm sản phẩm mới");
    }
    $("#productForm").reset();
    $("#editId").value = "";
    $("#btnCancelEdit").classList.add("hidden");
    loadProducts();
  } catch (err) {
    toast("❌ " + err.message);
  }
});

async function loadDeposits() {
  const list = await api("/api/admin/deposits");
  $("#depositTableBody").innerHTML = list.map(d => `
    <tr>
      <td>${d.code}</td>
      <td>${d.userId}</td>
      <td>${Number(d.amount).toLocaleString("vi-VN")}đ</td>
      <td><span class="badge ${d.status}">${d.status === "completed" ? "Đã cộng tiền" : "Đang chờ"}</span></td>
      <td>${d.status === "pending" ? `<button class="btn btn-primary small-btn" data-confirm="${d.id}">Xác nhận</button>` : ""}</td>
    </tr>
  `).join("") || `<tr><td colspan="5" style="color:var(--muted)">Chưa có giao dịch nào</td></tr>`;

  document.querySelectorAll("[data-confirm]").forEach(btn => {
    btn.addEventListener("click", async () => {
      await api(`/api/admin/deposits/${btn.dataset.confirm}/confirm`, { method: "POST" });
      toast("Đã xác nhận cộng tiền cho khách");
      loadDeposits();
    });
  });
}

init();
