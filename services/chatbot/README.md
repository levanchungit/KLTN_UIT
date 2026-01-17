# services/chatbot

Thư mục chứa toàn bộ logic liên quan tới module phân loại danh mục (chatbot) — mục tiêu:

- `transactionClassifier.ts`: mô hình Embedding → LSTM → Dense, API `predict()` và `learnFromCorrection()`.
- `tokenizer.ts`: tokenizer, map token → id, textToSequence, lưu/khôi phục wordIndex.
- `adaptiveLearner.ts`: debounce/batching của việc fine-tune khi có sửa của người dùng (ml_training_samples).
- `modelPersistence.ts`: save/load model và metadata (versioning/checksum).
- `preprocessor.ts`: chuẩn hoá text, trích amount, adapter gọi `phobertAmountExtractor` khi cần.

Hướng dẫn:
- Mỗi file hiện là scaffold để triển khai dần; giữ API rõ ràng, không chặn UI, giải phóng tensors sau khi dùng.

Quickstart (dev)
1. Cài dependencies: đảm bảo `@tensorflow/tfjs` và `@tensorflow/tfjs-react-native` đã được cài trong project.
2. Khởi tạo tfjs runtime khi app start (nếu cần) theo hướng dẫn `tfjs-react-native`.
3. Mở màn hình `app/chatbot.tsx` trong app để test UI.
4. Chạy unit tests nhỏ:
   - Node script: `node services/chatbot/__tests__/tokenizer.test.ts`
   - Node script: `node services/chatbot/__tests__/transactionClassifier.test.ts`

APIs chính
- `transactionClassifier.initialize()` — lazy init tokenizer / model metadata.
- `transactionClassifier.predict(note, amount?)` — trả `PredictionResult | null` (non-blocking).
- `transactionClassifier.learnFromCorrection(note, categoryId)` — fine-tune nhỏ theo sample sửa.
- `adaptiveLearner.enqueue({text, categoryId})` — enqueue correction để debounce/batch.
- `modelPersistence.saveModel(model)` / `loadModel()` — helpers lưu/khôi phục model (tfjs).

Debug tips
- Sử dụng `services/chatbot/monitoring.ts` để ghi latency/accuracy lên `AsyncStorage`.
- Nếu gặp lỗi khi load/save model, kiểm tra quyền filesystem và đường dẫn `FileSystem.documentDirectory`.
- Để tắt module nhanh khi đang phát triển: dùng `services/chatbot/featureFlag.ts`.

Next steps (recommended)
- Hoàn thiện mapping `labelIndex <-> categoryId`.
- Thêm representative dataset để quantize model chính xác.
- Viết e2e script tự động chạy trên device farm (Firebase Test Lab).


