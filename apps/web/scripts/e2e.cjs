// End-to-end smoke test: the learning path (lesson, engine-checked
// prediction, practice level round-trip), then plays level 1 through the
// real UI (drag & drop, wiring, scoring, leaderboard), the sandbox
// (particles, request trace), and the capacity tools.
// Needs `pnpm dev` (5173) and, for the leaderboard step, `pnpm dev:server`.
// Usage: node apps/web/scripts/e2e.cjs [screenshot-dir]
const { chromium } = require('playwright');

const URL = process.env.E2E_URL ?? 'http://localhost:5173';
const shots = process.argv[2];
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const shot = (name) => shots && page.screenshot({ path: `${shots}/${name}.png` });

  await page.goto(URL);

  // 0. learning path: the default tab
  await page.getByText('Phần 7 · Nâng cao').waitFor();
  check('learning path shows 7 units', (await page.getByText(/^Phần \d · /).count()) === 7);
  await shot('0-learn-path');
  await page.getByLabel('Tôi biết rồi, mở khoá tất cả').click();
  await page.getByRole('button', { name: 'Độ trễ', exact: true }).click();
  await page.getByRole('button', { name: 'Bắt đầu', exact: true }).click();
  await page.getByRole('button', { name: 'Tiếp tục' }).click();
  await page.getByText('50 ms', { exact: true }).click();
  await page.getByRole('button', { name: 'Kiểm tra' }).click();
  await page.getByRole('button', { name: 'Tiếp tục' }).click();
  await page.getByText('khoảng 50 ms').click();
  await page.getByRole('button', { name: 'Chạy mô phỏng' }).click();
  const verdict = page.getByText(/Simulator đo được p50 = /);
  await verdict.waitFor({ timeout: 15000 });
  check('prediction is checked by the engine', (await page.getByText('Chính xác!').count()) === 1, await verdict.textContent());
  await shot('0-learn-predict');
  await page.getByRole('button', { name: 'Tiếp tục' }).click();
  await page.getByText('Hoàn thành bài học!').waitFor();
  await page.getByRole('button', { name: 'Tiếp tục' }).click();
  const xp = async () => Number(await page.locator('text=tổng XP').locator('..').locator('div').first().innerText());
  const xpBefore = await xp();
  await page.getByRole('button', { name: 'Thực hành: trang sản phẩm' }).click();
  await page.getByRole('button', { name: 'Vào thực hành' }).click();
  await page.getByRole('button', { name: 'Mở bài thực hành' }).click();
  await page.waitForSelector('.react-flow__node');
  await page.locator('.react-flow__node', { hasText: 'Product page' }).click();
  await page.getByRole('radio', { name: /Song song/ }).click();
  await page.getByRole('tab', { name: 'Level' }).click();
  await page.getByRole('button', { name: /Chấm điểm/ }).click();
  await page.getByRole('button', { name: /Về lộ trình/ }).click({ timeout: 20000 });
  await page.getByText('tổng XP').waitFor();
  const xpAfter = await xp();
  check('practice level completes the lesson', xpAfter >= xpBefore + 20, `${xpBefore} -> ${xpAfter} XP`);

  await page.getByRole('tab', { name: /Game/ }).click();
  await page.waitForSelector('.react-flow__node', { hasText: 'PostgreSQL' });
  await page.waitForTimeout(800);
  await shot('1-level-start');

  const node = (label) => page.locator('.react-flow__node', { hasText: label });
  const verify = async () => {
    await page.getByRole('button', { name: /Chấm điểm/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    const stars = await dialog.locator('svg.fill-warning').count();
    return { dialog, stars };
  };

  // 1. the starting design must lose
  let { dialog, stars } = await verify();
  check('starting design scores 0 stars', stars === 0, `${stars}`);
  await shot('2-result-fail');
  await dialog.getByRole('button', { name: 'Đóng' }).first().click();

  // 2. drag a cache from the palette onto the canvas
  const pane = page.locator('.react-flow__pane');
  const box = await pane.boundingBox();
  await page.getByText('Cache', { exact: true }).dragTo(pane, {
    targetPosition: { x: box.width * 0.55, y: box.height * 0.75 },
  });
  await page.waitForTimeout(300);
  check('cache node added by drag & drop', (await node('Cache').count()) === 1);

  // 3. rewire: delete API -> DB, connect API -> Cache -> DB
  const mid = await page.evaluate(() => {
    const path = document.querySelectorAll('.react-flow__edge-interaction')[1];
    const p = path.getPointAtLength(path.getTotalLength() / 2);
    const m = path.getScreenCTM();
    return { x: p.x * m.a + m.e, y: p.y * m.d + m.f };
  });
  await page.mouse.click(mid.x, mid.y);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(200);
  check('edge deleted', (await page.locator('.react-flow__edge').count()) === 1);
  const connect = async (from, to) => {
    const a = await node(from).locator('.react-flow__handle.source').boundingBox();
    const b = await node(to).locator('.react-flow__handle.target').boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(200);
  };
  await connect('API', 'Cache');
  await connect('Cache', 'PostgreSQL');
  check('edges connected', (await page.locator('.react-flow__edge').count()) === 3);

  // 4. play a few seconds at 8x: metrics and particles must show up
  await page.getByRole('combobox').nth(1).click();
  await page.getByRole('option', { name: '8×' }).click();
  await page.getByRole('button', { name: 'Chạy' }).click();
  await page.waitForTimeout(2500);
  const live = await page.evaluate(() => window.__particles?.liveParticles ?? 0);
  check('particles are rendered', live > 50, `${live} live`);
  await page.getByRole('tab', { name: 'Số liệu' }).click();
  await shot('3-level-playing');

  // 5. the rewired design wins
  await page.getByRole('tab', { name: 'Level' }).click();
  ({ dialog, stars } = await verify());
  check('cache-aside design scores 3 stars', stars === 3, `${stars}`);
  await shot('4-result-win');
  await dialog.getByRole('button', { name: 'Đóng' }).first().click();

  // 6. leaderboard (server re-scores the design)
  await page.getByPlaceholder('Tên của bạn').fill('e2e-bot');
  await page.getByRole('button', { name: 'Gửi' }).click();
  const status = page.getByText(/Server chấm|Không kết nối|Lỗi/);
  await status.waitFor({ timeout: 10000 });
  const text = await status.textContent();
  check('server agrees on the score', /Server chấm 3★/.test(text), text);
  await page.waitForTimeout(300);
  await shot('5-leaderboard');

  // 7. sandbox: retry storm preset with scripted traffic and chaos
  await page.getByRole('tab', { name: 'Sandbox' }).click();
  await page.getByRole('combobox').first().click();
  await page.getByRole('option', { name: 'Retry storm' }).click();
  await page.getByRole('switch').first().click(); // scripted traffic
  await page.getByRole('button', { name: 'Chạy' }).click();
  await page.waitForTimeout(4500);
  const retryOpen = await page.locator('text=↻ 3').count();
  check('edge shows retry policy badge', retryOpen > 0);
  await shot('6-sandbox-retry-storm');

  // 7b. sandbox: follow one request of the checkout fan-out
  await page.getByRole('combobox').first().click();
  await page.getByRole('option', { name: /Checkout/ }).click();
  await page.waitForTimeout(500);
  check('sequence steps are numbered on the edges', (await page.locator('text=②').count()) >= 2);
  await page.getByRole('button', { name: 'Chạy' }).click();
  await page.getByRole('tab', { name: 'Trace' }).click();
  await page.getByRole('button', { name: /Theo dõi 1 request/ }).click();
  await page.getByText('Diễn biến').waitFor({ timeout: 10000 });
  const story = (await page.locator('pre').innerText()) ?? '';
  check(
    'trace shows the call order (parallel step, fire-and-forget)',
    /song song/.test(story) && /không chờ/.test(story),
    story.split('\n').length + ' lines',
  );
  await shot('6b-trace');

  // 7c. side panel: drag to resize, expand to full size, Esc to dock again
  const panel = page.locator('aside').last();
  const before = (await panel.boundingBox()).width;
  const grip = await page.getByRole('separator').boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 200);
  await page.mouse.down();
  await page.mouse.move(grip.x - 250, grip.y + 200, { steps: 8 });
  await page.mouse.up();
  const dragged = (await panel.boundingBox()).width;
  check('panel resizes by dragging its edge', dragged > before + 200, `${before} -> ${dragged}px`);
  await page.getByRole('button', { name: 'Mở rộng panel' }).click();
  const full = (await panel.boundingBox()).width;
  await page.keyboard.press('Escape');
  const docked = (await panel.boundingBox()).width;
  check('panel expands to full size and Esc docks it', full >= 1200 && Math.abs(docked - dragged) < 2, `${full}px, back to ${docked}px`);
  await page.getByRole('separator').dblclick(); // reset for later screenshots

  // 8. capacity: sizing wizard, open the recommendation in the sandbox
  await page.getByRole('tab', { name: 'Công suất' }).click();
  await page.getByText('Biết rps cao điểm').click();
  await page.locator('label:has-text("RPS cao điểm") + div input').fill('700');
  await page.getByRole('button', { name: 'Tính và mô phỏng' }).click();
  await page.getByText('Đề xuất (rẻ nhất').waitFor({ timeout: 60000 });
  const passing = await page.locator('table tr:has-text("✔ Cao điểm")').count();
  check('sizing recommends a plan that passes the peak check', passing > 0);
  await shot('7-sizing');
  await page.getByRole('button', { name: 'Mở trong Sandbox' }).click();
  await page.getByRole('button', { name: 'Chạy' }).click();
  await page.waitForTimeout(3000);
  const poolBadge = await page.locator('text=/^pool \\d+/').count();
  check('sizing design opens in the sandbox with a pooled DB edge', (await node('app').count()) === 1 && poolBadge > 0);

  // 9. capacity: calibrate the bundled real measurements
  await page.getByRole('tab', { name: 'Công suất' }).click();
  await page.getByRole('tab', { name: 'Hiệu chỉnh từ k6' }).click();
  await page.getByRole('button', { name: 'Hiệu chỉnh', exact: true }).click();
  await page.getByText('Tham số đã fit').waitFor({ timeout: 120000 });
  const cap = Number(((await page.getByText(/^~\d+ rps$/).first().textContent()) ?? '').replace(/\D/g, ''));
  check('calibration predicts a capacity near the measured knee', cap > 1800 && cap < 3200, `~${cap} rps`);
  await shot('8-calibrate');

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
