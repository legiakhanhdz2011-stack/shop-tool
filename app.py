from fastapi import FastAPI, Request, Form, Response
from fastapi.responses import HTMLResponse, RedirectResponse, FileResponse
from fastapi.templating import Jinja2Templates
import os

app = FastAPI()
templates = Jinja2Templates(directory="templates")

# CƠ SỞ DỮ LIỆU TẠM THỜI (Lưu tài khoản, số dư, file đã mua)
# Cấu trúc: {"giakhanh": {"password": "123", "balance": 0, "purchased": []}}
USERS = {}  

# =========================================================
# ⚙️ CẤU HÌNH NGÂN HÀNG CỦA BẠN (ĐỂ TẠO MÃ QR TỰ ĐỘNG)
# =========================================================
BANK_ID = "MB"            # Mã ngân hàng (VD: MB, VCB, ACB, BIDV, TCB, VPB...)
STK = "63498066778899"        # Số tài khoản của bạn
CHUTK = "LE GIA KHANH"    # Tên chủ tài khoản (Viết hoa, KHÔNG DẤU)

# DANH SÁCH SẢN PHẨM (KỆ HÀNG)
PRODUCTS = {
    "tool_1": {"name": "Tool System Mod Premium", "price": 2000, "desc": "Tự động hóa hệ thống VIP", "file": "app_setup.dlack"},
    "tool_2": {"name": "Source Code Bot Telegram", "price": 5000, "desc": "Bot tự động trả lời xịn xò", "file": "bot_tele.zip"},
    "tool_3": {"name": "Phần mềm Auto Click", "price": 10000, "desc": "Click siêu tốc không chiếm chuột", "file": "auto_click.zip"}
}

@app.get("/")
def home(request: Request):
    username = request.cookies.get("session_user")
    user_data = USERS.get(username) if username else None
    
    return templates.TemplateResponse(
        request=request, 
        name="index.html", 
        context={
            "username": username, 
            "user_data": user_data, 
            "products": PRODUCTS,
            "bank_id": BANK_ID,
            "stk": STK,
            "chutk": CHUTK
        }
    )

@app.post("/register")
def register(username: str = Form(...), password: str = Form(...)):
    username = username.strip().lower() # Chuyển thành chữ thường cho dễ nạp tiền
    if username in USERS:
        return HTMLResponse("<h2 style='color:white;text-align:center;margin-top:50px;'>Tài khoản đã tồn tại! <a href='/' style='color:#00ffcc;'>Quay lại</a></h2>")
    
    # Tạo user mới với số dư = 0 và chưa mua gì
    USERS[username] = {"password": password, "balance": 0, "purchased": []}
    response = RedirectResponse(url="/", status_code=303)
    response.set_cookie(key="session_user", value=username)
    return response

@app.post("/login")
def login(username: str = Form(...), password: str = Form(...)):
    username = username.strip().lower()
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

# API: Mua hàng bằng số dư
@app.post("/api/buy/{product_id}")
def buy_product(product_id: str, request: Request):
    username = request.cookies.get("session_user")
    if not username or username not in USERS:
        return {"status": "error", "message": "Vui lòng đăng nhập lại!"}
    
    user = USERS[username]
    product = PRODUCTS.get(product_id)
    
    if not product:
        return {"status": "error", "message": "Sản phẩm không tồn tại!"}
    
    if product_id in user["purchased"]:
        return {"status": "success", "message": "Bạn đã mua sản phẩm này rồi, bắt đầu tải xuống!"}
    
    if user["balance"] < product["price"]:
        return {"status": "error", "message": "Số dư không đủ! Vui lòng nạp thêm tiền."}
    
    # Trừ tiền và thêm vào lịch sử
    user["balance"] -= product["price"]
    user["purchased"].append(product_id)
    return {"status": "success", "message": "Mua thành công! Hệ thống đang tải file."}

# Tải file (Chỉ ai đã mua mới được tải)
@app.get("/download/{product_id}")
def download_file(product_id: str, request: Request):
    username = request.cookies.get("session_user")
    if not username or username not in USERS:
        return HTMLResponse("Vui lòng đăng nhập!")
        
    user = USERS[username]
    if product_id not in user["purchased"]:
        return HTMLResponse("LỖI: Bạn chưa mua sản phẩm này!")
        
    product = PRODUCTS.get(product_id)
    file_path = f"protected_files/{product['file']}"
    if os.path.exists(file_path):
        return FileResponse(file_path, filename=product['file'])
    return HTMLResponse("<h2 style='color:white;text-align:center;'>File đang được cập nhật! Hãy liên hệ Admin.</h2>")

# API Lấy số dư hiện tại (Để giao diện tự động cập nhật)
@app.get("/api/me")
def get_me(request: Request):
    username = request.cookies.get("session_user")
    if username and username in USERS:
        return {"balance": USERS[username]["balance"]}
    return {"balance": 0}

# WEBHOOK NẠP TIỀN TỰ ĐỘNG TỪ SEPAY
@app.post("/sepay-webhook")
async def sepay_webhook(request: Request):
    data = await request.json()
    transfer_content = data.get("content", "").upper() # Nội dung chuyển khoản
    transfer_amount = int(data.get("transferAmount", 0)) # Số tiền

    # Tìm xem user nào đã nạp tiền (Cú pháp: NAP <tentaikhoan>)
    for username, user_info in USERS.items():
        syntax_1 = f"NAP {username}".upper()
        syntax_2 = f"NAP{username}".upper() # Phòng trường hợp khách viết liền
        
        if syntax_1 in transfer_content or syntax_2 in transfer_content:
            user_info["balance"] += transfer_amount
            print(f"✅ Cộng thành công {transfer_amount}đ cho {username}")
            return {"message": "Nạp tiền thành công"}
            
    return {"message": "Không tìm thấy người dùng hợp lệ"}
