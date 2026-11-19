# Billiard Coach — Thiết kế

Ngày: 2026-11-19

## 1. Mục đích

Một trang web giúp người chơi pool 9 bi và 10 bi giải hình. Người dùng đứng cạnh bàn thật, cầm điện thoại, dựng lại thế bi vừa gặp, và nhận gợi ý cách đánh: bi nào vào lỗ nào, điểm chạm đầu cơ, lực đánh, và đường bi cái đi để ra bi kế tiếp.

Nguyên tắc xuyên suốt (người dùng yêu cầu): **lối đánh đơn giản, hiệu quả được ưu tiên**. Một cú dễ thực hiện và ra bi tạm ổn luôn xếp trên một cú đẹp nhưng khó.

## 2. Mục tiêu, ngoài phạm vi, điều cần tránh

**Mục tiêu**

- Dựng một thế bi trên điện thoại trong khoảng 30 giây.
- Nhận tối đa 3 phương án, xếp theo độ dễ, hiện ra trong dưới 1 giây.
- Mỗi phương án đủ rõ để ra bàn đánh ngay mà không cần hiểu lý thuyết.

**Ngoài phạm vi (bản đầu)**

- Nhận diện thế bi từ ảnh chụp.
- Chơi cả ván, tính điểm, đấu với máy.
- Tài khoản, máy chủ, lưu trữ trên mạng.
- Cú băng bi mục tiêu (bank), cú liên hoàn (combo), cú carom, cú nhảy (jump), cú massé.
- Gợi ý vị trí đặt bi cái khi được bi trong tay.
- Bàn kích thước khác 9 feet (kích thước bàn nằm trong một file cấu hình để sau này thêm).
- Cài đặt trình độ người chơi.

**Điều cần tránh**

- Gợi ý cú cần xoáy ngang hoặc lực rất mạnh khi còn cú đơn giản hơn.
- Vẽ đường bi trông chính xác tuyệt đối. Bàn thật khác nhau về nỉ và băng, nên điểm dừng của bi cái được vẽ thành một vùng, không phải một chấm.
- Giao diện cần nhiều thao tác hoặc chữ nhỏ, khó dùng một tay bên bàn.

## 3. Các cách tiếp cận đã cân nhắc

| | A. Tính bằng hình học | B. Mô phỏng rồi chấm điểm |
|---|---|---|
| Cách hoạt động | Công thức bi ma, góc cắt, quy tắc 90°/30° | Thử vài chục cú đơn giản, mô phỏng bi lăn và chạm băng, chấm điểm |
| Điểm mạnh | Nhanh, dễ giải thích | Xử lý được chạm băng, bi cản, rơi bi cái |
| Điểm yếu | Sai khi bi cái chạm băng hoặc gặp bi khác | Tốn công hơn, cần chỉnh thông số |

**Đã chọn: B** (người dùng đồng ý). Ra bi trong 9 bi gần như luôn có chạm băng, và A vẽ sai đúng ở những thế cần giúp nhất.

Một cách thứ ba, dùng mô hình ngôn ngữ để đưa lời khuyên, đã bị loại vì không đáng tin về hình học và cần máy chủ.

## 4. Trải nghiệm người dùng

### Bố cục

Ưu tiên điện thoại. Bàn luôn nằm dọc theo cạnh dài của màn hình.

```
Dọc (điện thoại)              Ngang
┌───────────────────┐         ┌──────────────────────┬────────┐
│ 9 bi | 10 bi   ⋯  │         │                      │ Gợi ý  │
├───────────────────┤         │        BÀN           │ 1 ...  │
│                   │         │                      │ 2 ...  │
│       BÀN         │         │                      │ 3 ...  │
│     (dọc)         │         ├──────────────────────┤        │
│                   │         │ khay bi              │        │
├───────────────────┤         └──────────────────────┴────────┘
│ khay bi: ○ 1 2 3… │
├───────────────────┤
│ [ Gợi ý cách đánh ]│
│ thẻ phương án 1-3 │
└───────────────────┘
```

### Dựng thế bi

