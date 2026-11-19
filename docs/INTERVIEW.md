# Phỏng vấn system design

Mục **Luyện → Phỏng vấn** (`/interview`). Mỗi đề là một file `interviews/<id>.json`, dùng chung cho web và server.

## Luồng

1. **Đọc đề**: bối cảnh, yêu cầu (tải, SLO, sự cố phải chịu, ngân sách) và danh sách kịch bản sẽ chấm.
2. **Thiết kế** trên canvas với đồng hồ đếm ngược. Thành phần dùng thông số chuẩn theo loại (như Game), người làm chọn kiến trúc, số instance và chính sách gọi. Có thể chạy thử, nhưng tab Kiểm tra (design lint) bị ẩn để không lộ đáp án.
3. **Nộp bài**: engine chạy design qua từng kịch bản chấm, bộ luật lint xét thiết kế, rồi ra báo cáo: điểm 0–100, bốn phần của rubric, bảng kết quả từng kịch bản, nhận xét, ghi chú thiết kế và các ý một câu trả lời tốt nên có. Có điểm của lời giải tham khảo để so sánh, nút mở bài làm và lời giải trong Studio để dùng So sánh A/B.

Đã đăng nhập thì **server chấm** (`POST /api/interviews/:id/attempts`) và lưu lịch sử. Chưa đăng nhập thì trình duyệt chấm bằng đúng code đó. Lời giải tham khảo qua API chỉ mở sau khi đã nộp bài.

## Chấm điểm

Hàm thuần trong `packages/design-lint` (`interviewLevels`, `hotNodes`, `scoreInterview`), không dùng LLM:

| Phần | Mặc định | Cách tính |
|---|---|---|
| Đạt SLO khi có tải | 40 | Trung bình các kịch bản `normal`/`peak`: đạt SLO và ≥ 98% thời gian đạt thì đủ điểm, còn lại theo tỉ lệ thời gian đạt |
| Chịu được sự cố | 30 | Như trên cho các kịch bản `failure` |
| Chi phí | 15 | Đủ điểm khi trong ngân sách, giảm dần khi vượt |
| Thiết kế sạch | 15 | Trừ theo ghi chú lint: lỗi 0.4, cảnh báo 0.15, gợi ý 0.03 |

Chi phí, độ sạch và khả năng chịu lỗi được nhân với tỉ lệ request phục vụ được, nên design trống hoặc chưa nối dây được 0 điểm. Xếp loại: ≥ 85 rất tốt, ≥ 70 đạt, ≥ 55 cần cải thiện.

## Định dạng đề

```jsonc
{
  "id": "payment", "title": "…", "difficulty": "Trung bình", "timeMinutes": 45,
  "brief": "…", "requirements": ["…"], "talkingPoints": ["…"],
  "level": {                          // luật như một level game (crates/engine/src/level.rs)
    "palette": ["loadBalancer", "service", "database"],
    "locked": ["client", "gateway"],   // node cho sẵn, giữ thông số riêng
    "scalable": ["gateway"],           // node khoá nhưng người làm được đổi số instance
    "design": { "nodes": […], "edges": [] },
    "scenario": { "durationMs": 60000, "traffic": [{ "atMs": 0, "rps": 400 }], "slo": {…}, "budgetPerHour": 2 }
  },
  "grading": [
    { "name": "Bình thường", "kind": "normal" },
    { "name": "Cao điểm ×2", "kind": "peak", "traffic": { "multiplier": 2 } },          // mặc định giây 20–40
    { "name": "Mất 1 instance API", "kind": "failure", "loseInstance": "service" },      // N+1
    { "name": "Cổng lỗi 30%", "kind": "failure", "faults": [{ "nodes": ["gateway"], "action": "errors", "value": 0.3 }] },
    { "name": "DB chậm ×3", "kind": "failure", "faults": [{ "kind": "database", "action": "latency", "value": 3 }] }
  ],
  "rubric": { "slo": 40, "resilience": 30, "cost": 15, "hygiene": 15 },
  "reference": { "nodes": […], "edges": […] }
}
```

Đề có sẵn: rút gọn link (Dễ), trang tin khi có tin nóng, thanh toán qua cổng bên ngoài, upload và xử lý ảnh (Trung bình), trang sản phẩm gọi 3 service (Khó). Lời giải tham khảo của mỗi đề đạt 89–100 điểm, design ban đầu trượt.
