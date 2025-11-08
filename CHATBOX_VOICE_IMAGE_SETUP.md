# Hướng dẫn cài đặt Voice & Image cho Chatbox

## 📦 Cài đặt packages

```bash
npx expo install expo-image-picker expo-av
```

## 🔧 Cấu hình API Keys

### 1. Google Cloud Vision API (cho OCR ảnh hóa đơn)

1. Truy cập [Google Cloud Console](https://console.cloud.google.com/)
2. Tạo project mới hoặc chọn project hiện có
3. Enable **Cloud Vision API**
4. Tạo API Key trong phần **Credentials**
5. Thêm vào file `.env`:
   ```
   GOOGLE_VISION_API_KEY=your_api_key_here
   ```

### 2. Google Speech-to-Text API (cho Voice Recognition)

1. Trong cùng project Google Cloud
2. Enable **Cloud Speech-to-Text API**
3. Sử dụng cùng API Key hoặc tạo riêng
4. Thêm vào file `.env`:
   ```
   GOOGLE_SPEECH_API_KEY=your_api_key_here
   ```

## 📝 Uncomment Code

Sau khi cài packages, uncomment các đoạn code trong `app/chatbox.tsx`:

### 1. Import statements (dòng ~31-32)

```typescript
import * as ImagePicker from "expo-image-picker";
import { Audio } from "expo-av";
```

### 2. Voice Recording Logic (trong `handleVoicePress`)

```typescript
// Start recording section (~line 918)
await Audio.requestPermissionsAsync();
await Audio.setAudioModeAsync({
  allowsRecordingIOS: true,
  playsInSilentModeIOS: true,
});
const { recording: newRecording } = await Audio.Recording.createAsync(
  Audio.RecordingOptionsPresets.HIGH_QUALITY
);
setRecording(newRecording);

// Stop recording section (~line 884)
await recording.stopAndUnloadAsync();
const uri = recording.getURI();
```

### 3. Image Picker Logic (trong `handleImagePress`)

```typescript
// Request permission (~line 935)
const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
if (status !== "granted") {
  Alert.alert("Quyền truy cập", "Cần quyền truy cập thư viện ảnh");
  return;
}

// Launch picker (~line 941)
const result = await ImagePicker.launchImageLibraryAsync({
  mediaTypes: ImagePicker.MediaTypeOptions.Images,
  allowsEditing: true,
  quality: 1,
});

if (result.canceled) return;
const imageUri = result.assets[0].uri;
```

## 🎯 Cấu hình Permissions (app.json)

Thêm vào `app.json`:

```json
{
  "expo": {
    "plugins": [
      [
        "expo-image-picker",
        {
          "photosPermission": "Ứng dụng cần quyền truy cập thư viện ảnh để chọn hóa đơn"
        }
      ],
      [
        "expo-av",
        {
          "microphonePermission": "Ứng dụng cần quyền ghi âm để nhận diện giọng nói"
        }
      ]
    ]
  }
}
```

## 🧪 Testing

### Test Voice Input

1. Nhấn nút microphone (🎤)
2. Nói: "Trà sữa 60 nghìn"
3. Nhấn lại để dừng
4. Hệ thống sẽ:
   - Chuyển giọng nói thành text
   - Phân loại danh mục tự động
   - Tạo giao dịch

### Test Image Receipt

1. Nhấn nút image (📷)
2. Chọn ảnh hóa đơn
3. Hệ thống sẽ:
   - OCR trích xuất text từ ảnh
   - Tìm số tiền và tên cửa hàng
   - Phân loại danh mục
   - Tạo giao dịch chi tiêu

## 🔍 Debugging

### Nếu Voice không hoạt động

- Kiểm tra quyền microphone trong Settings
- Xem logs: `console.log` trong `handleVoicePress`
- Kiểm tra API key Speech-to-Text
- Đảm bảo internet connection

### Nếu Image OCR không hoạt động

- Kiểm tra quyền thư viện ảnh
- Xem logs trong `handleImagePress`
- Kiểm tra API key Vision API
- Thử với ảnh rõ nét hơn

## 💡 Tính năng

### Voice Input

- ✅ Ghi âm giọng nói
- ✅ Chuyển đổi speech-to-text (Vietnamese)
- ✅ Tự động phân loại danh mục
- ✅ Hỗ trợ dark/light mode
- ✅ Hiển thị trạng thái recording

### Image Receipt

- ✅ Chọn ảnh từ thư viện
- ✅ OCR trích xuất thông tin
- ✅ Tự động detect số tiền
- ✅ Nhận diện tên cửa hàng
- ✅ Tạo giao dịch chi tiêu tự động

## 📚 Dependencies

```json
{
  "expo-image-picker": "~15.0.0",
  "expo-av": "~14.0.0"
}
```

## 🎨 UI Components

- **Microphone Button**: Nút ghi âm (đỏ khi đang recording)
- **Image Button**: Nút chọn ảnh
- **Processing Indicators**: Hiển thị "🎤 Đang xử lý giọng nói..." / "📷 Đang phân tích hóa đơn..."

## 🔐 Security Notes

- Không commit API keys vào git
- Sử dụng `.env` file và thêm vào `.gitignore`
- Hạn chế quota API để tránh phí cao
- Xem xét sử dụng Firebase ML Kit (miễn phí) thay vì Google Cloud APIs

## 📖 Tài liệu tham khảo

- [Expo Image Picker](https://docs.expo.dev/versions/latest/sdk/imagepicker/)
- [Expo AV](https://docs.expo.dev/versions/latest/sdk/av/)
- [Google Cloud Vision API](https://cloud.google.com/vision/docs)
- [Google Speech-to-Text API](https://cloud.google.com/speech-to-text/docs)
