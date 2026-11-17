// End-to-end smoke test: plays level 1 through the real UI (drag & drop,
// wiring, scoring, leaderboard) and checks the sandbox renders particles.
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
  await page.waitForSelector('.react-flow__node');
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

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
