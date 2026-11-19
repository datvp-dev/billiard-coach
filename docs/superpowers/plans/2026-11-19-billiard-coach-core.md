# Billiard Coach (giai đoạn 1: bàn, vật lý, gợi ý) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trang web tĩnh, ưu tiên điện thoại, cho phép dựng thế bi 9 bi / 10 bi và nhận tối đa 3 gợi ý cách đánh (lỗ, đầu cơ, lực, đường bi cái) dựa trên mô phỏng vật lý.

**Architecture:** `src/core/` là TypeScript thuần (hình học, vật lý, bộ gợi ý), không đụng DOM, kiểm thử bằng Vitest. `src/worker/` chạy bộ gợi ý trong Web Worker. `src/ui/` vẽ Canvas 2D và xử lý chạm. Không có máy chủ.

**Tech Stack:** TypeScript (strict), Vite, Vitest, Canvas 2D. Không framework giao diện, không thư viện vật lý.

**Spec:** `docs/superpowers/specs/2026-11-19-billiard-coach-design.md` (mục 5b thay thế các phần nó nêu rõ).

**Phạm vi:** Kế hoạch này không gồm tính năng chụp ảnh (spec mục 5b, giai đoạn 2). Nó có kế hoạch riêng, viết sau khi giai đoạn 1 chạy đúng. Task 8 để sẵn chỗ gắn: `setLayout(layout)`.

## Global Constraints

- Đơn vị trong `src/core/`: mét, giây, radian. Gốc tọa độ ở góc dưới trái mặt chơi (đường mũi băng); x dọc chiều dài `0..2.54`, y dọc chiều rộng `0..1.27`.
- Bàn 9 feet: mặt chơi 2.540 × 1.270 m; bán kính bi `R = 0.028575`; miệng lỗ góc 0.115, lỗ giữa 0.127.
- Mọi hằng số bàn, vật lý và chấm điểm nằm trong `src/core/config.ts`; không viết số trực tiếp ở nơi khác.
- `src/core/` không import gì từ `src/ui/`, `src/worker/` hay DOM.
- Giao diện tiếng Việt. Tên mã, chú thích mã bằng tiếng Anh.
- Bi mục tiêu luôn là bi số nhỏ nhất trên bàn. 9 bi: bi 1–9. 10 bi: bi 1–10. Bi cái có id `0`.
- Không gợi ý bank, combo, carom, jump, massé; cơ luôn nằm ngang (không mô phỏng swerve).
- Xoáy ngang chỉ được thử khi cú ăn bi tốt nhất không dùng xoáy ngang có xác suất dưới `0.35`.
- Gợi ý phải có trong dưới 1 giây trên điện thoại tầm trung.
- Commit sau mỗi task. Task 1 chạy `git init`.

## Review Focus

1. Hai bi chạm nhau hoặc bi dính băng ngay từ đầu (người dùng đặt sát): mô phỏng không được treo, không bi nào xuyên qua nhau. Test ở Task 4.
2. Chỉ còn bi cái và một bi (bi cuối): vẫn có gợi ý, không lỗi vì thiếu bi kế tiếp. Test ở Task 6.
3. Kéo bi liên tục: kết quả của lượt tính cũ không được ghi đè lên thế bi mới. Test ở Task 8.
4. URL chia sẻ bị hỏng, thiếu bi cái, hoặc tọa độ ngoài bàn: mở ra bàn hợp lệ (bỏ qua bi sai), không màn hình trắng. Test ở Task 7.
5. Bi mục tiêu nằm ngay miệng lỗ hoặc bi cái gần như chạm bi mục tiêu (khoảng cách < 2R + 1 mm): hàm ngắm trả kết quả hữu hạn, không NaN. Test ở Task 5.

---

## Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `src/core/config.ts` | Hằng số bàn, vật lý, chấm điểm, mức lực, điểm đầu cơ |
| `src/core/types.ts` | Kiểu dùng chung |
| `src/core/vec.ts` | Toán vectơ 2D/3D |
| `src/core/table.ts` | Lỗ, đoạn băng, đặt bi hợp lệ |
| `src/core/physics/motion.ts` | Cú đánh ban đầu; trượt / lăn / xoay |
| `src/core/physics/collide.ts` | Va chạm bi–bi (có throw), bi–băng (Han 2005) |
| `src/core/physics/simulate.ts` | Vòng lặp mô phỏng, sự kiện, đường đi |
| `src/core/aim.ts` | Đường nhìn, bi ma, góc cắt, xác suất ăn bi, giải hướng ngắm có bù throw |
| `src/core/advisor.ts` | Sinh cú thử, chấm điểm, đánh thủ, cú một băng |
| `src/core/explain.ts` | Câu giải thích tiếng Việt, nhãn |
| `src/core/layoutCodec.ts` | Thế bi ↔ chuỗi URL |
| `src/worker/advisor.worker.ts`, `src/worker/client.ts` | Chạy `advise` ngoài luồng chính, hủy kết quả cũ |
| `src/ui/tableView.ts` | Vẽ bàn, bi, lớp phủ gợi ý; đổi tọa độ màn hình ↔ bàn |
| `src/ui/drag.ts` | Kéo thả, kính lúp |
| `src/ui/tray.ts` | Khay bi, chọn chế độ, nút xóa / ngẫu nhiên / nỉ |
| `src/ui/cards.ts` | Thẻ phương án, hình đầu cơ, thanh lực |
| `src/ui/replay.ts` | Hoạt hình cú đánh |
| `src/main.ts`, `index.html`, `src/style.css` | Ghép nối, bố cục |

---

### Task 1: Khung dự án, kiểu, cấu hình, vectơ

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, `src/main.ts`
- Create: `src/core/types.ts`, `src/core/config.ts`, `src/core/vec.ts`
- Test: `src/core/vec.test.ts`

**Interfaces — Produces:**

```ts
// types.ts
export type Vec2 = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };
export type GameMode = '9' | '10';
export type BallPos = { id: number; pos: Vec2 };            // id 0 = cue ball
export type Layout = { mode: GameMode; balls: BallPos[] };
export type PocketId = 'BL' | 'BR' | 'TL' | 'TR' | 'SB' | 'ST'; // bottom/top = y=0 / y=W; S = side
export type TipName = 'center' | 'high' | 'low' | 'left' | 'right';
export type Tip = { side: number; vert: number };           // fraction of R, each in [-0.5, 0.5]
export type Shot = { dir: number; speed: number; tip: Tip }; // dir = radians from +x
export type ClothSpeed = 'fast' | 'medium' | 'slow';
export type SimEvent = { t: number; type: 'ball' | 'cushion' | 'pocket'; ball: number; other?: number; pocket?: PocketId; pos: Vec2 };
export type SimResult = {
  events: SimEvent[];
  paths: Record<number, Vec2[]>;      // polyline per ball that moved
  final: BallPos[];                    // balls still on the table
  pocketed: { id: number; pocket: PocketId }[];
  firstContact: number | null;        // first ball the cue ball touched
  cueScratched: boolean;
  railAfterContact: boolean;          // any ball hit a cushion after firstContact
  cueTouched: number[];               // every ball the cue ball touched, in order
};
export type Suggestion = {
  kind: 'pot' | 'safety' | 'kick';
  targetId: number; pocket?: PocketId;
  shot: Shot; tipName: TipName; powerLevel: 1 | 2 | 3 | 4 | 5;
  potProb: number;                    // 0..1 (0 for safety/kick)
  posQuality: number;                 // 0..1
  score: number;
  ghost: Vec2 | null;
  sim: SimResult;                     // nominal
  stopZone: Vec2[];                   // cue final positions at 0.9x, 1x, 1.1x speed
  text: string;
};
export type AdviceResult =
  | { status: 'no-cue' } | { status: 'no-target' }
  | { status: 'ok'; targetId: number; suggestions: Suggestion[] };
```

