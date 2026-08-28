// 知卡 · 全功能 Worker（Cloudflare，零依赖、免费额度巨大）
// 部署：wrangler login && wrangler deploy → 得到 *.workers.dev 公网 URL
//
// 端点：
//   内容摄取网关
//     POST /extract        {url}            → {title, text}   文章/新闻/公众号正文抽取
//     POST /transcribe     {url}            → {title, text}   视频发布文案/元信息
//     POST /ocr            {image:base64}   → {text}          电子书/截图 OCR（视觉模型）
//   订阅校验后端（复用 Spark）
//     POST /apple/verify                    → Apple 收据校验
//     POST /webhook/revenuecat              → RC Webhook 落库
//     GET  /entitlements/:id                → 查询会员状态
//
// 环境变量（Dashboard / wrangler secret）：
//   APPLE_SHARED_SECRET   Apple 共享密钥
//   RC_WEBHOOK_SECRET     RevenueCat Webhook 共享密钥
//   VISION_API_KEY        视觉模型 Key（智谱 GLM-4V，用于 OCR）
//   VISION_BASE           视觉模型 base（默认智谱）
//   VISION_MODEL          视觉模型名（默认 glm-4v-plus）
// 可选 KV 绑定 ZHIKA_KV：持久化会员状态；未绑定时降级为内存存储

const memory = new Map();

async function storeEntitlement(env, userId, data) {
  const key = `ent:${userId}`;
  const payload = JSON.stringify({ ...data, updatedAt: Date.now() });
  if (env.ZHIKA_KV) { await env.ZHIKA_KV.put(key, payload); }
  else { memory.set(key, payload); }
}
async function getEntitlement(env, userId) {
  const key = `ent:${userId}`;
  if (env.ZHIKA_KV) { const v = await env.ZHIKA_KV.get(key); return v ? JSON.parse(v) : null; }
  const v = memory.get(key); return v ? JSON.parse(v) : null;
}

// ===== 内容摄取 =====
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile';

function htmlToText(s) {
  if (!s) return '';
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<\/p>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<\/div>/gi, '\n').replace(/<\/h[1-6]>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return s.split('\n').map(l => l.trim()).filter(l => l.length > 4).join('\n');
}
function pick(html, re, fallback) { const m = html.match(re); return m ? m[1].trim() : (fallback || ''); }

// 文章/新闻/公众号
// 失败不抛，统一返 {title,text,ok,status,kind,message}，让前端能按场景给用户针对性提示
//   ok=true  抓成功（text 可能为空：网站无正文或 JS 渲染）
//   kind:    'http_error' | 'timeout' | 'dns' | 'parse' | 'empty'
async function fetchArticle(url) {
  let resp;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000); // 20s 硬超时，避免 worker 卡 30s
    resp = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' }, signal: ctrl.signal });
    clearTimeout(t);
  } catch (e) {
    const msg = String(e && e.message || e);
    if (e && e.name === 'AbortError') return { title: '', text: '', ok: false, status: 0, kind: 'timeout', message: '抓取超时（20s）' };
    if (/DNS|ENOTFOUND|getaddrinfo/i.test(msg)) return { title: '', text: '', ok: false, status: 0, kind: 'dns', message: '域名解析失败' };
    return { title: '', text: '', ok: false, status: 0, kind: 'http_error', message: '网络错误: ' + msg };
  }
  if (!resp.ok) return { title: '', text: '', ok: false, status: resp.status, kind: 'http_error', message: `目标站点返回 ${resp.status}` };
  let html;
  try { html = await resp.text(); }
  catch (e) { return { title: '', text: '', ok: false, status: resp.status, kind: 'parse', message: '读取响应失败' }; }
  const title = pick(html, /<title>([\s\S]*?)<\/title>/i)
    || pick(html, /property="og:title"\s+content="([^"]+)"/i);
  // 微信公众平台：取 js_content 区块
  let block = html;
  const wx = html.match(/id="js_content"[^>]*>([\s\S]*?)<\/div>\s*<script/i);
  if (wx) block = wx[1];
  let text = htmlToText(block).slice(0, 8000);
  if (text.length < 100) text = htmlToText(html).slice(0, 8000); // 兜底：整页
  if (text.length < 50) return { title, text, ok: false, status: resp.status, kind: 'empty', message: '网页抓取到但无可读正文（可能需登录或 JS 渲染）' };
  return { title, text, ok: true };
}

// 视频文案/元信息（发布文案 + 描述；B站字幕需 wbi 签名，进阶预留）
async function fetchVideo(url) {
  const resp = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' } });
  const html = resp.ok ? await resp.text() : '';
  const title = pick(html, /property="og:title"\s+content="([^"]+)"/i)
    || pick(html, /<title>([\s\S]*?)<\/title>/i);
  const desc = pick(html, /property="og:description"\s+content="([^"]+)"/i);
  const text = [title, desc].filter(Boolean).join('\n');
  return { title, text };
}

