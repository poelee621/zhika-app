// 知卡 · App Store 截图自动生成
// 用法（在 zhika-app 根目录）:
//   npm i -D playwright && npx playwright install chromium
//   node scripts/make_screenshots.mjs
// 脚本用 Playwright 无头浏览器在 iPhone 视口渲染真实 App 界面并截图，
// 输出到 fastlane/screenshots/zh-Hans/
//
// 说明:
// - 纯前端 SPA（Capacitor WebView 内容等同网页端），根目录即 index.html
// - 用 mock 数据注入（KnowledgeCards.generateSet）渲染卡片，不走 LLM，零 token、稳定可复现
// - 视口精确匹配 App Store 要求:
//   6.7"=1290x2796, 6.5"=1242x2688, iPad Pro 12.9"=2048x2732 (deviceScaleFactor=1)
// - 6 张: 首页(链接) / 链接提取结果 / 截图模式 / 文本模式 / 会员 / 复习区

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const APP_DIR = path.join(ROOT, 'app');
const OUT = path.resolve(ROOT, 'fastlane/screenshots/zh-Hans');
const PORT = 8778;

const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.json':'application/json', '.svg':'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(APP_DIR, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MOCK = {
  title: '为什么我们总是存不下钱',
  summary: '一篇关于消费心理与复利的长文，提炼成 6 张可复习、可分享的知识卡片。',
  cards: [
    { label:'金句', content:'你不是没钱，你是对「小钱」没有痛觉。' },
    { label:'概念', content:'拿铁因子', sub:'每天一杯拿铁，一年就是一套机票钱。' },
    { label:'对比', content:'「省下的」vs「花掉的」：前者是沉默的成本，后者是即时的快感。' },
    { label:'方法论', content:'先付给未来的自己：工资到账先存 20%，再花剩下的。' },
    { label:'数据', content:'年化 7%，每月存 1000 元，20 年后 ≈ 52 万。' }
  ]
};

async function hideSplash(page) {
  await page.evaluate(() => {
    const s = document.querySelector('#splash');
    if (s) s.style.display = 'none';
  });
}
async function shot(page, file) {
  await page.screenshot({ path: path.join(OUT, file) });
  console.log('  ✓', file);
}
// 直接注入 mock 卡片（等同 app.js renderResult，但不走 LLM）
async function injectCards(page) {
  await page.evaluate((set) => {
    const res = document.querySelector('#result');
    res.classList.remove('hidden');
    document.querySelector('#resultTitle').textContent = set.title;
    document.querySelector('#resultSummary').textContent = set.summary;
    const urls = window.KnowledgeCards.generateSet(set);
    const list = document.querySelector('#cardList'); list.innerHTML = '';
    urls.forEach((u, i) => {
      const label = i === 0 ? '封面' : ((set.cards[i - 1] && set.cards[i - 1].label) || '卡片');
      const item = document.createElement('div');
      item.className = 'card-item';
      item.innerHTML = `<img src="${u}" alt="card"/><span class="cap">${label}</span>`;
      list.appendChild(item);
    });
    res.dataset.urls = JSON.stringify(urls);
  }, MOCK);
  await sleep(1200);
}
async function setupViewport(page, w, h) {
  await page.setViewportSize({ width: w, height: h, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await sleep(900);
  await hideSplash(page);
  await sleep(300);
}
async function captureSet(browser, w, h, suffix) {
  const page = await browser.newPage();
  await setupViewport(page, w, h);

  // 1) 首页（链接模式）
  await shot(page, `01_home_${suffix}.png`);

  // 2) 链接提取结果（mock 卡片）
  await injectCards(page);
  await shot(page, `02_result_${suffix}.png`);

  // 3) 截图模式
  await page.evaluate(() => {
    const t = document.querySelector('.tab[data-src="image"]'); if (t) t.click();
  });
  await sleep(500);
  await shot(page, `03_image_${suffix}.png`);
  // 切回链接模式待用
  await page.evaluate(() => { const t = document.querySelector('.tab[data-src="link"]'); if (t) t.click(); });
  await sleep(300);

  // 4) 文本模式
  await page.evaluate(() => {
    const t = document.querySelector('.tab[data-src="text"]'); if (t) t.click();
    const ta = document.querySelector('#textInput');
    if (ta) ta.value = '今天读了一篇关于复利的长文，想把它变成能复习的卡片。';
  });
  await sleep(500);
  await shot(page, `04_text_${suffix}.png`);
  await page.evaluate(() => { const t = document.querySelector('.tab[data-src="link"]'); if (t) t.click(); });
  await sleep(300);

  // 5) 会员弹窗
  await page.evaluate(() => {
    const m = document.querySelector('#vipModal'); if (m) m.classList.remove('hidden');
    const ph = document.querySelector('#priceHint'); if (ph) ph.textContent = '¥18/月 · ¥148/年（限时 7 折）';
  });
  await sleep(600);
  await shot(page, `05_vip_${suffix}.png`);

  // 6) 复习区（先灌一张待复习）
  await page.evaluate(() => {
    if (window.SPACED) {
      window.SPACED.saveSet({
        title: '为什么我们总是存不下钱',
        summary: '',
        cards: [{ label:'金句', content:'你不是没钱，你是对「小钱」没有痛觉。' }]
      });
      const evt = new Event('zhika:due'); document.dispatchEvent(evt);
    }
  });
  // 触发 renderDue（app.js 监听了 localStorage，这里直接调 SPACED.dueToday 渲染）
  await page.evaluate(() => {
    const box = document.querySelector('#dueList');
    if (box) box.innerHTML = '<div class="due-item"><div><div class="content">你不是没钱，你是对「小钱」没有痛觉。</div><div class="meta">为什么我们总是存不下钱 · 金句</div></div><button>已记住</button></div>';
    const c = document.querySelector('#dueCount'); if (c) c.textContent = '1';
  });
  await sleep(500);
  await shot(page, `06_review_${suffix}.png`);

  await page.close();
}
async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise(r => server.listen(PORT, r));
  console.log('static server on', PORT);

  const sizes = (process.env.SIZES || '6.7,6.5,12.9').split(',').map(s => s.trim()).filter(Boolean);
  const map = { '6.7': [1290, 2796], '6.5': [1242, 2688], '12.9': [2048, 2732] };

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    for (const s of sizes) {
      if (!map[s]) { console.warn('未知尺寸', s, '跳过'); continue; }
      await captureSet(browser, map[s][0], map[s][1], s);
    }
    console.log('全部截图完成 ->', OUT);
  } finally {
    await browser.close();
    server.close();
  }
}
run().catch(e => { console.error('截图失败:', e); process.exit(1); });
