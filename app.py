from fastapi import FastAPI, Request, Form, Response
from fastapi.responses import HTMLResponse, RedirectResponse, FileResponse
from fastapi.templating import Jinja2Templates
import json
import os
import random

app = FastAPI()
templates = Jinja2Templates(directory="templates")

# =========================================================
# ⚙️ CẤU HÌNH NGÂN HÀNG CỦA BẠN (ĐỂ TẠO MÃ QR TỰ ĐỘNG)
# =========================================================
BANK_ID = "MB"            # Mã ngân hàng (VD: MB, VCB, ACB, BIDV, TCB...)
STK = "63498066778899"        # Số tài khoản của bạn
CHUTK = "LE GIA KHANH"    # Tên chủ tài khoản (Viết hoa, KHÔNG DẤU)

PRODUCTS = {
    "tool_1": {"name": "Tool System Mod Premium", "price": 2000, "desc": "Tự động hóa hệ thống VIP", "file": "app_setup.dlack"},
    "tool_2": {"name": "Source Code Bot Telegram", "price": 5000, "desc": "Bot tự động trả lời xịn xò", "file": "bot_tele.zip"},
    "tool_3": {"name": "Phần mềm Auto Click", "price": 10000, "desc": "Click siêu tốc không chiếm chuột", "file": "auto_click.zip"}
}

def load_users():
    if os.path.exists("users.json"):
        with open("users.json", "r", encoding="utf-8") as f:
            try: return json.load(f)
            except: return {}
    return {}

def save_users(users):
    with open("users.json", "w", encoding="utf-8") as f:
        json.dump(users, f, ensure_ascii=False, indent=4)

@app.get("/")
def home(request: Request):
    username = request.cookies.get("session_user")
    USERS = load_users()
    
    if username and username not in USERS:
        response = templates.TemplateResponse(request=request, name="index.html", context={"request": request, "username": None})
        response.delete_cookie("session_user")
        return response

    user_data = USERS.get(username) if username else None
    return templates.TemplateResponse(
        request=request, 
        name="index.html", 
        context={
            "request": request, "username": username, "user_data": user_data, 
            "products": PRODUCTS, "bank_id": BANK_ID, "stk": STK, "chutk": CHUTK
        }
    )

@app.post("/register")
def register(username: str = Form(...), password: str = Form(...)):
    username = username.strip().lower()
    USERS = load_users()
    if username in USERS:
        return HTMLResponse("<h2 style='color:white;text-align:center;margin-top:50px;'>Tài khoản đã tồn tại! <a href='/' style='color:#00ffcc;'>Quay lại</a></h2>")
    USERS[username] = {"password": password, "balance": 0, "purchased": []}
    save_users(USERS)
    response = RedirectResponse(url="/", status_code=303)
    response.set_cookie(key="session_user", value=username)
    return response

@app.post("/login")
def login(username: str = Form(...), password: str = Form(...)):
    username = username.strip().lower()
    USERS = load_users()
    user = USERS.get(username)
    if user and user["password"] == password:
        response = RedirectResponse(url="/", status_code=303)
        response.set_cookie(key="session_user", value=username)
        return response
    return HTMLResponse("<h2 style='color:white;text-align:center;margin-top:50px;'>Sai tài khoản hoặc mật khẩu! <a href='/' style='color:#00ffcc;'>Quay lại</a></h2>")

@app.get("/logout")
def logout():
    response = RedirectResponse(url="/", status_code=303)
    response.delete_cookie("session_user")
    return response

@app.post("/api/buy/{product_id}")
def buy_product(product_id: str, request: Request):
    username = request.cookies.get("session_user")
    USERS = load_users()
    if not username or username not in USERS:
        return {"status": "error", "message": "Vui lòng đăng nhập lại!"}
    user = USERS[username]
    product = PRODUCTS.get(product_id)
    if not product: return {"status": "error", "message": "Sản phẩm không tồn tại!"}
    if product_id in user["purchased"]: return {"status": "success", "message": "Bạn đã mua sản phẩm này rồi!"}
    if user["balance"] < product["price"]: return {"status": "error", "message": "Số dư không đủ!"}
    
    user["balance"] -= product["price"]
    user["purchased"].append(product_id)
    save_users(USERS)
    return {"status": "success", "message": "Mua thành công! File đang được tải xuống."}

@app.get("/download/{product_id}")
def download_file(product_id: str, request: Request):
    username = request.cookies.get("session_user")
    USERS = load_users()
    if not username or username not in USERS or product_id not in USERS[username]["purchased"]:
        return HTMLResponse("Không có quyền tải file!")
    product = PRODUCTS.get(product_id)
    file_path = f"protected_files/{product['file']}"
    if os.path.exists(file_path): return FileResponse(file_path, filename=product['file'])
    return HTMLResponse("File không tồn tại trên hệ thống!")

@app.get("/api/me")
def get_me(request: Request):
    username = request.cookies.get("session_user")
    USERS = load_users()
    if username and username in USERS: return {"balance": USERS[username]["balance"]}
    return {"balance": 0}

# 🔥 WEBHOOK ĐÃ ĐƯỢC FIX LỖI TRIỆT ĐỂ, THÔNG MINH HƠN 200%
@app.post("/sepay-webhook")
async def sepay_webhook(request: Request):
    try:
        data = await request.json()
        print(f"📥 [LOG SEPAY] Nhận dữ liệu: {data}")
        
        transfer_content = data.get("content", "").upper()
        transfer_amount = int(data.get("transferAmount", 0))
        
        USERS = load_users()
        updated = False

        for username, user_info in USERS.items():
            # THUẬT TOÁN THÔNG MINH: Chỉ cần chứa chữ NAP và chứa đúng TÊN TÀI KHOẢN là duyệt!
            if "NAP" in transfer_content and username.upper() in transfer_content:
                user_info["balance"] += transfer_amount
                print(f"✅ [LOG SUCCESS] Đã cộng +{transfer_amount}đ cho tài khoản: {username}")
                updated = True
                break
                
        if updated:
            save_users(USERS)
            return {"message": "Nạp tiền thành công"}
            
        print(f"❌ [LOG WARN] Không tìm thấy tài khoản nào khớp với nội dung: '{transfer_content}'")
        return {"message": "Nội dung chuyển khoản không hợp lệ"}
    except Exception as e:
        print(f"💥 [LOG ERROR] Lỗi hệ thống: {str(e)}")
        return {"message": "Lỗi xử lý dữ liệu"}
