# Quantization & Pruning Plan (services/chatbot)

Mục tiêu: giảm kích thước model và yêu cầu bộ nhớ trên thiết bị bằng post-training quantization và pruning thận trọng.

Các bước:
1. Export model từ tfjs sang TF SavedModel (nếu huấn luyện trên server) hoặc fromLayersModel -> save to files (đã có `modelPersistence`).
2. Dùng TensorFlow Model Optimization Toolkit (Python) để thực hiện pruning trên SavedModel:
   - Thử pruning sparsity nhẹ (30%) trong quá trình huấn luyện lại nhỏ.
   - Kiểm tra accuracy, nếu chấp nhận được thì tiếp tục.
3. Thực hiện post-training quantization (8-bit):
   - dùng `tflite_convert` để tạo tflite quantized model.
   - hoặc dùng TF Lite converter với representative dataset nhỏ (important for int8).
4. Nếu muốn vẫn dùng tfjs trên-device:
   - convert tflite -> tfjs (khó khăn); thay vào đó có thể dùng tflite runtime trên RN hoặc implement hybrid inference (tflite for inference).
5. Thử nghiệm trên thiết bị thực, đo latency và memory.

Ghi chú:
- Không tự động chạy quantize/prune trong app runtime. Đây là pipeline cho dev/CI.
- Lưu các phiên bản model với `modelPersistence` metadata (version, hash) để rollback.

