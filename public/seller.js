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
  if (!token) { $("#notAllowed").classList.remove("hidden"); return; }
  try {
    const me = await api("/api/auth/me");
    if (me.role !== "seller" && me.role !== "admin") {
      $("#notAllowed").classList.remove("hidden");
      return;
    }
  } catch (e) {
    $("#notAllowed").classList.remove("hidden"); return;
  }
  $("#sellerContent").classList.remove("hidden");
  await loadProducts();
}

async function loadProducts() {
  const list = await api("/api/seller/products");
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
  `).join("") || `<tr><td colspan="5" style="color:var(--muted)">Bạn chưa có sản phẩm nào</td></tr>`;

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
      await api(`/api/seller/products/${btn.dataset.del}`, { method: "DELETE" });
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
    e.target.value = "";
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
      await api(`/api/seller/products/${editId}`, { method: "PUT", body: JSON.stringify(payload) });
      toast("Đã cập nhật sản phẩm");
    } else {
      await api("/api/seller/products", { method: "POST", body: JSON.stringify(payload) });
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

init();
