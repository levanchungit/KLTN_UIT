# E2E trên thiết bị (hướng dẫn)

Các bước thủ công để kiểm tra latency và fine-tune trên thiết bị thật:

1. Cài app lên thiết bị (Expo Go hoặc build dev client).
2. Mở màn hình `chatbot` từ navigation hoặc deep-link: `kltnuit://chatbot`.
3. Ghi lại thời gian từ lúc nhấn gửi tới lúc hiện đề xuất (sử dụng logcat / console hoặc `services/chatbot/monitoring.ts`).
4. Sau khi nhận đề xuất, bấm vào đề xuất để chấp nhận — xác nhận rằng `ml_training_samples` được ghi và `transactionClassifier.learnFromCorrection()` thực thi (quan sát console).
5. Lặp vài lần với các sample thực tế, thu thập latency và accuracy logs từ `AsyncStorage` keys (`chatbot_metrics_v1:latency`, `chatbot_metrics_v1:accuracy`).
6. Nếu latency quá cao (>300ms cho predict), giảm `maxSequenceLength` hoặc embeddingDim; nếu fine-tune quá nặng (>1s), giảm epochs/batch size.

Ghi chú:
- E2E cần thiết lập profiling thực tế; không tự động hóa trong repo này.

