// zhika-social —— 知卡社区版后端
// 技术栈：Cloudflare Workers + D1(SQLite) + JWT(HS256, Web Crypto)
// 登录：手机号 + 验证码（dev 模式 SMS_WEBHOOK 为空时验证码直接返回）
// 图片：存 D1 media 表（base64），/media/:id 提供二进制；R2 开通后可迁移
// 约定：所有响应 {ok:true,...} 或 {ok:false, error}
'use strict';

const enc = new TextEncoder();
const dec = new TextDecoder();

// ==================== 工具 ====================
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization' }
});
const fail = (error, status = 400) => json({ ok: false, error }, status);

const uid = () => crypto.randomUUID();
const now = () => Math.floor(Date.now() / 1000);
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64d = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

// ==================== JWT ====================
async function signJWT(payload, secret) {
  const head = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}
async function verifyJWT(token, secret) {
  try {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return null;
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('HMAC', key, b64d(s), enc.encode(`${h}.${p}`));
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(b64d(p)));
    if (!payload.exp || payload.exp < now()) return null;
    return payload;
  } catch { return null; }
}

// ==================== 鉴权中间件 ====================
async function auth(env, req) {
  const ah = req.headers.get('Authorization') || '';
  const token = ah.startsWith('Bearer ') ? ah.slice(7) : '';
  if (!token) return null;
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload || !payload.sub) return null;
  const user = await env.DB.prepare('SELECT id, phone, nickname, avatar_id, bio, created_at FROM users WHERE id = ?').bind(payload.sub).first();
  return user || null;
}

// ==================== 图片存取（D1 base64；R2 迁移预留）====================
const MAX_IMG_B64 = 2_500_000; // base64 上限 ~2.5MB
async function saveImage(env, dataUrl) {
  if (typeof dataUrl !== 'string') return fail('图片数据缺失');
  const m = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/s);
  if (!m) return fail('仅支持 png/jpg/webp 图片');
  if (m[2].length > MAX_IMG_B64) return fail('图片过大，请压缩后重试');
  const id = uid();
  await env.DB.prepare('INSERT INTO media (id, mime, data, created_at) VALUES (?,?,?,?)')
    .bind(id, 'image/' + m[1].replace('jpeg', 'jpg'), m[2], now()).run();
  return { id };
}
async function readImage(env, id) {
  const row = await env.DB.prepare('SELECT mime, data FROM media WHERE id = ?').bind(id).first();
  if (!row) return new Response('not found', { status: 404 });
  try {
    const buf = b64d(row.data);
    return new Response(buf, { headers: { 'Content-Type': row.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'Access-Control-Allow-Origin': '*' } });
  } catch { return new Response('bad image', { status: 500 }); }
}

// ==================== 用户数据组装 ====================
function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, nickname: u.nickname || '知友', avatar: u.avatar_id ? `/media/${u.avatar_id}` : '',
    bio: u.bio || '', created_at: u.created_at
  };
}

// 卡片 + 作者 + 当前用户互动状态
async function cardView(env, card, meId) {
  const author = await env.DB.prepare('SELECT id, nickname, avatar_id, bio FROM users WHERE id = ?').bind(card.user_id).first();
  let liked = false, faved = false;
  if (meId) {
    const [l, f] = await env.DB.batch([
      env.DB.prepare('SELECT 1 FROM likes WHERE card_id=? AND user_id=?').bind(card.id, meId),
      env.DB.prepare('SELECT 1 FROM favorites WHERE card_id=? AND user_id=?').bind(card.id, meId)
    ]);
    liked = !!l.results[0]; faved = !!f.results[0];
  }
  const images = JSON.parse(card.images || '[]');
  return {
    id: card.id,
    title: card.title || '',
    summary: card.summary || '',
    theme: card.theme || 'knowledge',
    cover: images[0] ? `/media/${images[0]}` : '',
    images: images.map(i => `/media/${i}`),
    cards: JSON.parse(card.cards || '[]'),
    like_count: card.like_count || 0,
    fav_count: card.fav_count || 0,
    comment_count: card.comment_count || 0,
    created_at: card.created_at,
    liked, faved,
    author: publicUser(author)
  };
}