```ts
// config.ts — exact values
export const TABLE = { L: 2.54, W: 1.27, R: 0.028575, m: 0.17,
  cornerMouth: 0.115, sideMouth: 0.127,
  cornerGap: 0.0813,            // cushion starts this far from the corner along each rail
  sideGap: 0.0635,              // cushion gap half-width around x = L/2
  cornerCapture: { inset: -0.02, r: 0.07 },  // capture circle centre pushed 0.02 outward along the diagonal
  sideCapture: { inset: -0.035, r: 0.06 } };
export const PHYS = { g: 9.81, muSlide: 0.2, muSpin: 0.044,
  muRoll: { fast: 0.008, medium: 0.010, slow: 0.013 },
  eBall: 0.95, muBallA: 9.951e-3, muBallB: 0.108, muBallC: 1.088, // mu = A + B*exp(-C*vRel)
  eCushion: 0.85, muCushion: 0.2, cushionH: 0.0400,               // nose height = 7R/5
  eJaw: 0.6, squirtPerSide: 0.035,                                // rad per unit tip.side
  dt: 0.001, maxTime: 20, sampleEvery: 0.01 };
export const POWER_SPEEDS = [0.8, 1.5, 2.5, 3.8, 5.5] as const;   // m/s, level 1..5
export const TIPS: Record<TipName, Tip> = { center: {side:0,vert:0}, high: {side:0,vert:0.4},
  low: {side:0,vert:-0.4}, left: {side:-0.3,vert:0}, right: {side:0.3,vert:0} };
export const SCORE = { playerSigmaDeg: 0.15, maxCutDeg: 70, safetyThreshold: 0.35,
  wPot: 0.45, wPos: 0.55, bonusCenter: 0.03, bonusMidPower: 0.02,
  penSide: 0.08, penMaxPower: 0.05, penExtraContact: 0.05, penNearRail: 0.03,
  scratchPerturbFactor: 0.5, diversityDist: 0.25 };
```

```ts
// vec.ts
export const v2: (x: number, y: number) => Vec2;
export function add(a: Vec2, b: Vec2): Vec2; export function sub(a: Vec2, b: Vec2): Vec2;
export function scale(a: Vec2, s: number): Vec2; export function dot(a: Vec2, b: Vec2): number;
export function len(a: Vec2): number; export function dist(a: Vec2, b: Vec2): number;
export function norm(a: Vec2): Vec2;            // returns {0,0} for zero input, never NaN
export function fromAngle(rad: number): Vec2; export function angleOf(a: Vec2): number;
export function angleDiff(a: number, b: number): number;   // signed, in (-PI, PI]
export function distPointSegment(p: Vec2, a: Vec2, b: Vec2): number;
```

- [ ] **Step 1:** `git init`; tạo dự án Vite vanilla-ts bằng tay (không dùng trình tạo tương tác); cài `vite`, `typescript`, `vitest` làm devDependencies. Scripts: `dev`, `build` (`tsc --noEmit && vite build`), `test` (`vitest run`). `tsconfig` bật `strict`. `vite.config.ts` đặt `base: './'`.
- [ ] **Step 2:** Viết `src/core/vec.test.ts`:

```ts
test('norm of zero vector is zero, not NaN', () => { expect(norm(v2(0,0))).toEqual({x:0,y:0}); });
test('angleDiff wraps', () => { expect(angleDiff(3.1, -3.1)).toBeCloseTo(3.1 + 3.1 - 2*Math.PI, 9); });
test('distPointSegment clamps to endpoints', () => { expect(distPointSegment(v2(2,1), v2(0,0), v2(1,0))).toBeCloseTo(Math.SQRT2, 9); });
```

- [ ] **Step 3:** Chạy `npx vitest run src/core/vec.test.ts` — FAIL (chưa có module).
- [ ] **Step 4:** Viết `types.ts`, `config.ts`, `vec.ts` đúng như Interfaces. `src/main.ts` tạm thời chỉ ghi "Billiard Coach" vào `#app`.
- [ ] **Step 5:** `npx vitest run` — PASS; `npm run build` — không lỗi.
- [ ] **Step 6:** Commit `chore: scaffold project, core types, config, vec`.

---

### Task 2: Hình học bàn

**Files:** Create `src/core/table.ts`; Test `src/core/table.test.ts`

**Interfaces — Consumes:** `TABLE`, `vec.ts`. **Produces:**

```ts
export const POCKET_IDS: PocketId[];                       // ['BL','BR','TL','TR','SB','ST']
export function pocketCenter(id: PocketId): Vec2;          // aim point: BL (0,0), BR (L,0), TL (0,W), TR (L,W), SB (L/2,0), ST (L/2,W)
export function pocketCapture(id: PocketId): { c: Vec2; r: number };
export function pocketAxis(id: PocketId): Vec2;            // unit vector pointing INTO the pocket (corner: diagonal; side: ±y)
export type Cushion = { a: Vec2; b: Vec2; n: Vec2 };       // nose-line segment; n = unit normal pointing into the table
export const CUSHIONS: Cushion[];                          // 6 segments, gaps per TABLE.cornerGap / sideGap
export const JAW_POINTS: Vec2[];                           // the 12 segment endpoints
export function targetBallId(layout: Layout): number | null; // lowest id > 0 on the table
export function nextBallId(layout: Layout, after: number): number | null;
export function ballIdsForMode(mode: GameMode): number[];  // [0,1..9] or [0,1..10]
export function placeBall(layout: Layout, id: number, wanted: Vec2): Vec2;
// nearest legal position to `wanted`: centre within [R, L-R] x [R, W-R], and >= 2R + 1e-4 from every other ball.
// Resolve by pushing out along the line from the blocking ball, up to 20 iterations; if still illegal, scan a spiral of 5 mm steps.
```

- [ ] **Step 1:** Viết test:

```ts
test('six cushions, twelve jaw points', () => { expect(CUSHIONS).toHaveLength(6); expect(JAW_POINTS).toHaveLength(12); });
test('bottom-left cushion on the bottom rail starts at cornerGap', () => {
  const c = CUSHIONS.find(c => c.n.y === 1 && Math.min(c.a.x, c.b.x) < 1)!;
  expect(Math.min(c.a.x, c.b.x)).toBeCloseTo(0.0813, 6); expect(Math.max(c.a.x, c.b.x)).toBeCloseTo(1.27 - 0.0635, 6);
});
test('target is lowest numbered ball', () => {
  expect(targetBallId({mode:'9', balls:[{id:0,pos:v2(1,0.5)},{id:5,pos:v2(2,0.5)},{id:3,pos:v2(1.5,0.5)}]})).toBe(3);
});
test('nextBallId returns null for the last ball', () => {
  expect(nextBallId({mode:'9', balls:[{id:0,pos:v2(1,0.5)},{id:9,pos:v2(2,0.5)}]}, 9)).toBeNull();
});
test('placeBall keeps balls on the table and apart', () => {
  const lay: Layout = {mode:'9', balls:[{id:0,pos:v2(1,0.5)},{id:1,pos:v2(1.2,0.5)}]};
  const p = placeBall(lay, 1, v2(1.01, 0.5)); expect(dist(p, v2(1,0.5))).toBeGreaterThanOrEqual(2*TABLE.R);
  const q = placeBall(lay, 1, v2(-5, 9)); expect(q.x).toBeCloseTo(TABLE.R, 6); expect(q.y).toBeCloseTo(TABLE.W - TABLE.R, 6);
});
```

- [ ] **Step 2:** `npx vitest run src/core/table.test.ts` — FAIL.
- [ ] **Step 3:** Viết `table.ts`.
- [ ] **Step 4:** Chạy lại — PASS.
- [ ] **Step 5:** Commit `feat(core): table geometry and legal ball placement`.

---

### Task 3: Chuyển động của một bi và cú đánh ban đầu

**Files:** Create `src/core/physics/motion.ts`; Test `src/core/physics/motion.test.ts`

**Interfaces — Produces:**