// 截图 OCR（视觉模型）
async function ocr(image, env) {
  const key = env.VISION_API_KEY;
  if (!key) throw new Error('未配置视觉模型(VISION_API_KEY)');
  const base = env.VISION_BASE || 'https://open.bigmodel.cn/api/paas/v4';
  const model = env.VISION_MODEL || 'glm-4v-plus';
  let resp;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25000); // 视觉模型硬超时，避免 worker 卡死
    resp = await fetch(base + '/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: '请识别并转录这张图片中的所有文字。如果是电子书/文档/截图，请保持原文段落与顺序，不要翻译、不要概括，只输出文字内容。' },
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + image } }
          ]
        }]
      })
    });
    clearTimeout(t);
  } catch (e) {
    if (e && e.name === 'AbortError') {
      const err = new Error('视觉模型响应超时（25s）');
      err.kind = 'vision_timeout'; err.status = 0;
      throw err;
    }
    throw e;
  }
  if (!resp.ok) {
    const err = new Error('视觉模型返回 ' + resp.status);
    err.kind = 'vision_error'; err.status = resp.status;
    throw err;
  }
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || '';
  return { text: text.trim() };
}

async function appleVerify(receiptData, password, sandbox) {
  const endpoint = sandbox ? 'https://sandbox.itunes.apple.com/verifyReceipt' : 'https://buy.itunes.apple.com/verifyReceipt';
  const resp = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ 'receipt-data': receiptData, password }) });
  return resp.json();
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST,GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      // ===== 内容摄取网关 =====
      if (request.method === 'POST' && path === '/extract') {
        const { url: u } = await request.json();
        if (!u) return json({ error: 'missing url' }, 400, cors);
        const r = await fetchArticle(u);
        // 失败透传真实 status：前端可按 404/403/timeout 等分别给提示
        if (!r.ok) return json({ error: r.message, kind: r.kind, status: r.status }, r.status || 502, cors);
        return json({ title: r.title, text: r.text }, 200, cors);
      }
      if (request.method === 'POST' && path === '/transcribe') {
        const { url: u } = await request.json();
        if (!u) return json({ error: 'missing url' }, 400, cors);
        const r = await fetchVideo(u);
        return json({ title: r.title, text: r.text }, 200, cors);
      }
      if (request.method === 'POST' && path === '/ocr') {
        const { image } = await request.json();
        if (!image) return json({ error: 'missing image' }, 400, cors);
        try {
          const r = await ocr(image, env);
          return json(r, 200, cors);
        } catch (e) {
          // 视觉模型超时/错误：透传 kind/status，前端给精准提示（而非笼统 500）
          const kind = e && e.kind || 'vision_error';
          const status = (e && e.status) || 502;
          const msg = (e && e.message) || String(e);
          const code = kind === 'vision_timeout' ? 504 : (status >= 500 ? 502 : status);
          return json({ error: msg, kind, status: code }, code, cors);
        }
      }

      // ===== 订阅校验（复用 Spark）=====
      if (request.method === 'POST' && path === '/apple/verify') {
        const { receiptData, sandbox } = await request.json();
        if (!receiptData) return json({ error: 'missing receiptData' }, 400, cors);
        const result = await appleVerify(receiptData, env.APPLE_SHARED_SECRET || '', !!sandbox);
        return json(result, 200, cors);
      }
      if (request.method === 'POST' && path === '/webhook/revenuecat') {
        const auth = request.headers.get('Authorization') || '';
        const secret = env.RC_WEBHOOK_SECRET || '';
        if (secret && auth !== `Bearer ${secret}`) return json({ error: 'unauthorized' }, 401, cors);
        const event = await request.json();
        const userId = event?.event?.app_user_id || event?.app_user_id;
        if (userId) {
          await storeEntitlement(env, userId, {
            entitlements: event?.event?.entitlements || {},
            productId: event?.event?.product_id || null,
            type: event?.event?.type || null, raw: event,
          });
        }
        return json({ ok: true }, 200, cors);
      }
      if (request.method === 'GET' && path.startsWith('/entitlements/')) {
        const userId = decodeURIComponent(path.split('/')[2] || '');
        if (!userId) return json({ error: 'missing userId' }, 400, cors);
        const ent = await getEntitlement(env, userId);
        return json(ent || { found: false }, 200, cors);
      }

      return json({ error: 'not found', endpoints: ['/extract', '/transcribe', '/ocr', '/apple/verify', '/webhook/revenuecat'] }, 404, cors);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500, cors);
    }
  },
};
