from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import FileResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
import os
import random

app = FastAPI()
templates = Jinja2Templates(directory="templates")

FILE_DIRECTORY = "protected_files"

# Kho hàng của bạn (Có thể thêm bớt tùy ý)
PRODUCTS = {
    "sp1": {"name": "CC NAM", "price": 2000, "file": "app_setup.dlack"},
    "sp2": {"name": "Tool VIP (Bypass Login)", "price": 100000, "file": "tool_vip.zip"},
    "sp3": {"name": "Script Giao Diện Mới", "price": 30000, "file": "script_ui.rar"}
}

# Nơi lưu trữ các đơn hàng đang chờ thanh toán
ORDERS = {}

# Khai báo cấu trúc dữ liệu nhận từ trình duyệt
class OrderRequest(BaseModel):
    order_id: str
    product_id: str

@app.get("/")
async def home(request: Request):
    # Gửi kho hàng ra ngoài giao diện
    return templates.TemplateResponse(request=request, name="index.html", context={"products": PRODUCTS})

# Khách bấm mua -> Hệ thống ghi nhận đơn hàng tạm thời
@app.post("/create-order")
async def create_order(order: OrderRequest):
    if order.product_id not in PRODUCTS:
        raise HTTPException(status_code=404, detail="Sản phẩm không tồn tại")
    
    product = PRODUCTS[order.product_id]
    ORDERS[order.order_id] = {
        "status": "pending",
        "file_name": product["file"],
        "amount": product["price"]
    }
    return {"success": True}

# Lắng nghe tiền về từ SePay (Tự động quét mã đơn)
@app.post("/sepay-webhook")
async def sepay_webhook(request: Request):
    try:
        data = await request.json()
        transfer_content = data.get("content", "").upper()
        transfer_amount = int(data.get("transferAmount", 0))
        
        print(f"💰 TING TING: Nhận {transfer_amount}đ - Nội dung: {transfer_content}")

        for order_id, order_info in ORDERS.items():
            if order_id in transfer_content and transfer_amount >= order_info["amount"]:
                order_info["status"] = "paid"
                print(f"✅ Đơn {order_id} đã thanh toán thành công!")
                return {"success": True}
                
        return {"success": False, "message": "Không khớp đơn hàng"}
    except Exception as e:
        return {"success": False, "error": str(e)}

# API MỚI: Trình duyệt sẽ gọi ngầm liên tục vào đây để check xem trạng thái đã 'paid' chưa
@app.get("/api/check-status/{order_id}")
async def check_status(order_id: str):
    if order_id in ORDERS:
        return {"status": ORDERS[order_id]["status"]}
    return {"status": "not_found"}

# Tải file (Chỉ khi trạng thái là 'paid')
@app.get("/download/{order_id}")
async def download_file(order_id: str):
    if order_id not in ORDERS:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn hàng.")
    
    if ORDERS[order_id]["status"] != "paid":
        raise HTTPException(status_code=403, detail="Đơn hàng chưa được thanh toán!")
        
    file_path = os.path.join(FILE_DIRECTORY, ORDERS[order_id]["file_name"])
    
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File hệ thống đang bảo trì.")
        
    return FileResponse(path=file_path, filename=ORDERS[order_id]["file_name"])