- Chọn chế độ 9 bi (bi 1–9) hoặc 10 bi (bi 1–10).
- Khay bi liệt kê bi cái và các bi số. Chạm một bi trong khay để đặt lên bàn; chạm lần nữa (hoặc kéo ra khỏi bàn) để cất đi.
- Kéo bi bằng ngón tay. Khi kéo, có kính lúp hiện phía trên ngón tay để thấy vị trí chính xác. Bi không thể chồng lên nhau hoặc ra ngoài mặt bàn; nó trượt đến vị trí hợp lệ gần nhất.
- Bàn có các điểm kim cương trên băng để người dùng đối chiếu với bàn thật.
- Nút "Xóa bàn" và "Xếp ngẫu nhiên" (để thử nhanh).
- Thế bi tự lưu trên máy (localStorage) và được mã hóa vào URL để chia sẻ.

### Xem gợi ý

- Gợi ý tự tính lại mỗi khi thả bi (có trễ ngắn), không cần bấm nút mỗi lần.
- Bi mục tiêu luôn là bi số nhỏ nhất trên bàn.
- Tối đa 3 thẻ phương án. Mỗi thẻ gồm:
  - Tiêu đề: "Bi 3 vào lỗ góc trên phải"
  - Hình đầu cơ: vòng tròn bi cái với chấm chỉ điểm chạm
  - Lực: thanh 5 nấc kèm chữ (rất nhẹ / nhẹ / vừa / mạnh / rất mạnh)
  - Ăn bi: phần trăm ước lượng và nhãn (Dễ / Trung bình / Khó)
  - Ra bi: nhãn tốt / tạm / xấu cho thế bi kế tiếp
  - Một câu giải thích, ví dụ: "Đánh giữa bi, lực vừa. Bi cái chạm một băng rồi về giữa bàn, thẳng hàng với bi 4."
- Chạm một thẻ để hiện trên bàn: đường ngắm, bi ma (vị trí bi cái lúc chạm), đường bi mục tiêu vào lỗ, đường bi cái sau va chạm, và vùng dừng dự kiến của bi cái.
- Nút "Xem lại" chạy hoạt hình cú đánh.
- Phương án đầu tiên được chọn sẵn.

### Khi không có cú ăn bi tốt

- Nếu phương án ăn bi tốt nhất dưới ngưỡng (đề xuất 35%), hiện thêm một phương án **đánh thủ**, kèm giải thích bi cái và bi mục tiêu sẽ nằm đâu.
- Nếu bi mục tiêu bị che hoàn toàn, gợi ý cú **một băng để chạm bi** (tránh phạm lỗi), tính bằng mô phỏng.
- Nếu bàn thiếu bi cái hoặc không có bi số nào, hiện hướng dẫn thay vì gợi ý.

## 5. Bộ gợi ý

### Mô hình bàn

- Bàn 9 feet: mặt chơi 2540 × 1270 mm, bi đường kính 57,15 mm.
- Sáu lỗ: miệng lỗ góc khoảng 115 mm, lỗ giữa khoảng 127 mm.
- Tất cả thông số bàn và vật lý nằm trong một file cấu hình.

### Mô phỏng vật lý

Mô phỏng 2D, bước thời gian cố định, viết thành mô-đun thuần không phụ thuộc giao diện.

- Mỗi bi có vận tốc và độ xoáy (xoáy tới/lùi và xoáy ngang).
- Bi trượt rồi chuyển sang lăn theo ma sát nỉ. Đây là thứ tạo ra hiệu ứng cú cao (bi cái đi theo) và cú thấp (bi cái lùi), và đường cong của bi cái sau va chạm.
- Va chạm bi–bi có hệ số đàn hồi; va chạm băng có hệ số nảy và mất tốc. Xoáy ngang làm lệch góc nảy băng theo mô hình đơn giản.
- Bi rơi lỗ khi tâm bi vào vùng miệng lỗ.
- Mô phỏng kết thúc khi mọi bi dừng.

Độ chính xác nhắm tới: đúng hướng và đúng vùng, không phải đúng từng centimet.

### Sinh các cú thử

Với bi mục tiêu, xét từng lỗ trong 6 lỗ:

- Bỏ qua nếu đường bi mục tiêu vào lỗ hoặc đường bi cái đến bi ma bị cản, hoặc góc cắt trên khoảng 70°.
- Với mỗi lỗ còn lại, thử 3 điểm đầu cơ (giữa, cao, thấp) × 5 mức lực.
- Chỉ khi không phương án nào đạt ngưỡng chấp nhận mới thử thêm xoáy trái và phải.

Tổng cộng khoảng 90 lượt mô phỏng cho trường hợp thường gặp.

### Chấm điểm

Điểm của một cú kết hợp:

1. **Xác suất ăn bi**: tính từ sai số góc cho phép (phụ thuộc góc cắt, khoảng cách bi cái–bi mục tiêu, khoảng cách bi mục tiêu–lỗ, góc vào lỗ) so với sai số điển hình của người chơi phong trào.
2. **Thế bi kế tiếp**: tại điểm dừng của bi cái, xác suất ăn bi tốt nhất cho bi số kế tiếp. Nếu bi mục tiêu là bi cuối (9 hoặc 10), bỏ qua phần này.
3. **Độ bền**: mỗi cú được mô phỏng lại với lực lệch ±10%; thế bi kế tiếp lấy trung bình. Cú chỉ tốt khi đánh đúng lực tuyệt đối sẽ bị trừ điểm. Các điểm dừng này cũng tạo ra vùng dừng vẽ trên bàn.
4. **Rủi ro**: trừ nặng nếu bi cái rơi lỗ; trừ nếu bi cái chạm bi khác ngoài ý muốn hoặc dừng sát băng.
5. **Độ đơn giản**: cộng điểm cho đánh giữa bi và lực vừa; trừ cho xoáy ngang và lực rất mạnh.

**Xếp hạng và con số hiển thị** (quyết định của người viết thiết kế):

- Thẻ được xếp theo điểm tổng hợp ở trên, không phải chỉ theo xác suất ăn bi. Thẻ đầu mang nhãn "Nên đánh".
- Phần trăm trên thẻ là xác suất ăn bi, ghi rõ "Ăn bi: 78%". Bên cạnh có nhãn riêng cho thế bi kế tiếp ("Ra bi: tốt / tạm / xấu"). Nhờ vậy khi thẻ 1 có phần trăm thấp hơn thẻ 2, người dùng thấy lý do: nó ra bi tốt hơn.
- Ngưỡng 35% để hiện phương án đánh thủ, và ngưỡng để thử thêm xoáy ngang, đều đo trên xác suất ăn bi và dùng cùng giá trị 35%.

Ba phương án hiển thị phải khác nhau thật sự (khác lỗ, hoặc khác rõ về điểm dừng bi cái), không phải ba biến thể gần giống nhau.

### Đánh thủ

Thử một tập cú chạm hợp lệ vào bi mục tiêu (nhiều độ dày chạm × vài mức lực). Cú hợp lệ theo luật: chạm bi mục tiêu trước, sau đó có bi chạm băng hoặc rơi lỗ. Chấm điểm theo việc đường thẳng từ bi cái đến bi mục tiêu sau cú đánh có bị bi khác che không, và khoảng cách giữa hai bi.

### Hiệu năng

Việc tính chạy trong Web Worker để giao diện không giật khi kéo bi. Kết quả cũ bị hủy khi thế bi thay đổi.

## 5b. Bổ sung sau khi duyệt (2026-11-19)

Người dùng duyệt thiết kế và thêm hai yêu cầu. Cách đáp ứng dưới đây là quyết định của người viết thiết kế.

### Độ chính xác đường bi: "chính xác so với thực tế nhất có thể"

Yêu cầu này thay thế mục tiêu "đúng hướng và đúng vùng" ở trên. Mô hình vật lý được nâng lên:

- Mỗi bi mang vectơ vận tốc góc 3 chiều đầy đủ (xoáy tới/lùi, xoáy ngang, và thành phần sinh ra khi cắt bi), không phải hai con số đơn giản.
- Ba trạng thái chuyển động theo mô hình chuẩn trong tài liệu vật lý bi-a: trượt (đường cong parabol), lăn, và xoay tại chỗ, mỗi trạng thái có ma sát riêng.
- Va chạm bi–bi có ma sát giữa hai bi, nên có hiện tượng **lệch bi do cắt và do xoáy** (throw): bi mục tiêu đi lệch vài độ so với đường nối tâm. Đường ngắm được hiệu chỉnh theo độ lệch này.
- Va chạm băng theo mô hình có xét chiều cao mũi băng và xoáy (mô hình Han 2005 hoặc tương đương), để góc nảy thay đổi đúng theo tốc độ và xoáy.
- Khi dùng xoáy ngang, tính thêm **lệch bi cái** (squirt) với hệ số cấu hình được.
- Thông số mặc định lấy từ số đo đã công bố (ma sát nỉ, ma sát bi–bi, độ nảy băng). Có một màn hình "Hiệu chỉnh bàn" đơn giản: nỉ nhanh / vừa / chậm, vì đây là yếu tố khác nhau nhiều nhất giữa các bàn.
- Mô hình được kiểm chứng bằng bài kiểm thử so với các kết quả đã biết: quy tắc 90° cho cú trượt, quy tắc 30° cho cú lăn, khoảng lùi của cú thấp, góc lệch do cắt tối đa quanh cú nửa bi.