```ts
export type Body = { id: number; pos: Vec2; vel: Vec2; w: Vec3; active: boolean }; // active=false once pocketed
export type PhysParams = { cloth: ClothSpeed };
export function strike(pos: Vec2, shot: Shot): Body;
export function slipVelocity(b: Body): Vec2;          // velocity of the contact point relative to the cloth
export function isMoving(b: Body): boolean;           // |vel| > 1e-4 or |w.z| > 1e-2
export function advance(b: Body, dt: number, p: PhysParams): void; // mutates; exact within each motion state, splits dt at the slide->roll transition
```

Mô hình (quy ước: z hướng lên; `u = vel + R·(ẑ × w)_xy` là vận tốc trượt của điểm tiếp xúc):

- `strike`: hướng thực `dir' = dir − squirtPerSide·tip.side`; `vel = speed·d̂`; `w_xy = (5·speed·tip.vert / (2R))·(ẑ × d̂)` (với `vert = 0.4` bi lăn tự nhiên ngay); `w.z = −5·speed·tip.side / (2R)`.
- Trượt (`|u| > 1e-3`): `a = −muSlide·g·û`; `dw_xy/dt = −(5·muSlide·g / (2R))·(ẑ × û)`; thời gian đến lăn `= 2|u| / (7·muSlide·g)`.
- Lăn: `a = −muRoll[cloth]·g·v̂`; `w_xy = (ẑ × vel)/R`; dừng khi `|vel| → 0`.
- `w.z` giảm tuyến tính về 0 với tốc độ `5·muSpin·g / (2R)` ở mọi trạng thái.

- [ ] **Step 1:** Viết test (cloth `medium`):

```ts
const run = (b: Body, t: number) => { for (let i = 0; i < t/0.001; i++) advance(b, 0.001, {cloth:'medium'}); return b; };
test('high tip 0.4 starts in natural roll', () => { expect(len(slipVelocity(strike(v2(1,0.6), {dir:0, speed:2, tip:{side:0,vert:0.4}})))).toBeLessThan(1e-9); });
test('centre hit slides then rolls at 5/7 of launch speed', () => {
  const b = strike(v2(0.3,0.6), {dir:0, speed:2, tip:{side:0,vert:0}});
  run(b, 2*2/(7*0.2*9.81) + 0.002); expect(len(b.vel)).toBeCloseTo(2*5/7, 1); expect(len(slipVelocity(b))).toBeLessThan(0.01);
});
test('rolling ball travels v^2 / (2 muRoll g)', () => {
  const b = strike(v2(0.2,0.6), {dir:0, speed:0.5, tip:{side:0,vert:0.4}}); run(b, 10);
  expect(b.pos.x - 0.2).toBeCloseTo(0.25/(2*0.010*9.81), 1); expect(isMoving(b)).toBe(false);
});
test('draw: backspin decreases while sliding forward', () => {
  const b = strike(v2(0.3,0.6), {dir:0, speed:3, tip:{side:0,vert:-0.4}}); const w0 = b.w.y; run(b, 0.1);
  expect(Math.abs(b.w.y)).toBeLessThan(Math.abs(w0)); expect(b.vel.x).toBeGreaterThan(0);
});
test('right english squirts left and spins clockwise', () => {
  const b = strike(v2(1,0.6), {dir:0, speed:2, tip:{side:0.3,vert:0}});
  expect(angleOf(b.vel)).toBeCloseTo(-0.035*0.3, 6); expect(b.w.z).toBeLessThan(0);
});
test('side spin decays to zero and the ball stops', () => {
  const b = strike(v2(1,0.6), {dir:0, speed:1, tip:{side:0.3,vert:0}}); run(b, 20); expect(isMoving(b)).toBe(false);
});
```

- [ ] **Step 2:** `npx vitest run src/core/physics/motion.test.ts` — FAIL.
- [ ] **Step 3:** Viết `motion.ts`.
- [ ] **Step 4:** Chạy lại — PASS.
- [ ] **Step 5:** Commit `feat(physics): strike and slide/roll/spin motion`.

---

### Task 4: Va chạm và vòng lặp mô phỏng

**Files:** Create `src/core/physics/collide.ts`, `src/core/physics/simulate.ts`; Test `src/core/physics/collide.test.ts`, `src/core/physics/simulate.test.ts`

**Interfaces — Consumes:** `Body`, `advance`, `strike`, `isMoving`, `CUSHIONS`, `JAW_POINTS`, `pocketCapture`. **Produces:**

```ts
// collide.ts
export function collideBalls(a: Body, b: Body): void;                 // mutates both; includes friction (throw, spin transfer)
export function collideCushion(b: Body, n: Vec2): void;               // n = cushion normal pointing into the table
export function collideJaw(b: Body, point: Vec2): void;               // reflect about the centre-to-point line with PHYS.eJaw, spin unchanged
// simulate.ts
export type SimOptions = { cloth: ClothSpeed; stopAtFirstContact?: boolean };
export function simulate(balls: BallPos[], shot: Shot, opts: SimOptions): SimResult;
```

`collideBalls`: xung lực pháp tuyến `Jn = m·(1+eBall)·vn/2` dọc đường nối tâm. Vận tốc tương đối tiếp tuyến tại điểm chạm (gồm cả đóng góp của `w` hai bi, cả thành phần ngang lẫn `w.z`) là `vt`. Xung lực tiếp tuyến `Jt = min(mu(|vt|)·Jn, m·|vt|/7)` với `mu(v) = muBallA + muBallB·exp(−muBallC·v)`, ngược chiều `vt`; áp lên vận tốc và `w` của cả hai bi (bỏ qua thành phần vận tốc thẳng đứng).

`collideCushion` (Han 2005). Trong hệ quay sao cho bi đi vào băng theo +x:

```
θ  = asin(cushionH / R − 1)
sx = vx·sinθ + R·wy
sy = −vy − R·wz·cosθ + R·wx·sinθ
c  = vx·cosθ
A = 7/(2m),  B = 1/m,  I = 2mR²/5
PzE = (1+e)·c / B,   PzS = sqrt(sx² + sy²) / A
if PzS <= PzE:   PX = −(sx/A)·sinθ − PzE·cosθ;   PY = sy/A;   PZ = (sx/A)·cosθ − PzE·sinθ
else: φ = atan2(sy, sx)
                 PX = −μ·PzE·cosφ·sinθ − PzE·cosθ;   PY = μ·PzE·sinφ;   PZ = μ·PzE·cosφ·cosθ − PzE·sinθ
vx += PX/m;  vy += PY/m
wx += −(R/I)·PY·sinθ;   wy += (R/I)·(PX·sinθ − PZ·cosθ);   wz += (R/I)·PY·cosθ
```

với `e = eCushion`, `μ = muCushion`. Đối chiếu dấu với bài báo (Han, 2005, "Dynamics in carom and three cushion billiards") hoặc mã nguồn pooltool `han_2005` trước khi tin; các test dưới đây là chuẩn quyết định.

`simulate`: bước `dt = PHYS.dt`. Mỗi bước: tìm va chạm sớm nhất trong bước (bi–bi bằng phương trình bậc hai với vận tốc coi như không đổi trong bước; bi–băng khi tâm cách đường mũi băng `R` và đang đi vào, trong phạm vi đoạn băng; bi–điểm hàm lỗ), tiến tất cả đến thời điểm đó, giải va chạm, lặp cho đến hết bước (tối đa 8 va chạm mỗi bước). Hai bi đang chồng hoặc chạm nhau mà không tiến lại gần thì không va chạm. Bi rơi lỗ khi tâm nằm trong vòng `pocketCapture`. Ghi điểm vào `paths` mỗi `sampleEvery` giây và tại mỗi sự kiện. Dừng khi không bi nào `isMoving`, hoặc `t > maxTime`, hoặc (`stopAtFirstContact`) ngay sau va chạm bi đầu tiên của bi cái.

- [ ] **Step 1:** Viết `collide.test.ts`:

```ts
const still = (id: number, x: number, y: number): Body => ({id, pos:v2(x,y), vel:v2(0,0), w:{x:0,y:0,z:0}, active:true});
test('head-on stun: cue nearly stops, object leaves at ~eBall speed', () => {
  const a = still(0, 1, 0.6); a.vel = v2(2,0); const b = still(1, 1 + 2*TABLE.R, 0.6); collideBalls(a,b);
  expect(b.vel.x).toBeCloseTo(2*(1+0.95)/2, 2); expect(a.vel.x).toBeCloseTo(2*(1-0.95)/2, 2);
});
test('half-ball stun cut: object ball is thrown off the line of centres by 1 to 6 degrees', () => {
  const a = still(0, 1, 0.6); a.vel = v2(1.5,0); const b = still(1, 1 + 2*TABLE.R*Math.cos(Math.PI/6), 0.6 + 2*TABLE.R*Math.sin(Math.PI/6)); collideBalls(a,b);
  const thrown = Math.abs(angleDiff(angleOf(b.vel), Math.PI/6)) * 180/Math.PI;
  expect(thrown).toBeGreaterThan(1); expect(thrown).toBeLessThan(6);
  expect(angleOf(b.vel)).toBeLessThan(Math.PI/6);        // thrown toward the cue ball's direction of travel
});
test('momentum along the line of centres is conserved', () => { /* same setup; expect sum of m*v before == after to 1e-9 */ });
test('cushion: no-spin sliding ball at 45 degrees rebounds shallower and slower', () => {
  const b = still(0, 1, 0.5); b.vel = v2(1, -1); collideCushion(b, v2(0,1));
  expect(b.vel.y).toBeGreaterThan(0); expect(len(b.vel)).toBeLessThan(Math.SQRT2);
  const out = Math.atan2(b.vel.y, Math.abs(b.vel.x)) * 180/Math.PI; expect(out).toBeGreaterThan(25); expect(out).toBeLessThan(50);
});
test('cushion: running english lengthens the rebound, reverse shortens it', () => {
  const mk = (wz: number) => { const b = still(0,1,0.5); b.vel = v2(1,-1); b.w.z = wz; collideCushion(b, v2(0,1)); return b.vel.x; };
  expect(mk(40)).toBeGreaterThan(mk(0)); expect(mk(-40)).toBeLessThan(mk(0));   // if signs come out reversed, the convention in strike() and here disagree: fix, do not flip the test
});
```

- [ ] **Step 2:** Viết `simulate.test.ts` (cloth `medium`; bi cái ở `(0.8, 0.635)`, bi 1 ở `(1.3, 0.635)` trừ khi nói khác):

```ts
const sim = (balls: BallPos[], shot: Shot) => simulate(balls, shot, {cloth:'medium'});
const cueEnd = (r: SimResult) => r.final.find(b => b.id === 0)!.pos;
test('short firm centre hit, straight: stop shot', () => {
  const r = sim([{id:0,pos:v2(1.1,0.635)},{id:1,pos:v2(1.3,0.635)}], {dir:0, speed:3.8, tip:TIPS.center});
  expect(dist(cueEnd(r), v2(1.3 - 2*TABLE.R, 0.635))).toBeLessThan(0.08);
});
test('high tip follows, low tip draws back', () => {
  const hi = sim(std, {dir:0, speed:2.5, tip:TIPS.high}); expect(cueEnd(hi).x).toBeGreaterThan(1.3 + 0.15);
  const lo = sim(std, {dir:0, speed:2.5, tip:TIPS.low});  expect(cueEnd(lo).x).toBeLessThan(1.3 - 2*TABLE.R - 0.15);
});
test('30-degree rule: rolling cue ball, half-ball hit, deflects 27 to 40 degrees', () => {
  // aim so the ghost ball centre is offset R sideways from the line through the object ball; soft speed 1.5, TIPS.high.
  // measure the cue ball heading 0.4 s after contact from r.paths[0]; expect 27 <= deflection <= 40.
});
test('90-degree rule: stun cut leaves along the tangent line within 6 degrees', () => {
  // same geometry, cue ball 0.15 m from the ghost position, speed 3.8, TIPS.center; heading just after contact vs line of centres: 84..96 degrees.
});
test('ball rolled into a corner pocket is pocketed', () => {
  const r = sim([{id:0,pos:v2(0.5,0.5)}], {dir:Math.atan2(-0.5,-0.5), speed:1.5, tip:TIPS.high});
  expect(r.cueScratched).toBe(true); expect(r.final).toHaveLength(0);
});
test('firstContact, cueTouched and railAfterContact are reported', () => {
  const r = sim(std, {dir:0, speed:3.8, tip:TIPS.center}); expect(r.firstContact).toBe(1); expect(r.cueTouched).toEqual([1]); expect(r.railAfterContact).toBe(true);
});
test('touching balls and a ball frozen to the rail do not hang or tunnel', () => {
  const r = sim([{id:0,pos:v2(0.5,0.635)},{id:1,pos:v2(1.0,TABLE.R)},{id:2,pos:v2(1.0+2*TABLE.R,TABLE.R)},{id:3,pos:v2(1.0+4*TABLE.R,TABLE.R)}],
    {dir:Math.atan2(TABLE.R-0.635, 0.5), speed:5.5, tip:TIPS.center});
  for (const b of r.final) { expect(Number.isFinite(b.pos.x) && Number.isFinite(b.pos.y)).toBe(true);
    expect(b.pos.x).toBeGreaterThan(0); expect(b.pos.x).toBeLessThan(TABLE.L); expect(b.pos.y).toBeGreaterThan(0); expect(b.pos.y).toBeLessThan(TABLE.W); }
  for (const a of r.final) for (const b of r.final) if (a.id < b.id) expect(dist(a.pos,b.pos)).toBeGreaterThan(2*TABLE.R - 1e-3);
});
test('stopAtFirstContact ends early', () => {
  const r = simulate(std, {dir:0, speed:2.5, tip:TIPS.center}, {cloth:'medium', stopAtFirstContact:true}); expect(r.firstContact).toBe(1); expect(r.pocketed).toHaveLength(0);
});
test('one full simulation takes under 5 ms on average', () => { /* 100 runs of the `std` high-tip shot; expect total < 500 ms */ });
```

- [ ] **Step 3:** `npx vitest run src/core/physics` — FAIL.
- [ ] **Step 4:** Viết `collide.ts` rồi `simulate.ts`.
- [ ] **Step 5:** Chạy lại — PASS. Nếu test quy tắc 30°/90° hoặc throw lệch khoảng, sửa mô hình (dấu, quy ước trục), không nới khoảng trong test.
- [ ] **Step 6:** Commit `feat(physics): collisions with throw, Han cushion model, simulation loop`.

---

### Task 5: Ngắm bi

**Files:** Create `src/core/aim.ts`; Test `src/core/aim.test.ts`

**Interfaces — Consumes:** `simulate`, `table.ts`. **Produces:**

```ts
export function pathClear(from: Vec2, to: Vec2, balls: BallPos[], ignore: number[]): boolean;
// true if no ball (other than `ignore`) has its centre within 2R of the segment
export function ghostBall(obj: Vec2, pocket: PocketId): Vec2;         // obj + 2R * unit(obj - pocketCenter)
export function cutAngle(cue: Vec2, obj: Vec2, pocket: PocketId): number; // radians, 0 = straight
export function entryAngle(obj: Vec2, pocket: PocketId): number;      // angle between obj->pocket and pocketAxis
export function potProbability(cue: Vec2, obj: Vec2, pocket: PocketId): number;
export function potGeometryOk(layout: Layout, targetId: number, pocket: PocketId): boolean;
// cue->ghost clear (ignoring cue, target), obj->pocket clear (ignoring target), cut <= maxCutDeg, entry <= 60deg for side pockets / 50deg for corners
export function solveAim(layout: Layout, targetId: number, pocket: PocketId, speed: number, tip: Tip, cloth: ClothSpeed): number | null;
export function bestPotProbability(layout: Layout, targetId: number): number; // max over pockets passing potGeometryOk; 0 if none
```

`potProbability`: `mouth` = miệng lỗ tương ứng; `e = max(0, (mouth·cos(entry) − R) / 2)`; `alpha = e / max(d_obj_pocket, R)`; `margin = alpha · 2R·cos(cut) / max(d_cue_ghost, 2R)`; kết quả `erf(margin / (sigma·√2))` với `sigma = playerSigmaDeg` đổi ra radian, kẹp trong `[0, 0.99]`. Tự viết `erf` (xấp xỉ Abramowitz–Stegun 7.1.26).

