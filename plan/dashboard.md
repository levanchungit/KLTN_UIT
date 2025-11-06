# Kế hoạch triển khai Dashboard

## 1. Mục tiêu

- Hiển thị tổng quan tài sản (tiền mặt, ví mới)
- Hiển thị thay đổi ròng, chi phí, thu nhập
- Biểu đồ phân loại chi phí (dạng donut chart)
- Danh sách các nhóm chi tiêu (Thức ăn & Đồ uống, Du lịch, Mua sắm, Chưa phân loại)
- Shortcut các chức năng: Thêm giao dịch, milestone, phân tích thêm
- Điều hướng nhanh các module: Trang chủ, Giao dịch, Công cụ tiền, Cài đặt

## 2. Thành phần giao diện

### 2.1. Header & Shortcut

- Chào mừng người dùng (avatar, tên, lời chào)
- Nút "Những cột mốc" (milestone)
- Nút "Phân tích thêm"

### 2.2. Tổng quan tài sản

- Hiển thị số dư tiền mặt
- Nút thêm ví mới
- Chọn khoảng thời gian (tuần/tháng)

### 2.3. Thay đổi ròng

- Card hiển thị thay đổi ròng
- Hiển thị chi phí, thu nhập, so sánh tăng/giảm

### 2.4. Biểu đồ phân loại chi phí

- Biểu đồ donut thể hiện tỷ lệ các nhóm chi tiêu
- Icon đại diện cho từng nhóm
- Hiển thị chi tiết từng nhóm: tên, số tiền, phần trăm

### 2.5. Danh sách nhóm chi tiêu

- Thức ăn & Đồ uống
- Du lịch
- Mua sắm
- Chưa phân loại
- Progress bar cho từng nhóm

### 2.6. Điều hướng nhanh

- Thanh điều hướng dưới cùng: Trang chủ, Giao dịch, Công cụ tiền, Cài đặt
- Nút thêm giao dịch nhanh (floating button)

## 3. Luồng dữ liệu & logic

- Lấy dữ liệu tài sản, giao dịch, nhóm chi tiêu từ API/context
- Tính toán thay đổi ròng, tổng chi phí, tổng thu nhập
- Phân loại giao dịch theo nhóm
- Cập nhật realtime khi có giao dịch mới
- Xử lý chọn khoảng thời gian (filter tuần/tháng)

## 4. Thứ tự triển khai

1. Thiết kế UI tổng quan (Header, shortcut, tổng quan tài sản, card thay đổi ròng)
2. Tích hợp dữ liệu tài sản, giao dịch, nhóm chi tiêu
3. Xây dựng biểu đồ donut và danh sách nhóm chi tiêu
4. Tạo các shortcut chức năng và điều hướng nhanh
5. Kiểm thử UI/UX, tối ưu hiệu năng
6. Hoàn thiện responsive cho mobile

## 5. Phân công & tiến độ

- Thiết kế UI: 1 ngày
- Tích hợp dữ liệu: 2 ngày
- Xây dựng biểu đồ & logic: 2 ngày
- Kiểm thử & hoàn thiện: 1 ngày

## 6. Ghi chú

- Ưu tiên hiệu năng và trải nghiệm người dùng
- Dễ mở rộng cho các module khác
- Tham khảo UI thực tế từ ảnh dashboard

---

**Người thực hiện:**

- Chủ nhiệm: [Tên bạn]
- Thành viên: [Danh sách]

**Ngày bắt đầu:** [dd/mm/yyyy]  
**Ngày dự kiến hoàn thành:** [dd/mm/yyyy]