Giới hạn cần nói thật trong giao diện: không mô phỏng nào khớp hoàn toàn một bàn cụ thể, và sai số của tay người lớn hơn sai số mô hình. Vùng dừng của bi cái vẫn được vẽ thành một vùng.

### Chụp ảnh để tự xếp bàn

Đưa vào phạm vi, làm ở **giai đoạn 2**, sau khi bàn và bộ gợi ý đã chạy đúng.

- Chạy hoàn toàn trên điện thoại bằng OpenCV.js, không gửi ảnh đi đâu. Cách thay thế là gửi ảnh cho mô hình thị giác trên máy chủ, đã loại vì cần máy chủ, khóa API và có chi phí theo lượt.
- Luồng dùng: chụp hoặc chọn ảnh → ứng dụng tự tìm bốn góc mặt bàn theo màu nỉ, người dùng kéo chỉnh nếu sai → nắn ảnh về hình chữ nhật → tìm các bi và đoán số theo màu → đặt bi lên bàn → người dùng sửa các bi nhận sai bằng kéo thả như bình thường.
- Kỳ vọng thực tế: vị trí bi thường đúng trong khoảng nửa viên bi nếu ảnh chụp từ trên cao và thấy đủ bốn góc. Nhận số bi theo màu dễ nhầm giữa các cặp màu gần nhau và giữa bi trơn với bi sọc cùng màu, nên bước sửa tay là một phần của luồng, không phải ngoại lệ.
- Bi nào không đoán được số sẽ được đặt lên bàn ở dạng "chưa rõ", chạm vào để chọn số.

Các mục "Nhận diện thế bi từ ảnh chụp" ở phần ngoài phạm vi và "đúng hướng và đúng vùng" ở phần mô phỏng vật lý không còn hiệu lực.

## 6. Kỹ thuật (do người thực hiện quyết định, người dùng đã giao phần này)

- Trang web tĩnh, không máy chủ: TypeScript, Vite, vẽ bàn bằng Canvas 2D. Không dùng framework giao diện.
- Giao diện tiếng Việt.
- Cấu trúc:
  - `src/core/` — hình học, vật lý, bộ gợi ý. Thuần, không đụng DOM.
  - `src/ui/` — vẽ bàn, kéo thả, thẻ phương án.
  - `src/worker/` — chạy bộ gợi ý.
- Kiểm thử bằng Vitest cho `src/core/`:
  - Cú thẳng đánh giữa bi, khoảng cách ngắn, lực mạnh: bi cái dừng tại chỗ. (Quyết định của người viết thiết kế: giữ vật lý thật. Ở cú xa hoặc nhẹ, bi cái đã chuyển sang lăn nên sẽ đi theo một đoạn; câu giải thích trên thẻ mô tả đúng kết quả mô phỏng, không mặc định "đánh giữa là dừng".)
  - Cú thẳng đánh cao: bi cái đi theo; đánh thấp: bi cái lùi.
  - Cú cắt đánh lăn tự nhiên: bi cái lệch khoảng 30° so với hướng ban đầu.
  - Nảy băng: góc ra xấp xỉ góc vào khi không xoáy.
  - Bộ gợi ý: cú thẳng gần lỗ xếp trên cú cắt mỏng xa lỗ; không bao giờ gợi ý cú làm rơi bi cái khi có lựa chọn khác; chỉ gợi ý bi số nhỏ nhất.
- Kiểm tra giao diện thật trên trình duyệt ở kích thước điện thoại trước khi báo xong.

## 7. Để ngỏ cho người thực hiện

- Giá trị cụ thể của các hệ số ma sát, đàn hồi, nảy băng, và trọng số chấm điểm. Bắt đầu từ các giá trị phổ biến trong tài liệu vật lý bi-a, rồi chỉnh cho đến khi các bài kiểm thử ở mục 6 và vài thế bi quen thuộc cho kết quả hợp lý.
- Cách mã hóa thế bi vào URL.
- Màu sắc và chi tiết hình ảnh của bàn và bi (dùng màu bi pool chuẩn, bi 9 và bi 10 có sọc).
- Nơi triển khai trang web: chưa quyết định; bản dựng là thư mục tĩnh chạy được ở bất kỳ dịch vụ nào.