`solveAim`: bắt đầu từ hướng bi cái → bi ma. Lặp tối đa 6 lần: `simulate` với `stopAtFirstContact`, đo hướng rời của bi mục tiêu, so với hướng bi mục tiêu → tâm lỗ, xoay hướng ngắm bằng sai lệch đó nhân `2R / d_cue_ghost` (ngược dấu). Dừng khi sai lệch < 0.05°. Trả `null` nếu `firstContact !== targetId` ở bất kỳ lần lặp nào hoặc không hội tụ.

- [ ] **Step 1:** Viết test:

```ts
const lay = (...b: [number, number, number][]): Layout => ({mode:'9', balls: b.map(([id,x,y]) => ({id, pos:v2(x,y)}))});
test('ghost ball sits 2R behind the object ball on the pocket line', () => {
  const g = ghostBall(v2(2.0,0.5), 'TR'); expect(dist(g, v2(2.0,0.5))).toBeCloseTo(2*TABLE.R, 9); expect(dist(g, pocketCenter('TR'))).toBeGreaterThan(dist(v2(2.0,0.5), pocketCenter('TR')));
});
test('pathClear detects a blocker', () => {
  expect(pathClear(v2(0.5,0.5), v2(2,0.5), [{id:4,pos:v2(1.2,0.52)}], [])).toBe(false);
  expect(pathClear(v2(0.5,0.5), v2(2,0.5), [{id:4,pos:v2(1.2,0.52)}], [4])).toBe(true);
});
test('short straight shot is easier than a long thin cut', () => {
  const easy = potProbability(v2(2.0,0.9), v2(2.25,1.05), 'TR'); const hard = potProbability(v2(0.3,1.1), v2(1.9,0.4), 'TR');
  expect(easy).toBeGreaterThan(0.85); expect(hard).toBeLessThan(0.35); expect(easy).toBeGreaterThan(hard);
});
test('1 m + 1 m straight shot is between 45% and 80%', () => {
  const p = pocketCenter('TR'); const d = norm(sub(v2(0,0), v2(1,0.5)));  // any direction away from the pocket
  const obj = add(p, scale(d, 1)); const cue = add(p, scale(d, 2)); const pr = potProbability(cue, obj, 'TR'); expect(pr).toBeGreaterThan(0.45); expect(pr).toBeLessThan(0.8);
});
test('degenerate geometry yields finite numbers', () => {
  expect(Number.isFinite(potProbability(v2(1,0.5), v2(1 + 2*TABLE.R + 0.0005, 0.5), 'BR'))).toBe(true);     // cue almost touching
  expect(Number.isFinite(potProbability(v2(1,0.5), v2(TABLE.L - 0.03, TABLE.W - 0.03), 'TR'))).toBe(true);   // object ball in the jaws
  expect(Number.isFinite(cutAngle(v2(1,0.5), v2(1,0.5), 'TR'))).toBe(true);
});
test('solveAim pots a 30-degree cut where the plain ghost-ball line may not', () => {
  const L = lay([0, 1.2, 0.3], [1, 2.0, 0.9]); const dir = solveAim(L, 1, 'TR', 1.5, TIPS.center, 'medium'); expect(dir).not.toBeNull();
  const r = simulate(L.balls, {dir: dir!, speed:1.5, tip:TIPS.center}, {cloth:'medium'}); expect(r.pocketed).toContainEqual({id:1, pocket:'TR'});
});
test('solveAim returns null when a ball blocks the cue path', () => {
  expect(solveAim(lay([0,0.5,0.635],[1,2.0,0.635],[2,1.2,0.635]), 1, 'BR', 2.5, TIPS.center, 'medium')).toBeNull();
});
test('potGeometryOk rejects cuts over 70 degrees', () => { expect(potGeometryOk(lay([0,2.3,0.2],[1,2.0,0.9]), 1, 'BR')).toBe(false); });
```

- [ ] **Step 2:** `npx vitest run src/core/aim.test.ts` — FAIL.
- [ ] **Step 3:** Viết `aim.ts`.
- [ ] **Step 4:** Chạy lại — PASS.
- [ ] **Step 5:** Commit `feat(core): aiming, pot probability, throw-compensated aim solver`.

---

### Task 6: Bộ gợi ý và câu giải thích

**Files:** Create `src/core/advisor.ts`, `src/core/explain.ts`; Test `src/core/advisor.test.ts`, `src/core/explain.test.ts`

**Interfaces — Consumes:** Task 2, 4, 5. **Produces:**

```ts
// advisor.ts
export type AdviseOptions = { cloth: ClothSpeed };
export function advise(layout: Layout, opts: AdviseOptions): AdviceResult;
// explain.ts
export function pocketName(id: PocketId): string;   // 'lỗ góc dưới trái' (BL), 'lỗ góc dưới phải' (BR), 'lỗ góc trên trái' (TL), 'lỗ góc trên phải' (TR), 'lỗ giữa dưới' (SB), 'lỗ giữa trên' (ST)
export function tipLabel(t: TipName): string;       // 'giữa bi' | 'cao' | 'thấp' | 'xoáy trái' | 'xoáy phải'
export function powerLabel(level: number): string;  // 'rất nhẹ' | 'nhẹ' | 'vừa' | 'mạnh' | 'rất mạnh'
export function potLabel(p: number): 'Dễ' | 'Trung bình' | 'Khó';   // >= 0.70, >= 0.40, else
export function posLabel(q: number): 'tốt' | 'tạm' | 'xấu';         // >= 0.60, >= 0.30, else
export function explain(s: Omit<Suggestion, 'text'>, nextId: number | null): string;
```

`advise`:

1. Không có bi cái → `no-cue`. Không có bi số → `no-target`.
2. **Cú ăn bi.** Với mỗi lỗ qua `potGeometryOk`, mỗi tip trong `[center, high, low]`, mỗi mức lực 1–5: `solveAim`; nếu có hướng, `simulate` ở tốc độ danh định. Loại nếu bi mục tiêu không rơi đúng lỗ đó hoặc bi cái rơi lỗ. Với cú còn lại, mô phỏng thêm ở `0.9×` và `1.1×` tốc độ (cùng hướng).
   - `potProb = potProbability(cue, target, pocket)`.
   - `posQuality`: trung bình trên 3 lượt của `bestPotProbability(thế bi sau cú đánh, bi kế tiếp)`; lượt nào bi cái rơi lỗ hoặc bi mục tiêu không rơi tính 0. Nếu không còn bi kế tiếp (đã là bi cuối) thì `posQuality = 1`.
   - `score = potProb·(wPot + wPos·posQuality)` `+ bonusCenter` (tip center) `+ bonusMidPower` (mức 2 hoặc 3) `− penMaxPower` (mức 5) `− penSide` (tip left/right) `− penExtraContact` (`cueTouched.length > 1`) `− penNearRail` (bi cái dừng cách đường mũi băng dưới `1.5R`); nhân `scratchPerturbFactor` nếu bi cái rơi lỗ ở lượt 0.9× hoặc 1.1×.
   - `stopZone` = vị trí dừng bi cái ở 3 lượt (bỏ lượt rơi lỗ).
