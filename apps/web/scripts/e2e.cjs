// End-to-end smoke test: the learning path (lesson, engine-checked
// prediction, practice level round-trip), then plays level 1 through the
// real UI (drag & drop, wiring, scoring, leaderboard), the sandbox
// (particles, request trace), the capacity tools and Studio projects
// (autosave, reload, version history, share links).
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 860 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const shot = (name) => shots && page.screenshot({ path: `${shots}/${name}.png` });
  // count IndexedDB writes of Studio projects (autosave regression checks)
  await page.addInitScript(() => {
    window.__projectPuts = [];
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'projects') window.__projectPuts.push({ t: performance.now(), updatedAt: value?.updatedAt, run: value?.lastRun?.simSeconds });
      return put.call(this, value, key);
    };
  });
  /** Sandbox opens on the Studio home: create a project from a template. */
  const openTemplate = async (title) => {
    await page.getByRole('tab', { name: 'Sandbox' }).click();
    const back = page.getByRole('button', { name: 'Dự án', exact: true });
    if (await back.count()) await back.click();
    await page.getByRole('tab', { name: 'Mẫu' }).click();
    await page
      .locator('button', { hasText: 'Tạo dự án từ mẫu này' })
      .filter({ has: page.getByText(title, { exact: true }) })
      .click();
    await page.waitForSelector('.react-flow__node');
    await page.waitForTimeout(300);
  };
  const setSpeed = async (label) => {
    await page.locator('button[role=combobox]', { hasText: /×$/ }).click();
    await page.getByRole('option', { name: label, exact: true }).click();
  };
  const simSeconds = async () => Number(((await page.getByText(/^t = \d+s$/).textContent()) ?? '').replace(/\D/g, ''));

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

  // 7. sandbox: retry storm template with scripted traffic and chaos
  await openTemplate('Retry storm');
  await page.getByRole('switch').first().click(); // scripted traffic
  await page.getByRole('button', { name: 'Chạy' }).click();
  await page.waitForTimeout(4500);
  const retryOpen = await page.locator('text=↻ 3').count();
  check('edge shows retry policy badge', retryOpen > 0);
  await shot('6-sandbox-retry-storm');

  // 7b. sandbox: follow one request of the checkout fan-out
  await page.getByRole('button', { name: 'Dừng' }).click();
  await openTemplate('Checkout: tuần tự, song song, fire-and-forget');
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

  // 9. fix-the-design card on the mini canvas (+ pop-out), and spaced repetition
  await page.evaluate(() =>
    localStorage.setItem('pattern.learn.v1', JSON.stringify({ done: {}, xp: 0, days: {}, unlockAll: true, review: {} })),
  );
  await page.reload();
  await page.getByRole('button', { name: 'Gọi song song' }).click();
  await page.getByRole('button', { name: 'Bắt đầu', exact: true }).click();
  let missed = false;
  for (let i = 0; i < 12 && !(await page.getByText('Sửa design, simulator chấm').count()); i++) {
    const cont = page.getByRole('button', { name: 'Tiếp tục' });
    if (await cont.count()) {
      await cont.click();
      continue;
    }
    if (await page.getByText('Bấm các bước bên dưới theo thứ tự…').count()) {
      for (const t of ['Gọi Auth và chờ', 'Gọi Kho và Giá cùng lúc', 'Chờ cả Kho và Giá trả lời', 'Gọi Thanh toán'])
        await page.getByRole('button', { name: t }).click();
    } else {
      await page.locator('button.w-full.rounded-xl').nth(missed ? 1 : 0).click(); // miss the first question on purpose
      missed = true;
    }
    await page.getByRole('button', { name: 'Kiểm tra' }).click();
    await page.getByRole('button', { name: 'Tiếp tục' }).click();
  }
  await page.getByRole('button', { name: '∥ Song song' }).click();
  await page.getByRole('button', { name: 'Tách ra toàn màn hình' }).click();
  const popped = await page.locator('[data-popout]').count();
  await page.getByRole('button', { name: /Chạy thử/ }).click();
  await page.getByText('Các lần chạy').waitFor();
  await shot('9-fix-popout');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Kiểm tra' }).click();
  await page.getByText(/Chính xác!|Chưa đúng/).waitFor({ timeout: 15000 });
  check('fix card: popped out, parallel meets the goal', popped === 1 && (await page.getByText('Chính xác!').count()) === 1);
  for (let i = 0; i < 6 && !(await page.getByText('Hoàn thành bài học!').count()); i++) {
    const cont = page.getByRole('button', { name: 'Tiếp tục' });
    if (await cont.count()) {
      await cont.click();
      continue;
    }
    await page.locator('button.w-full.rounded-xl').nth(1).click();
    await page.getByRole('button', { name: 'Kiểm tra' }).click();
  }
  await page.getByRole('button', { name: 'Tiếp tục' }).click();
  const deck = JSON.parse(await page.evaluate(() => localStorage.getItem('pattern.learn.v1'))).review;
  check('missed question is scheduled for review tomorrow', deck['u2-parallel#1']?.box === 0, JSON.stringify(deck));
  await page.getByRole('button', { name: 'Ôn sớm các câu yếu nhất' }).click();
  await page.locator('button.w-full.rounded-xl').nth(1).click();
  await page.getByRole('button', { name: 'Kiểm tra' }).click();
  const after = JSON.parse(await page.evaluate(() => localStorage.getItem('pattern.learn.v1'))).review;
  check('a right answer in review moves the card up a box', after['u2-parallel#1']?.box === 1, JSON.stringify(after));

  // 10. trace: pin a request, switch Checkout to parallel, compare before/after
  await openTemplate('Checkout: tuần tự, song song, fire-and-forget');
  await page.getByRole('button', { name: 'Chạy' }).click();
  await page.getByRole('tab', { name: 'Trace' }).click();
  await page.getByRole('button', { name: /Theo dõi 1 request/ }).click();
  await page.getByText('Diễn biến').waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'Ghim làm mốc' }).click();
  await page.locator('.react-flow__node', { hasText: 'Checkout' }).first().click();
  await page.getByRole('radio', { name: '∥ Song song' }).click();
  await page.getByRole('button', { name: 'Áp dụng và chạy lại' }).first().click();
  await page.getByRole('tab', { name: 'Trace' }).click();
  await page.getByRole('button', { name: /Theo dõi 1 request/ }).click();
  const head = page.getByText('So sánh trước / sau ·');
  await head.waitFor({ timeout: 10000 });
  const title = (await head.innerText()).replace(/\s+/g, ' ');
  check('trace compare: parallel checkout is faster than the pinned one', /−\d/.test(title), title);
  await shot('10-trace-compare');

  // 11. studio: past the 120 s metrics history, the run snapshot must not write
  // every tick, and autosave must still go through while the simulation runs
  await page.getByRole('button', { name: 'Dừng' }).click();
  await openTemplate('Không cache: DB là nút thắt');
  await setSpeed('8×');
  await page.getByRole('button', { name: 'Chạy' }).click();
  for (let i = 0; i < 120 && (await simSeconds()) < 125; i++) await page.waitForTimeout(500);
  const putsSince = (t) => page.evaluate((t) => window.__projectPuts.filter((p) => p.t > t), t);
  let t0 = await page.evaluate(() => performance.now());
  await page.waitForTimeout(3000);
  // judge by the simulated time inside each snapshot: the `t =` label lags when the main thread is busy
  const runs = (await putsSince(t0)).map((p) => p.run).filter((r) => r !== undefined);
  const gaps = runs.slice(1).map((r, i) => r - runs[i]);
  check(
    'run snapshot is saved every 5 simulated seconds, not every tick',
    runs.length >= 2 && gaps.every((g) => g >= 5 || g < 0),
    `snapshots at ${runs.join(', ')} s`,
  );
  const moved = page.locator('.react-flow__node', { hasText: 'PostgreSQL' }).first();
  const nb = await moved.boundingBox();
  t0 = await page.evaluate(() => performance.now());
  await page.mouse.move(nb.x + 30, nb.y + 20);
  await page.mouse.down();
  await page.mouse.move(nb.x + 130, nb.y + 100, { steps: 6 });
  await page.mouse.up();
  // at 8× the main thread is busy: the 800 ms debounce can take a few seconds of wall time
  await page.getByText('Đang lưu…').waitFor({ timeout: 5000 }).catch(() => {});
  await page.getByText('Đã lưu', { exact: true }).waitFor({ timeout: 30000 }).catch(() => {});
  const stamps = new Set((await putsSince(t0)).map((p) => p.updatedAt));
  check('autosave goes through while the simulation runs', stamps.size >= 1 && (await page.getByText('Đã lưu').count()) > 0, `${stamps.size} new versions | ${(await page.locator('header').innerText()).replace(/\s+/g, ' ')}`);
  await page.getByRole('button', { name: 'Dừng' }).click();

  // 12. studio: the edit survives a reload, version history restores the original
  const storedX = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const open = indexedDB.open('pattern-studio');
          open.onsuccess = () => {
            const all = open.result.transaction('projects').objectStore('projects').getAll();
            all.onsuccess = () => {
              const p = all.result.sort((a, b) => b.updatedAt - a.updatedAt)[0];
              resolve(p.design.nodes.find((n) => n.label === 'PostgreSQL')?.position.x);
            };
          };
        }),
    );
  // position on the canvas, in flow coordinates (independent of zoom / fitView); saved rounded
  const flowX = async () =>
    Number(
      (await page.locator('.react-flow__node', { hasText: 'PostgreSQL' }).first().getAttribute('style')).match(
        /translate\(([-\d.]+)px/,
      )[1],
    );
  const movedX = await flowX();
  const savedX = await storedX();
  await page.reload();
  await page.getByRole('tab', { name: 'Sandbox' }).click();
  await page.getByText('Không cache: DB là nút thắt').first().click();
  await page.waitForSelector('.react-flow__node');
  await page.waitForTimeout(500);
  const reloadedX = await flowX();
  check('the moved node is saved and still there after a reload', Math.abs(savedX - movedX) < 1 && reloadedX === savedX, `${movedX} / saved ${savedX} / reloaded ${reloadedX}`);
  await page.getByLabel('Lịch sử phiên bản').click();
  await page.getByRole('dialog').getByText('Tạo dự án').first().click();
  await page.getByRole('button', { name: /Khôi phục phiên bản này/ }).click();
  await page.waitForTimeout(1200);
  const restoredX = await flowX();
  check('restoring the first version puts the node back', Math.abs(restoredX - movedX) > 50 && Math.abs((await storedX()) - restoredX) < 1, `${movedX} -> ${restoredX}`);
  await shot('11-studio');

  // 12b. two tabs on the same project: the other tab's save is detected, nothing is lost silently
  const tab2 = await page.context().newPage();
  tab2.on('pageerror', (e) => errors.push(`tab2: ${e.message}`));
  await tab2.goto(URL);
  await tab2.getByRole('tab', { name: 'Sandbox' }).click();
  await tab2.getByText('Không cache: DB là nút thắt').first().click();
  await tab2.waitForSelector('.react-flow__node');
  await tab2.getByTitle('Bấm để đổi tên').click();
  await tab2.keyboard.press('Control+A');
  await tab2.keyboard.type('Đổi tên ở tab 2');
  await tab2.keyboard.press('Enter');
  const banner = page.getByRole('alert').filter({ hasText: 'vừa được sửa ở một tab khác' });
  await banner.waitFor({ timeout: 5000 });
  check('the first tab warns as soon as the other tab saves', true);
  await banner.getByRole('button', { name: 'Tải bản mới nhất' }).click();
  await page.getByTitle('Bấm để đổi tên').filter({ hasText: 'Đổi tên ở tab 2' }).waitFor();
  check('loading the newest copy picks up the other tab', (await banner.count()) === 0);

  // now both tabs edit: tab 2 moves a node, tab 1 keeps its own edit
  const dragNode = async (p, dx) => {
    const box = await p.locator('.react-flow__node', { hasText: 'PostgreSQL' }).first().boundingBox();
    await p.mouse.move(box.x + box.width / 2, box.y + 10);
    await p.mouse.down();
    await p.mouse.move(box.x + box.width / 2 + dx, box.y + 10, { steps: 8 });
    await p.mouse.up();
  };
  await dragNode(tab2, -120);
  await tab2.getByText('Đã lưu', { exact: true }).waitFor();
  await banner.waitFor({ timeout: 5000 });
  await dragNode(page, 150);
  await page.waitForTimeout(1200);
  check(
    'this tab does not overwrite while the conflict is open',
    (await page.getByText('Chưa lưu: xung đột').count()) === 1 && Math.abs((await storedX()) - (await flowX())) > 100,
  );
  await banner.getByRole('button', { name: 'Giữ bản của tab này' }).click();
  await page.getByText(/Đã ghi đè/).waitFor();
  const keptX = await flowX();
  check('keeping this tab writes its canvas', Math.abs((await storedX()) - keptX) < 1, `${keptX} vs ${await storedX()}`);
  await page.getByLabel('Lịch sử phiên bản').click();
  check('the overwritten copy stays in the history', (await page.getByRole('dialog').getByText('Bản từ tab khác (trước khi ghi đè)').count()) === 1);
  await page.keyboard.press('Escape');
  await tab2.close();

  // 12c. undo / redo: one step per settled drag, deletes come back
  await page.waitForTimeout(500);
  const x0 = await flowX();
  // leftwards: near the right edge React Flow auto-pans and the node jumps
  await dragNode(page, -80);
  await page.waitForTimeout(700);
  const x1 = await flowX();
  await dragNode(page, -80);
  await page.waitForTimeout(700);
  const x2 = await flowX();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  const u1 = await flowX();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  const u2 = await flowX();
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(300);
  const r1 = await flowX();
  check('undo walks back one drag at a time, redo forward', x2 < x1 - 40 && x1 < x0 - 40 && [u1 - x1, u2 - x0, r1 - x1].every((d) => Math.abs(d) < 1), `${x0} ${x1} ${x2} -> ${u1} ${u2} -> ${r1}`);
  const pgNodes = () => page.locator('.react-flow__node', { hasText: 'PostgreSQL' }).count();
  await page.locator('.react-flow__node', { hasText: 'PostgreSQL' }).first().click();
  await page.keyboard.press('Delete');
  await page.waitForTimeout(300);
  const afterDelete = await pgNodes();
  await page.getByLabel('Hoàn tác').click();
  await page.waitForTimeout(300);
  check('undo brings a deleted node (and its edges) back', afterDelete === 0 && (await pgNodes()) === 1 && (await page.locator('.react-flow__edge').count()) >= 3);
  await page.waitForTimeout(1200);
  check('the undone design is autosaved', Math.abs((await storedX()) - r1) < 1, `${await storedX()} vs ${r1}`);

  // 12d. compare: scale the DB, simulate the first version next to the canvas
  await page.locator('.react-flow__node', { hasText: 'PostgreSQL' }).first().click();
  await page.getByRole('tab', { name: 'Thuộc tính' }).click();
  const instancesInput = page.getByText('Instances (server)', { exact: true }).locator('xpath=..').locator('input');
  const dbInstances = Number(await instancesInput.inputValue());
  await instancesInput.fill(String(dbInstances + 2));
  const apply = page.getByRole('button', { name: 'Áp dụng và chạy lại' }).first();
  if (await apply.isVisible().catch(() => false)) await apply.click();
  await page.waitForTimeout(500);
  await page.getByLabel('Lịch sử phiên bản').click();
  await page.getByRole('dialog').getByText('Tạo dự án').first().click();
  await page.getByRole('button', { name: /So sánh với bản hiện tại/ }).click();
  const table = page.getByRole('table', { name: 'Kết quả so sánh' });
  await table.waitFor({ timeout: 30000 });
  const cmp = page.getByRole('dialog');
  const p99Row = await table.locator('tr[data-metric="p99"] td').allInnerTexts();
  const costRow = await table.locator('tr[data-metric="Chi phí"] td').allInnerTexts();
  check(
    'comparison runs both versions and lists the design change',
    (await cmp.getByText(`instances: ${dbInstances} → ${dbInstances + 2}`).count()) === 1 &&
      /^-\d+%$/.test(p99Row[3]) &&
      /^\+\d+%$/.test(costRow[3]),
    `p99 ${p99Row.join(' | ')} · cost ${costRow.join(' | ')}`,
  );
  await page.keyboard.press('Escape');

  // 12e. KEDA template: the worker scales on the RabbitMQ backlog
  await openTemplate('KEDA: worker scale theo độ dài queue');
  await setSpeed('8×');
  await page.getByRole('button', { name: 'Chạy' }).click();
  const workerCard = page.locator('.react-flow__node', { hasText: 'Order worker' }).first();
  let kedaReplicas = 0;
  for (let i = 0; i < 60 && kedaReplicas < 4; i++) {
    await page.waitForTimeout(500);
    kedaReplicas = Number(((await workerCard.innerText()).match(/KEDA (\d+)/) ?? [])[1] ?? 0);
  }
  await page.getByRole('button', { name: 'Dừng' }).click();
  await workerCard.click();
  await page.getByRole('tab', { name: 'Thuộc tính' }).click();
  check(
    'KEDA worker scales out on the queue backlog',
    kedaReplicas >= 4 &&
      (await page.getByRole('radio', { name: 'Theo queue (KEDA)' }).getAttribute('aria-checked')) === 'true' &&
      /RabbitMQ/.test(await page.getByLabel('Queue theo dõi').innerText()),
    `${kedaReplicas} replicas`,
  );
  await setSpeed('1×');
  await openTemplate('Không cache: DB là nút thắt');

  // 13. share link: snapshot on the server, opened as a separate local project
  await page.getByLabel('Chia sẻ').click();
  const link = page.getByLabel('Link chia sẻ');
  await link.waitFor();
  const shareLink = await link.inputValue();
  check('share dialog shows a link', /\?share=[A-Za-z0-9_-]{12}$/.test(shareLink), shareLink);
  await page.keyboard.press('Escape');
  const countProjects = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const req = indexedDB.open('pattern-studio');
          req.onsuccess = () => {
            const c = req.result.transaction('projects').objectStore('projects').count();
            c.onsuccess = () => resolve(c.result);
          };
        }),
    );
  const projectsBefore = await countProjects();
  await page.goto(shareLink);
  await page.getByText('Đã mở bản chia sẻ thành dự án mới').waitFor();
  await page.waitForSelector('.react-flow__node');
  check(
    'opening the link creates a new project with the shared design',
    (await countProjects()) === projectsBefore + 1 &&
      !page.url().includes('share=') &&
      (await page.locator('.react-flow__node', { hasText: 'PostgreSQL' }).count()) === 1,
    page.url(),
  );
  const missing = page.waitForResponse((r) => r.url().includes('/api/shares/') && r.status() === 404);
  await page.goto(`${URL}/?share=AAAAAAAAAAAA`);
  await missing;
  await page.getByRole('alert').getByText('Link chia sẻ không tồn tại').waitFor();
  check('a dead link shows an error on the projects page', true);
  // the 404 itself is logged by the browser as a console error
  errors.splice(0, errors.length, ...errors.filter((e) => !e.includes('404')));

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
