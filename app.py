from fastapi import FastAPI, Request, Form, Response
from fastapi.responses import HTMLResponse, RedirectResponse, FileResponse
from fastapi.templating import Jinja2Templates
import random
import os

app = FastAPI()
templates = Jinja2Templates(directory="templates")

# Cơ sở dữ liệu tạm thời (Lưu trên RAM)
USERS = {}  # Lưu tài khoản, vd: {"admin": "123456"}
ORDERS = {} # Lưu đơn hàng

@app.get("/")
def home(request: Request):
    # Kiểm tra xem user có đang đăng nhập không (qua cookie)
    username = request.cookies.get("session_user")
    return templates.TemplateResponse("index.html", {"request": request, "username": username})

@app.post("/register")
def register(username: str = Form(...), password: str = Form(...)):
    if username in USERS:
        return HTMLResponse("<h2 style='color:white;text-align:center;margin-top:50px;'>Tài khoản đã tồn tại! <a href='/' style='color:#00ffcc;'>Quay lại</a></h2>")
    
    USERS[username] = password
    # Đăng ký xong cho đăng nhập luôn
    response = RedirectResponse(url="/", status_code=303)
    response.set_cookie(key="session_user", value=username)
    return response

@app.post("/login")
def login(username: str = Form(...), password: str = Form(...)):
    if USERS.get(username) == password:
        response = RedirectResponse(url="/", status_code=303)
        response.set_cookie(key="session_user", value=username)
        return response
    return HTMLResponse("<h2 style='color:white;text-align:center;margin-top:50px;'>Sai tài khoản hoặc mật khẩu! <a href='/' style='color:#00ffcc;'>Quay lại</a></h2>")

@app.get("/logout")
def logout():
    response = RedirectResponse(url="/", status_code=303)
    response.delete_cookie("session_user")
    return response

@app.post("/create-order")
def create_order(request: Request):
    order_id = f"DH{random.randint(1000, 9999)}"
    # Giả sử file bạn bán tên là app_setup.dlack, giá 2000đ
    ORDERS[order_id] = {"status": "pending", "amount": 2000, "file": "app_setup.dlack"}
    return {"order_id": order_id}

@app.get("/api/check-status/{order_id}")
def check_status(order_id: str):
    order = ORDERS.get(order_id)
    if order and order["status"] == "success":
        return {"status": "success", "file_url": f"/download/{order_id}"}
    return {"status": "pending"}

@app.get("/download/{order_id}")
def download_file(order_id: str):
    order = ORDERS.get(order_id)
    if order and order["status"] == "success":
        file_path = f"protected_files/{order['file']}"
        if os.path.exists(file_path):
            return FileResponse(file_path, filename=order['file'])
    return HTMLResponse("File không tồn tại hoặc bạn chưa thanh toán!")

@app.post("/sepay-webhook")
async def sepay_webhook(request: Request):
    data = await request.json()
    transfer_content = data.get("content", "").upper()
    transfer_amount = int(data.get("transferAmount", 0))

    for order_id, order_info in ORDERS.items():
        if order_id in transfer_content and transfer_amount >= order_info["amount"]:
            order_info["status"] = "success"
            print(f"✅ Đơn {order_id} đã thanh toán thành công!")
            return {"message": "Thành công"}
    
    return {"message": "Không tìm thấy đơn hàng"}