3. Nếu `potProb` cao nhất ở bước 2 `< safetyThreshold` (hoặc không có cú nào): lặp lại bước 2 với tip `[left, right]` và gộp kết quả.
4. Chọn tối đa 3 cú theo `score` giảm dần, bỏ cú cùng lỗ có điểm dừng danh định của bi cái cách một cú đã chọn dưới `diversityDist`.
5. **Đánh thủ**, khi `potProb` cao nhất `< safetyThreshold`: thử độ dày chạm `f ∈ {−0.9, −0.6, −0.3, 0.3, 0.6, 0.9}` (điểm ngắm = tâm bi mục tiêu lệch ngang `f·2R` so với đường bi cái → bi mục tiêu) × mức lực 1–3 × tip center. Hợp lệ khi `firstContact === target`, `railAfterContact || pocketed.length > 0`, bi cái không rơi lỗ, bi mục tiêu không rơi lỗ. Điểm `= 0.6·hidden + 0.4·min(1, d/2.0)`, với `hidden = !pathClear(cueFinal, targetFinal, others)` và `d` là khoảng cách hai bi sau cú đánh. Thêm cú tốt nhất (`kind: 'safety'`) vào cuối danh sách, thay cú thứ 3 nếu đã đủ 3.
6. **Cú một băng**, khi không cú ăn bi nào và không cú đánh thủ hợp lệ nào (bi mục tiêu bị che): quét hướng 0°–359.5° bước 0.5° × mức lực 2 và 3, tip center, `stopAtFirstContact`. Giữ các hướng có `firstContact === target` và có ít nhất một sự kiện `cushion` của bi cái trước đó. Chọn hướng nằm giữa dải liên tiếp rộng nhất trong số các hướng ít băng nhất; mô phỏng đầy đủ và trả `kind: 'kick'`.

`explain`: ghép từ các mảnh, đúng với kết quả mô phỏng:
- pot: `"Đánh {tipLabel}, lực {powerLabel}. {cueSentence} {nextSentence}"`; `cueSentence` = `"Bi cái dừng gần chỗ chạm."` nếu bi cái đi dưới 0.15 m sau va chạm; `"Bi cái chạm {n} băng rồi dừng ở {zone}."` nếu có băng; ngược lại `"Bi cái lăn tới {zone}."` hoặc `"Bi cái lùi về {zone}."` (theo tích vô hướng với hướng đánh). `zone` ∈ `"giữa bàn" | "đầu bàn trái" | "đầu bàn phải"` theo x (chia ba) của điểm dừng. `nextSentence` = `"Ra bi {nextId}: {posLabel}."` hoặc `"Đây là bi cuối."`.
- safety: `"Đánh thủ: chạm {mỏng|dày} bi {id}, lực {powerLabel}. {Bi cái được che sau bi khác.|Hai bi cách xa nhau.}"`
- kick: `"Bi {id} bị che. Đánh {n} băng để chạm bi, lực {powerLabel}."`

- [ ] **Step 1:** Viết `advisor.test.ts` (`const A = (l: Layout) => advise(l, {cloth:'medium'})`):

```ts
test('no cue ball / no object ball', () => {
  expect(A(lay([1,1,0.5])).status).toBe('no-cue'); expect(A(lay([0,1,0.5])).status).toBe('no-target');
});
test('only suggests the lowest ball', () => {
  const r = A(lay([0,1.0,0.5],[2,2.2,1.0],[1,1.8,0.3],[5,0.4,0.9])); if (r.status !== 'ok') throw 0;
  expect(r.targetId).toBe(1); for (const s of r.suggestions) expect(s.targetId).toBe(1);
});
test('easy straight-in shot: first suggestion is a pot, labelled easy, no side spin', () => {
  const r = A(lay([0,1.9,0.8],[1,2.25,1.03],[2,1.0,0.4])); if (r.status !== 'ok') throw 0; const s = r.suggestions[0];
  expect(s.kind).toBe('pot'); expect(s.pocket).toBe('TR'); expect(s.potProb).toBeGreaterThan(0.7); expect(['center','high','low']).toContain(s.tipName);
  expect(s.sim.pocketed).toContainEqual({id:1, pocket:'TR'}); expect(s.sim.cueScratched).toBe(false);
});
test('never returns a shot whose nominal simulation scratches', () => {
  const r = A(lay([0,1.5,0.635],[1,2.3,0.635],[2,0.5,0.3])); if (r.status !== 'ok') throw 0;
  for (const s of r.suggestions) expect(s.sim.cueScratched).toBe(false);
});
test('at most 3 suggestions, sorted by score among pots, and distinct', () => {
  const r = A(lay([0,1.0,0.5],[1,1.6,0.7],[2,2.2,0.3])); if (r.status !== 'ok') throw 0;
  expect(r.suggestions.length).toBeLessThanOrEqual(3); const pots = r.suggestions.filter(s => s.kind === 'pot');
  for (let i = 1; i < pots.length; i++) expect(pots[i-1].score).toBeGreaterThanOrEqual(pots[i].score);
});
test('position matters: with two equally easy pockets the one leaving a shot on the next ball ranks first', () => {
  const r = A(lay([0,1.27,0.3],[1,1.27,0.635],[2,2.3,1.0])); if (r.status !== 'ok') throw 0;
  expect(r.suggestions[0].posQuality).toBeGreaterThanOrEqual(Math.max(...r.suggestions.filter(s => s.kind==='pot').map(s => s.posQuality)) - 0.15);
});
test('last ball: suggestions exist and posQuality is 1', () => {
  const r = A(lay([0,1.5,0.5],[9,2.2,1.0])); if (r.status !== 'ok') throw 0; expect(r.suggestions.length).toBeGreaterThan(0); expect(r.suggestions[0].posQuality).toBe(1);
});
test('hard shot adds a safety', () => {
  const r = A(lay([0,0.2,0.2],[1,1.27,1.2],[2,2.3,0.3])); if (r.status !== 'ok') throw 0;
  if (Math.max(0, ...r.suggestions.filter(s => s.kind==='pot').map(s => s.potProb)) < 0.35) expect(r.suggestions.some(s => s.kind === 'safety')).toBe(true);
});
test('fully snookered target yields a legal kick', () => {
  const r = A(lay([0,0.3,0.635],[1,1.0,0.635],[2,0.3+2*TABLE.R+0.02,0.635],[3,0.36,0.635+2*TABLE.R],[4,0.36,0.635-2*TABLE.R])); if (r.status !== 'ok') throw 0;
  const k = r.suggestions.find(s => s.kind === 'kick'); if (r.suggestions.every(s => s.kind !== 'pot' && s.kind !== 'safety')) { expect(k).toBeDefined(); expect(k!.sim.firstContact).toBe(1); }
});
test('side spin is absent when a no-side pot above 35% exists', () => {
  const r = A(lay([0,1.9,0.8],[1,2.25,1.03],[2,1.0,0.4])); if (r.status !== 'ok') throw 0;
  for (const s of r.suggestions) expect(['left','right']).not.toContain(s.tipName);
});
test('a 9-ball layout is advised in under 1 second', () => {
  const t = performance.now(); A(lay([0,1.0,0.5],[1,1.6,0.7],[2,2.2,0.3],[3,0.4,1.0],[4,0.9,0.2],[5,1.9,1.0],[6,2.3,0.7],[7,0.5,0.4],[8,1.4,1.1],[9,1.27,0.635])); expect(performance.now() - t).toBeLessThan(1000);
});
```

- [ ] **Step 2:** Viết `explain.test.ts`: kiểm tra đủ 6 tên lỗ, 5 nhãn lực, ngưỡng `potLabel(0.70) === 'Dễ'`, `potLabel(0.39) === 'Khó'`, `posLabel(0.6) === 'tốt'`; `explain` cho một gợi ý `pot` bi cuối chứa `"Đây là bi cuối."`; cho `kick` chứa `"bị che"`.
- [ ] **Step 3:** `npx vitest run src/core/advisor.test.ts src/core/explain.test.ts` — FAIL.
- [ ] **Step 4:** Viết `explain.ts` rồi `advisor.ts`.
- [ ] **Step 5:** Chạy lại — PASS. Nếu test thời gian không đạt: giảm số lượt bằng cách chỉ chạy lượt 0.9×/1.1× cho 12 cú có `potProb·` (điểm sơ bộ không tính vị trí) cao nhất.
- [ ] **Step 6:** `npx vitest run` toàn bộ — PASS. Commit `feat(core): shot advisor with safeties, kicks and Vietnamese explanations`.

---

### Task 7: Mã hóa thế bi và Web Worker

**Files:** Create `src/core/layoutCodec.ts`, `src/worker/advisor.worker.ts`, `src/worker/client.ts`; Test `src/core/layoutCodec.test.ts`, `src/worker/client.test.ts`

