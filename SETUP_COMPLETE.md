# ✅ Setup Hoàn Tất - Voice & Image cho Chatbox

## 🎉 Đã hoàn thành

✅ Import `expo-image-picker` và `expo-av`  
✅ Uncomment tất cả code cho Voice và Image  
✅ Thêm permissions vào `app.json`  
✅ Cấu hình API keys (GOOGLE_VISION_API_KEY)

---

## 🚀 Bước tiếp theo: RUN APP

### 1️⃣ **Prebuild lại app** (để apply permissions)

```bash
npx expo prebuild --clean
```

Hoặc nếu chạy development:

```bash
npx expo run:android
# hoặc
npx expo run:ios
```

### 2️⃣ **Hoặc sử dụng Expo Go** (đơn giản hơn)

```bash
npx expo start
```

Sau đó scan QR code bằng Expo Go app.

**⚠️ LƯU Ý:**

- Với Expo Go, một số native features có thể không hoạt động đầy đủ
- Khuyến nghị build development client: `npx expo run:android`

---

## 🧪 Test chức năng

### Test Voice (🎤)

1. Mở chatbox
2. Nhấn nút **microphone** (icon 🎤)
3. Cho phép quyền microphone khi được hỏi
4. Nói: **"Trà sữa 60 nghìn"**
5. Nhấn lại nút microphone để dừng
6. Xem kết quả:
   - ✅ Text được transcribe
   - ✅ Tự động phân loại danh mục
   - ✅ Tạo giao dịch

### Test Image OCR (📷)

1. Mở chatbox
2. Nhấn nút **image** (icon 📷)
3. Cho phép quyền thư viện ảnh khi được hỏi
4. Chọn ảnh hóa đơn (có chữ rõ ràng)
5. Xem kết quả:
   - ✅ OCR đọc text từ ảnh
   - ✅ Extract số tiền và tên cửa hàng
   - ✅ Tạo giao dịch tự động

---

## ⚙️ Cấu hình API (quan trọng!)

### Google Cloud APIs cần enable:

#### 1. Cloud Vision API (cho OCR)

```
https://console.cloud.google.com/apis/library/vision.googleapis.com
```

#### 2. Speech-to-Text API (cho Voice)

```
https://console.cloud.google.com/apis/library/speech.googleapis.com
```

### Thêm API Keys vào `.env`:

```env
GOOGLE_VISION_API_KEY=AIzaSy...your_key_here
GOOGLE_SPEECH_API_KEY=AIzaSy...your_key_here
```

Hoặc trong code (không khuyến nghị cho production):

```typescript
// app/chatbox.tsx
const VISION_API_KEY = "AIzaSy...your_key_here";
const SPEECH_API_KEY = "AIzaSy...your_key_here";
```

---

## 🔍 Troubleshooting

### Lỗi: "Cannot find module expo-image-picker"

**Giải pháp:**

```bash
npm install expo-image-picker expo-av
# hoặc
npx expo install expo-image-picker expo-av
```

### Lỗi: Permissions denied

**Giải pháp:**

1. Gỡ app và cài lại
2. Vào Settings → Apps → KLTN_UIT → Permissions
3. Cho phép Camera và Microphone

### Lỗi: "API key not valid"

**Giải pháp:**

1. Kiểm tra API key đã đúng chưa
2. Enable APIs trong Google Cloud Console
3. Đảm bảo billing account đã được setup
4. Kiểm tra API restrictions (nếu có)

### Voice không transcribe được

**Nguyên nhân:**

- Không có internet
- API key không đúng
- Chưa enable Speech-to-Text API
- File audio format không đúng

**Giải pháp:**

1. Kiểm tra internet connection
2. Verify API key
3. Check logs: `npx expo start` → xem console errors

### OCR không đọc được text

**Nguyên nhân:**

- Ảnh không rõ
- Format ảnh không hỗ trợ
- API quota exceeded

**Giải pháp:**

1. Sử dụng ảnh rõ nét, độ phân giải cao
2. Đảm bảo text trong ảnh đủ lớn
3. Kiểm tra Google Cloud quota

---

## 📊 Hiệu suất & Chi phí

### Google Cloud Vision API

- **Miễn phí:** 1,000 requests/tháng
- **Sau đó:** $1.50 / 1,000 images

### Google Speech-to-Text API

- **Miễn phí:** 60 phút/tháng
- **Sau đó:** $0.006 / 15 giây

**💡 Tip:** Để tiết kiệm, có thể:

- Sử dụng Firebase ML Kit (miễn phí hơn)
- Implement caching cho kết quả đã xử lý
- Giới hạn số lượng request/user

---

## 🎨 UI Components đã thêm

### Input Bar (bottom)

```
[🎤] [📷] [____________Text Input____________] [Send]
```

- **🎤 Microphone:** Ghi âm giọng nói (đỏ khi recording)
- **📷 Image:** Chọn ảnh hóa đơn
- **Text Input:** Nhập text thủ công (như cũ)
- **Send:** Gửi text

### Processing States

- "🎤 Đang xử lý giọng nói..."
- "📷 Đang phân tích hóa đơn..."
- "⚙️ Đang phân loại danh mục..."

---

## 📱 Permissions Required

### Android (AndroidManifest.xml - auto generated)

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO"/>
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE"/>
<uses-permission android:name="android.permission.CAMERA"/>
```

### iOS (Info.plist - auto generated)

```xml
<key>NSMicrophoneUsageDescription</key>
<string>Ứng dụng cần quyền ghi âm để nhận diện giọng nói</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>Ứng dụng cần quyền truy cập thư viện ảnh để chọn hóa đơn</string>
```

---

## 🔥 Tính năng mới

### Voice Input

✅ Record audio với expo-av  
✅ Speech-to-Text với Google Cloud API  
✅ Hỗ trợ tiếng Việt (vi-VN)  
✅ Auto-classify category bằng ML  
✅ Visual feedback (đỏ khi recording)  
✅ Dark/Light mode support

### Image OCR

✅ Pick image từ thư viện  
✅ OCR với Google Vision API  
✅ Auto-extract số tiền từ hóa đơn  
✅ Detect tên cửa hàng  
✅ Auto-create transaction (chi tiêu)  
✅ Support multiple image formats

---

## 📚 Tài liệu tham khảo

- [Expo Image Picker Docs](https://docs.expo.dev/versions/latest/sdk/imagepicker/)
- [Expo AV Docs](https://docs.expo.dev/versions/latest/sdk/av/)
- [Google Vision API](https://cloud.google.com/vision/docs/ocr)
- [Google Speech-to-Text](https://cloud.google.com/speech-to-text/docs)

---

## ✅ Checklist cuối cùng

- [ ] Đã install packages: `expo-image-picker`, `expo-av`
- [ ] Đã uncomment imports và code
- [ ] Đã thêm permissions vào `app.json`
- [ ] Đã có Google Cloud API keys
- [ ] Đã enable Vision API và Speech-to-Text API
- [ ] Đã prebuild hoặc run development client
- [ ] Đã test Voice input
- [ ] Đã test Image OCR

---

## 🎊 Kết quả mong đợi

User có thể:

1. ✅ Nói vào micro → tự động tạo giao dịch
2. ✅ Chụp/chọn ảnh hóa đơn → tự động tạo giao dịch
3. ✅ Vẫn có thể nhập text thủ công như cũ

Tất cả đều sử dụng **ML classification** để tự động phân loại danh mục!

---

**🚀 Chúc bạn thành công!**