// ==================== 路由 ====================
async function handle(req, env) {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // CORS 预检
  if (method === 'OPTIONS') return new Response('', { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization', 'Access-Control-Max-Age': '86400' } });

  // ---- 公开图片 ----
  if (method === 'GET' && path.startsWith('/media/')) {
    return readImage(env, path.slice(7));
  }

  // ---- 验证码发送 ----
  if (method === 'POST' && path === '/api/auth/send-code') {
    const body = await req.json().catch(() => ({}));
    const phone = String(body.phone || '').trim();
    if (!/^1\d{10}$/.test(phone)) return fail('手机号格式不正确');
    const row = await env.DB.prepare('SELECT next_at FROM sms_codes WHERE phone = ?').bind(phone).first();
    if (row && row.next_at > now()) return fail('发送太频繁，请稍后再试', 429);
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const exp = now() + 300;       // 5 分钟有效
    const next = now() + 60;       // 60 秒重发冷却
    await env.DB.prepare('INSERT INTO sms_codes (phone, code, expires_at, next_at) VALUES (?,?,?,?) ON CONFLICT(phone) DO UPDATE SET code=excluded.code, expires_at=excluded.expires_at, next_at=excluded.next_at')
      .bind(phone, code, exp, next).run();
    // 生产：接短信服务商。dev：直接返回验证码（仅测试环境）
    if (env.SMS_WEBHOOK) {
      try { await fetch(env.SMS_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, code }) }); }
      catch (e) { console.error('SMS webhook fail', e); }
      return json({ ok: true });
    }
    return json({ ok: true, dev: true, code });
  }

  // ---- 验证码登录 / 注册 ----
  if (method === 'POST' && path === '/api/auth/verify') {
    const body = await req.json().catch(() => ({}));
    const phone = String(body.phone || '').trim();
    const code = String(body.code || '').trim();
    if (!/^1\d{10}$/.test(phone)) return fail('手机号格式不正确');
    if (!/^\d{6}$/.test(code)) return fail('验证码为 6 位数字');
    const row = await env.DB.prepare('SELECT code, expires_at FROM sms_codes WHERE phone = ?').bind(phone).first();
    if (!row || row.expires_at < now()) return fail('验证码已过期，请重新获取');
    if (row.code !== code) return fail('验证码错误');
    // 登录/注册
    let user = await env.DB.prepare('SELECT * FROM users WHERE phone = ?').bind(phone).first();
    if (!user) {
      const id = uid();
      const nickname = '知友' + phone.slice(-4);
      await env.DB.prepare('INSERT INTO users (id, phone, nickname, avatar_id, bio, created_at) VALUES (?,?,?,?,?,?)')
        .bind(id, phone, nickname, null, '', now()).run();
      user = { id, phone, nickname, avatar_id: null, bio: '', created_at: now() };
    }
    await env.DB.prepare('DELETE FROM sms_codes WHERE phone = ?').bind(phone).run();
    const token = await signJWT({ sub: user.id, phone, exp: now() + 60 * 60 * 24 * 30 }, env.JWT_SECRET); // 30 天
    return json({ ok: true, token, user: publicUser(user) });
  }

  const me = await auth(env, req);
  const needLogin = (fn) => { if (!me) return fail('请先登录', 401); return fn(); };

  // ---- 我的资料 ----
  if (method === 'GET' && path === '/api/me') return needLogin(() => json({ ok: true, user: publicUser(me) }));

  if (method === 'PATCH' && path === '/api/me') return needLogin(async () => {
    const body = await req.json().catch(() => ({}));
    const sets = [], binds = [];
    if (body.nickname !== undefined) {
      const nn = String(body.nickname).trim().slice(0, 20);
      if (!nn) return fail('昵称不能为空');
      sets.push('nickname = ?'); binds.push(nn);
    }
    if (body.bio !== undefined) { sets.push('bio = ?'); binds.push(String(body.bio).trim().slice(0, 100)); }
    if (body.avatar !== undefined && body.avatar) {
      const r = await saveImage(env, body.avatar);
      if (!r.id) return r;
      sets.push('avatar_id = ?'); binds.push(r.id);
    }
    if (!sets.length) return fail('没有可更新的字段');
    binds.push(me.id);
    await env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
    const u = await env.DB.prepare('SELECT id, phone, nickname, avatar_id, bio, created_at FROM users WHERE id = ?').bind(me.id).first();
    return json({ ok: true, user: publicUser(u) });
  });

  // ---- 发布卡片 ----
  if (method === 'POST' && path === '/api/cards') return needLogin(async () => {
    const body = await req.json().catch(() => ({}));
    const title = String(body.title || '').trim().slice(0, 60);
    if (!title) return fail('标题不能为空');
    const rawImages = Array.isArray(body.images) ? body.images.slice(0, 12) : [];
    if (!rawImages.length) return fail('请至少上传一张卡片图');
    // 存图
    const ids = [];
    for (const d of rawImages) { const r = await saveImage(env, d); if (!r.id) return r; ids.push(r.id); }
    const id = uid();
    await env.DB.prepare('INSERT INTO cards (id, user_id, title, summary, theme, cover_id, images, cards, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(id, me.id, title, String(body.summary || '').slice(0, 200), String(body.theme || 'knowledge'), ids[0], JSON.stringify(ids), JSON.stringify(Array.isArray(body.cards) ? body.cards : []), now()).run();
    const card = await env.DB.prepare('SELECT * FROM cards WHERE id = ?').bind(id).first();
    return json({ ok: true, card: await cardView(env, card, me.id) });
  });

  // ---- 删除自己的卡片 ----
  if (method === 'DELETE' && /^\/api\/cards\/[^/]+$/.test(path)) return needLogin(async () => {
    const cardId = path.split('/')[3];
    const card = await env.DB.prepare('SELECT user_id FROM cards WHERE id = ?').bind(cardId).first();
    if (!card) return fail('卡片不存在', 404);
    if (card.user_id !== me.id) return fail('只能删除自己的卡片', 403);
    await env.DB.prepare('DELETE FROM cards WHERE id = ?').bind(cardId).run();
    await env.DB.prepare('DELETE FROM likes WHERE card_id = ?').bind(cardId).run();
    await env.DB.prepare('DELETE FROM favorites WHERE card_id = ?').bind(cardId).run();
    await env.DB.prepare('DELETE FROM comments WHERE card_id = ?').bind(cardId).run();
    return json({ ok: true });
  });

  // ---- 瀑布流 feed ----
  if (method === 'GET' && path === '/api/feed') {
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 1), 50);
    const cursor = url.searchParams.get('cursor') || '';
    let rows;
    if (cursor) {
      const [cts, cid] = cursor.split('_');
      rows = await env.DB.prepare('SELECT * FROM cards WHERE created_at < ? OR (created_at = ? AND id < ?) ORDER BY created_at DESC, id DESC LIMIT ?')
        .bind(Number(cts), Number(cts), cid, limit).all();
    } else {
      rows = await env.DB.prepare('SELECT * FROM cards ORDER BY created_at DESC, id DESC LIMIT ?').bind(limit).all();
    }
    const cards = [];
    for (const c of rows.results) cards.push(await cardView(env, c, me ? me.id : null));
    const last = cards.length ? cards[cards.length - 1] : null;
    return json({ ok: true, cards, next_cursor: last ? `${last.created_at}_${last.id}` : null });
  }

  // ---- 卡片详情 ----
  if (method === 'GET' && /^\/api\/cards\/[^/]+\/?$/.test(path)) {
    const cardId = path.split('/')[3];
    const card = await env.DB.prepare('SELECT * FROM cards WHERE id = ?').bind(cardId).first();
    if (!card) return fail('卡片不存在', 404);
    const view = await cardView(env, card, me ? me.id : null);
    // 评论
    const cmts = await env.DB.prepare('SELECT c.id, c.content, c.created_at, u.nickname, u.avatar_id FROM comments c JOIN users u ON u.id = c.user_id WHERE c.card_id = ? ORDER BY c.created_at ASC LIMIT 200').bind(cardId).all();
    view.comments = cmts.results.map(r => ({ id: r.id, content: r.content, created_at: r.created_at, author: publicUser({ id: r.user_id, nickname: r.nickname, avatar_id: r.avatar_id }) }));
    return json({ ok: true, card: view });
  }

  // ---- 点赞 / 取消 ----
  if (method === 'POST' && /^\/api\/cards\/[^/]+\/like$/.test(path)) return needLogin(async () => {
    const cardId = path.split('/')[3];
    const ins = await env.DB.prepare('INSERT INTO likes (card_id, user_id, created_at) VALUES (?,?,?) ON CONFLICT(card_id, user_id) DO NOTHING RETURNING card_id').bind(cardId, me.id, now()).first();
    if (ins) await env.DB.prepare('UPDATE cards SET like_count = like_count + 1 WHERE id = ?').bind(cardId).run();
    const c = await env.DB.prepare('SELECT like_count FROM cards WHERE id = ?').bind(cardId).first();
    return json({ ok: true, liked: true, like_count: c ? c.like_count : 0 });
  });
  if (method === 'DELETE' && /^\/api\/cards\/[^/]+\/like$/.test(path)) return needLogin(async () => {
    const cardId = path.split('/')[3];
    const del = await env.DB.prepare('DELETE FROM likes WHERE card_id = ? AND user_id = ?').bind(cardId, me.id).run();
    if (del.meta.changes > 0) await env.DB.prepare('UPDATE cards SET like_count = MAX(0, like_count - 1) WHERE id = ?').bind(cardId).run();
    const c = await env.DB.prepare('SELECT like_count FROM cards WHERE id = ?').bind(cardId).first();
    return json({ ok: true, liked: false, like_count: c ? c.like_count : 0 });
  });

  // ---- 收藏 / 取消 ----
  if (method === 'POST' && /^\/api\/cards\/[^/]+\/favorite$/.test(path)) return needLogin(async () => {
    const cardId = path.split('/')[3];
    const ins = await env.DB.prepare('INSERT INTO favorites (card_id, user_id, created_at) VALUES (?,?,?) ON CONFLICT(card_id, user_id) DO NOTHING RETURNING card_id').bind(cardId, me.id, now()).first();
    if (ins) await env.DB.prepare('UPDATE cards SET fav_count = fav_count + 1 WHERE id = ?').bind(cardId).run();
    const c = await env.DB.prepare('SELECT fav_count FROM cards WHERE id = ?').bind(cardId).first();
    return json({ ok: true, faved: true, fav_count: c ? c.fav_count : 0 });
  });
  if (method === 'DELETE' && /^\/api\/cards\/[^/]+\/favorite$/.test(path)) return needLogin(async () => {
    const cardId = path.split('/')[3];
    const del = await env.DB.prepare('DELETE FROM favorites WHERE card_id = ? AND user_id = ?').bind(cardId, me.id).run();
    if (del.meta.changes > 0) await env.DB.prepare('UPDATE cards SET fav_count = MAX(0, fav_count - 1) WHERE id = ?').bind(cardId).run();
    const c = await env.DB.prepare('SELECT fav_count FROM cards WHERE id = ?').bind(cardId).first();
    return json({ ok: true, faved: false, fav_count: c ? c.fav_count : 0 });
  });

  // ---- 评论 ----
  if (method === 'POST' && /^\/api\/cards\/[^/]+\/comments$/.test(path)) return needLogin(async () => {
    const cardId = path.split('/')[3];
    const body = await req.json().catch(() => ({}));
    const content = String(body.content || '').trim().slice(0, 500);
    if (!content) return fail('评论内容不能为空');
    const card = await env.DB.prepare('SELECT id FROM cards WHERE id = ?').bind(cardId).first();
    if (!card) return fail('卡片不存在', 404);
    const cid = uid();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO comments (id, card_id, user_id, content, created_at) VALUES (?,?,?,?,?)').bind(cid, cardId, me.id, content, now()),
      env.DB.prepare('UPDATE cards SET comment_count = comment_count + 1 WHERE id = ?').bind(cardId)
    ]);
    return json({ ok: true, comment: { id: cid, content, created_at: now(), author: publicUser(me) } });
  });

  // ---- 用户主页 ----
  if (method === 'GET' && /^\/api\/users\/[^/]+$/.test(path)) {
    const userId = path.split('/')[3];
    const u = await env.DB.prepare('SELECT id, phone, nickname, avatar_id, bio, created_at FROM users WHERE id = ?').bind(userId).first();
    if (!u) return fail('用户不存在', 404);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 1), 50);
    const cursor = url.searchParams.get('cursor') || '';
    let rows;
    if (cursor) {
      const [cts, cid] = cursor.split('_');
      rows = await env.DB.prepare('SELECT * FROM cards WHERE user_id = ? AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?')
        .bind(userId, Number(cts), Number(cts), cid, limit).all();
    } else {
      rows = await env.DB.prepare('SELECT * FROM cards WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?').bind(userId, limit).all();
    }
    const cards = [];
    for (const c of rows.results) cards.push(await cardView(env, c, me ? me.id : null));
    const last = cards.length ? cards[cards.length - 1] : null;
    return json({ ok: true, user: publicUser(u), cards, next_cursor: last ? `${last.created_at}_${last.id}` : null });
  }

  return fail('接口不存在', 404);
}

export default {
  async fetch(req, env) {
    try { return await handle(req, env); }
    catch (e) { console.error('ERR', e); return fail('服务器繁忙，请稍后再试', 500); }
  }
};