**Interfaces — Produces:**

```ts
// layoutCodec.ts — format: "m9;0:1270,635;1:1800,300"  (mode, then id:x_mm,y_mm)
export function encodeLayout(l: Layout): string;
export function decodeLayout(s: string): Layout;   // never throws
export function randomLayout(mode: GameMode, rng?: () => number): Layout; // all balls for the mode, legally placed
// client.ts
export type AdvisorClient = { request(layout: Layout, opts: AdviseOptions): void; dispose(): void };
export function createAdvisorClient(onResult: (r: AdviceResult, layout: Layout) => void, makeWorker?: () => Worker): AdvisorClient;
```

`decodeLayout`: chuỗi sai hoàn toàn → `{mode:'9', balls:[]}`. Bỏ qua mục không phân tích được, id không thuộc chế độ, id trùng (giữ mục đầu). Tọa độ ngoài bàn hoặc chồng bi được sửa bằng `placeBall` theo thứ tự xuất hiện.

Worker nhận `{seq, layout, opts}`, trả `{seq, result}`. `client.request` tăng `seq`; chỉ gọi `onResult` khi `seq` của phản hồi bằng `seq` mới nhất. Nếu đang có lượt tính dở khi `request` được gọi, `terminate()` worker cũ và tạo worker mới (để không xếp hàng các lượt tính lỗi thời).

- [ ] **Step 1:** Viết `layoutCodec.test.ts`:

```ts
test('round trip to the millimetre', () => { const l = {mode:'10' as const, balls:[{id:0,pos:v2(1.27,0.635)},{id:10,pos:v2(2.2,0.3)}]}; expect(decodeLayout(encodeLayout(l))).toEqual(l); });
test('garbage decodes to an empty 9-ball table', () => { for (const s of ['', '???', 'm7;0:a,b', 'm9;;;:', '%%%']) expect(decodeLayout(s)).toEqual({mode:'9', balls:[]}); });
test('bad entries are dropped, good ones kept', () => { expect(decodeLayout('m9;0:1270,635;10:500,500;1:x,2;2:900,400;2:100,100').balls.map(b => b.id)).toEqual([0,2]); });
test('out-of-table and overlapping positions are repaired', () => {
  const l = decodeLayout('m9;0:99999,-5;1:1000,500;2:1001,500');
  for (const b of l.balls) { expect(b.pos.x).toBeGreaterThanOrEqual(TABLE.R); expect(b.pos.x).toBeLessThanOrEqual(TABLE.L - TABLE.R); }
  expect(dist(l.balls[1].pos, l.balls[2].pos)).toBeGreaterThanOrEqual(2*TABLE.R);
});
test('randomLayout places every ball legally', () => { const l = randomLayout('10'); expect(l.balls).toHaveLength(11); /* pairwise distance >= 2R */ });
```

- [ ] **Step 2:** Viết `client.test.ts` với worker giả (đối tượng có `postMessage`, `terminate`, `onmessage`):

```ts
test('a stale result is dropped', () => { /* request(A); request(B); deliver result for seq 1 on the first fake worker, then seq 2 on the second; onResult called once, with layout B */ });
test('an in-flight worker is terminated when a new request arrives', () => { /* first fake worker's terminate() called exactly once */ });
```

- [ ] **Step 3:** `npx vitest run src/core/layoutCodec.test.ts src/worker` — FAIL.
- [ ] **Step 4:** Viết ba file. Worker tạo bằng `new Worker(new URL('./advisor.worker.ts', import.meta.url), { type: 'module' })`.
- [ ] **Step 5:** Chạy lại — PASS. Commit `feat: layout URL codec and cancellable advisor worker`.

---

### Task 8: Bàn tương tác (vẽ, kéo thả, khay bi)

**Files:** Create `src/ui/tableView.ts`, `src/ui/drag.ts`, `src/ui/tray.ts`, `src/ui/state.ts`, `src/style.css`; Modify `src/main.ts`, `index.html`; Test `src/ui/tableView.test.ts`, `src/ui/state.test.ts`

**Interfaces — Produces:**

```ts
// state.ts
export type AppState = { layout: Layout; cloth: ClothSpeed; advice: AdviceResult | null; selected: number; computing: boolean };
export type Store = { get(): AppState; subscribe(fn: (s: AppState) => void): () => void;
  setLayout(l: Layout): void;                 // persists to localStorage + location.hash, clears advice, triggers advisor (150 ms debounce)
  moveBall(id: number, wanted: Vec2): void; toggleBall(id: number): void; setMode(m: GameMode): void; setCloth(c: ClothSpeed): void; select(i: number): void };
export function createStore(client: AdvisorClient, storage?: Storage): Store;
// tableView.ts
export type ViewTransform = { toScreen(p: Vec2): Vec2; toTable(p: Vec2): Vec2; scale: number; portrait: boolean };
export function computeTransform(cssW: number, cssH: number): ViewTransform;  // table long axis along the longer side; 6% margin for rails
export function ballColor(id: number): { fill: string; stripe: boolean };
export function drawTable(ctx: CanvasRenderingContext2D, t: ViewTransform, s: AppState, overlayProgress?: { bodies: BallPos[] }): void;
```

Hành vi:
- `toggleBall`: bi chưa có → đặt ở vị trí mặc định (bi cái `(0.635, 0.635)`, bi số rải dọc `y = 0.635` từ `x = 1.2`, qua `placeBall`); bi đã có → gỡ.
- `setMode('9')` khi đang có bi 10 → gỡ bi 10.
- Khởi động: đọc `location.hash` (ưu tiên) rồi `localStorage['billiard-coach:v1']`; không có gì → bàn mẫu `m9;0:635,635;1:1700,800;2:2100,400;3:900,300`.
- Vẽ: nỉ xanh, băng, 6 lỗ, 18 điểm kim cương, bi theo màu pool chuẩn (1 vàng, 2 xanh dương, 3 đỏ, 4 tím, 5 cam, 6 xanh lá, 7 nâu đỏ, 8 đen, 9 vàng sọc, 10 xanh dương sọc), số trên bi. Bi mục tiêu có vòng sáng. Canvas vẽ theo `devicePixelRatio`.
- Kéo (`pointer events`, `touch-action: none`): chọn bi gần nhất trong bán kính `max(R·scale, 22 px)`; trong lúc kéo vẽ kính lúp 2.5× đường kính 96 px phía trên ngón tay 70 px (lật xuống dưới khi sát mép trên); thả ngoài canvas → gỡ bi. Mỗi lần di chuyển gọi `moveBall`.
- Khay: nút tròn cho bi cái và các bi của chế độ (mờ khi không có trên bàn); chọn chế độ 9 bi / 10 bi; "Xóa bàn"; "Ngẫu nhiên"; chọn nỉ "Nhanh / Vừa / Chậm" (mặc định Vừa). Vùng chạm tối thiểu 44 px.
- Bố cục theo spec mục 4: dọc — bàn trên, khay, rồi vùng thẻ; ngang (`orientation: landscape` và rộng ≥ 700 px) — bàn + khay bên trái, thẻ bên phải 320 px.

- [ ] **Step 1:** Viết test:

```ts
// tableView.test.ts
test('portrait puts the table long axis vertical and round-trips', () => {
  const t = computeTransform(390, 700); expect(t.portrait).toBe(true); const p = v2(1.9, 0.4); const q = t.toTable(t.toScreen(p)); expect(q.x).toBeCloseTo(p.x, 6); expect(q.y).toBeCloseTo(p.y, 6);
  const a = t.toScreen(v2(0,0.635)), b = t.toScreen(v2(2.54,0.635)); expect(Math.abs(a.y - b.y)).toBeGreaterThan(Math.abs(a.x - b.x));
});
test('landscape keeps it horizontal and fits inside the canvas', () => { const t = computeTransform(900, 420); expect(t.portrait).toBe(false); const c = t.toScreen(v2(2.54,1.27)); expect(c.x).toBeLessThanOrEqual(900); expect(c.y).toBeLessThanOrEqual(420); });
test('9 and 10 are stripes', () => { expect(ballColor(9).stripe).toBe(true); expect(ballColor(10).stripe).toBe(true); expect(ballColor(8).stripe).toBe(false); });
// state.test.ts (fake AdvisorClient recording requests, fake Storage, vi.useFakeTimers)
test('moving a ball clears advice, persists, and requests advice once after 150 ms', () => { /* three moveBall calls within 100 ms -> exactly one client.request after timers advance 150 ms; storage has encodeLayout(layout) */ });
test('a result for an older layout is ignored', () => { /* deliver onResult with a layout that differs from store.get().layout -> advice stays null */ });
test('switching to 9-ball removes the 10', () => { /* layout m10 with ball 10 -> setMode('9') -> no id 10 */ });
test('toggleBall adds at a legal default spot and removes on second call', () => {});
```

- [ ] **Step 2:** `npx vitest run src/ui` — FAIL.
- [ ] **Step 3:** Viết các file. `main.ts` tạo client, store, canvas, khay; vẽ lại khi state đổi và khi `resize`.
- [ ] **Step 4:** `npx vitest run` — PASS; `npm run build` — không lỗi.
- [ ] **Step 5:** `npm run dev`, mở ở khung 390×844: đặt, kéo, gỡ bi được; kính lúp hiện; tải lại trang giữ nguyên thế bi; xoay ngang bố cục đổi.
- [ ] **Step 6:** Commit `feat(ui): interactive table, drag with magnifier, ball tray, persistence`.

---

### Task 9: Thẻ gợi ý, lớp phủ trên bàn, xem lại

**Files:** Create `src/ui/cards.ts`, `src/ui/replay.ts`; Modify `src/ui/tableView.ts`, `src/main.ts`, `src/style.css`; Test `src/ui/cards.test.ts`, `src/ui/replay.test.ts`

**Interfaces — Consumes:** `Store`, `Suggestion`, `explain.ts` labels. **Produces:**

```ts
// cards.ts
export function cardTitle(s: Suggestion): string;   // pot: 'Bi 3 vào lỗ góc trên phải'; safety: 'Đánh thủ bi 3'; kick: 'Một băng chạm bi 3'
export function statusMessage(a: AdviceResult | null, computing: boolean): string | null;
// 'Đang tính…' | 'Đặt bi cái lên bàn để nhận gợi ý.' | 'Đặt ít nhất một bi số lên bàn.' | 'Không tìm được cú đánh hợp lệ. Thử chỉnh lại vị trí bi.' | null
export function renderCards(root: HTMLElement, s: AppState, onSelect: (i: number) => void, onReplay: () => void): void;
// replay.ts
export function sampleAt(sim: SimResult, start: BallPos[], t: number): BallPos[];  // positions at time t, interpolated along paths; pocketed balls disappear at their pocket event
export function simDuration(sim: SimResult): number;
```

Hành vi:
- Thẻ: tiêu đề; nhãn "Nên đánh" trên thẻ đầu; hình đầu cơ SVG (vòng tròn 44 px, chấm tại `tip.side`, `tip.vert`); thanh lực 5 nấc + `powerLabel`; với `pot`: `"Ăn bi: {round(potProb·100)}% · {potLabel}"` và `"Ra bi: {posLabel}"`; câu `text`. Thẻ đang chọn có viền nổi. Thẻ đầu được chọn sẵn khi có kết quả mới.
- Lớp phủ cho gợi ý đang chọn (thêm vào `drawTable`): đường ngắm từ bi cái đến `ghost` (nét liền trắng); vòng tròn bi ma (nét đứt); đường bi mục tiêu `sim.paths[targetId]` (màu bi); đường bi cái sau va chạm `sim.paths[0]` (nét đứt trắng); vùng dừng = bao lồi của `stopZone` nới thêm `R`, tô trắng mờ 25%; bi cái mờ tại điểm dừng danh định.
- Dưới vùng thẻ, một dòng chữ nhỏ cố định: `"Đường bi là ước lượng. Nỉ và băng mỗi bàn một khác."`
- "Xem lại": chạy `sampleAt` theo `requestAnimationFrame` với tốc độ thật, tối đa 6 giây (nhanh hơn nếu `simDuration` dài hơn); kéo bi trong lúc xem lại thì dừng ngay.

- [ ] **Step 1:** Viết test:

```ts
// cards.test.ts
test('titles', () => { expect(cardTitle({kind:'pot', targetId:3, pocket:'TR'} as Suggestion)).toBe('Bi 3 vào lỗ góc trên phải'); expect(cardTitle({kind:'safety', targetId:3} as Suggestion)).toBe('Đánh thủ bi 3'); expect(cardTitle({kind:'kick', targetId:3} as Suggestion)).toBe('Một băng chạm bi 3'); });
test('status messages', () => {
  expect(statusMessage(null, true)).toBe('Đang tính…'); expect(statusMessage({status:'no-cue'}, false)).toBe('Đặt bi cái lên bàn để nhận gợi ý.');
  expect(statusMessage({status:'no-target'}, false)).toBe('Đặt ít nhất một bi số lên bàn.'); expect(statusMessage({status:'ok', targetId:1, suggestions:[]}, false)).toBe('Không tìm được cú đánh hợp lệ. Thử chỉnh lại vị trí bi.');
});
// replay.test.ts — use a real simulate() of the Task 4 `std` stop shot
test('sampleAt(0) equals the start layout; sampleAt(duration) equals sim.final', () => {});
test('a pocketed ball is absent after its pocket event', () => {});
```

- [ ] **Step 2:** `npx vitest run src/ui` — FAIL.
- [ ] **Step 3:** Viết `cards.ts`, `replay.ts`, mở rộng `drawTable`, nối vào `main.ts`.
- [ ] **Step 4:** `npx vitest run` — PASS; `npm run build` — không lỗi.
- [ ] **Step 5:** Kiểm tra trên trình duyệt ở 390×844 và 844×390 với ba thế: bàn mẫu; `#m9;0:300,635;1:1000,635;2:414,635` (bi bị che một phần); `#m9;0:1500,500;9:2200,1000` (bi cuối). Với mỗi thế: thẻ hiện trong dưới 1 giây; đường vẽ khớp với "Xem lại"; đổi thẻ đổi lớp phủ; kéo bi làm thẻ cập nhật; không lỗi trong console.
- [ ] **Step 6:** Commit `feat(ui): suggestion cards, table overlay, shot replay`.

---

### Task 10: Hiệu chỉnh với các thế bi quen thuộc

**Files:** Create `src/core/scenarios.test.ts`; Modify `src/core/config.ts` (chỉ khi cần)

- [ ] **Step 1:** Viết `scenarios.test.ts` — các thế mà người chơi nào cũng biết đáp án:

```ts
test('straight-in with the next ball straight behind: recommends follow or centre, not draw at max power', () => {});
test('object ball near a side pocket, next ball at the far end: cue ball ends in the far third of the table for the top suggestion', () => {});
test('cue ball and object ball lined up to scratch in the corner with follow: top suggestion is not TIPS.high', () => {});
test('thin cut at long distance with an easy alternative pocket: top suggestion uses the easier pocket', () => {});
test('across 200 seeded random layouts: advise never throws, every pot suggestion pockets its target in its nominal sim, and none scratches', () => {});
test('across the same 200 layouts: median advise time under 400 ms, max under 1000 ms', () => {});
```

Viết mỗi test với một thế bi cụ thể (tọa độ rõ ràng) dựng đúng tình huống mô tả.

- [ ] **Step 2:** `npx vitest run src/core/scenarios.test.ts`. Với test không đạt: xem kết quả mô phỏng, quyết định lỗi nằm ở mô hình hay ở trọng số `SCORE`, sửa ở `config.ts` hoặc mô-đun tương ứng. Không sửa thế bi trong test để cho qua.
- [ ] **Step 3:** `npx vitest run` toàn bộ — PASS; `npm run build` — không lỗi.
- [ ] **Step 4:** Commit `test: familiar-position scenarios and tuning`.
