// zhika-social —— 知卡社区版后端
// 技术栈：Cloudflare Workers + D1(SQLite) + JWT(HS256, Web Crypto)
// 登录：用户ID(8位数字) + 密码（PBKDF2-SHA256/100k）
//   - /api/auth/random  一键创建新账号 + 临时密码 + JWT
//   - /api/auth/login   user_id + 密码登录
//   - /api/auth/check   查 user_id 是否已注册
//   - PATCH /api/me     改昵称/简介/头像/密码
// 图片：D1 base64（/media/:id 直读）；R2 开通后可迁
// 约定：所有响应 {ok:true,...} 或 {ok:false, error}
'use strict';

const enc = new TextEncoder();
const dec = new TextDecoder();

// 分类标签白名单（与前端 CoverEngine 10 主题对齐）
const TAG_KEYS = ['tech', 'finance', 'emotion', 'food', 'travel', 'career', 'knowledge', 'health', 'fashion', 'life'];
const TAG_LABELS = { tech: '科技', finance: '财经', emotion: '情感', food: '美食', travel: '旅行', career: '职场', knowledge: '知识', health: '健康', fashion: '时尚', life: '生活' };
const THEME_TO_TAG = { tech: 'tech', finance: 'finance', emotion: 'emotion', food: 'food', travel: 'travel', career: 'career', knowledge: 'knowledge', health: 'health', fashion: 'fashion', life: 'life' };

// ==================== 工具 ====================
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization', 'Access-Control-Max-Age': '86400' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
const fail = (error, status = 400) => json({ ok: false, error }, status);
const opts = () => new Response('', { status: 204, headers: cors });

const uid = () => crypto.randomUUID();
const now = () => Math.floor(Date.now() / 1000);
const b64e = (buf) => { const bytes = new Uint8Array(buf); let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const b64d = (s) => { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };

// ==================== 密码：PBKDF2-SHA256/100k ====================
const PBKDF2_ITERS = 100000;
// 返回 "salt$hash" 两个 base64
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERS }, key, 256);
  return b64e(salt) + '$' + b64e(bits);
}
async function verifyPassword(password, stored) {
  if (!stored || !stored.includes('$')) return false;
  const [saltB, hashB] = stored.split('$');
  const salt = b64d(saltB);
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERS }, key, 256);
  const computed = b64e(bits);
  if (computed.length !== hashB.length) return false;
  let r = 0;
  for (let i = 0; i < computed.length; i++) r |= computed.charCodeAt(i) ^ hashB.charCodeAt(i);
  return r === 0;
}

// 8 位数字 ID（首位 1-9，不全 0）
function randomUserId() {
  return String(1 + Math.floor(Math.random() * 9)) + String(Math.floor(10000000 + Math.random() * 89999999)).slice(0, 7);
}
// 6 位临时密码
function randomPassword() {
  return String(100000 + Math.floor(Math.random() * 900000));
}

// ==================== JWT ====================
async function signJWT(payload, secret) {
  const head = b64e(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64e(enc.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64e(sig)}`;
}
async function verifyJWT(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, s] = parts;
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('HMAC', key, b64d(s), enc.encode(`${h}.${p}`));
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(b64d(p)));
    if (!payload.exp || payload.exp < now()) return null;
    return payload;
  } catch { return null; }
}
async function auth(env, req) {
  const ah = req.headers.get('Authorization') || '';
  const token = ah.startsWith('Bearer ') ? ah.slice(7) : '';
  if (!token) return null;
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload || !payload.sub) return null;
  return await env.DB.prepare('SELECT id, user_id, nickname, avatar_id, bio, created_at FROM users WHERE id = ?').bind(payload.sub).first();
}

// ==================== 在线迁移（worker boot 一次，幂等）====================
let migratePromise = null;
// 无论 D1 当前是否为空，先确保 5 张表结构完整（CREATE IF NOT EXISTS 不会覆盖已有表）
async function ensureTables(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, user_id TEXT UNIQUE, password_hash TEXT NOT NULL DEFAULT '',
      nickname TEXT DEFAULT '', avatar_id TEXT, bio TEXT DEFAULT '', phone TEXT, created_at INTEGER NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT DEFAULT '', summary TEXT DEFAULT '',
      theme TEXT DEFAULT 'knowledge', tags TEXT DEFAULT '[]', cover_id TEXT, images TEXT DEFAULT '[]',
      cards TEXT DEFAULT '[]', like_count INTEGER DEFAULT 0, fav_count INTEGER DEFAULT 0,
      comment_count INTEGER DEFAULT 0, created_at INTEGER NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS likes (
      card_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (card_id, user_id)
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS favorites (
      card_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (card_id, user_id)
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY, card_id TEXT NOT NULL, user_id TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY, mime TEXT DEFAULT 'image/jpeg', data TEXT NOT NULL, created_at INTEGER NOT NULL
    )`)
  ]);
}
async function doMigrate(env) {
  await ensureTables(env);
  const cols = await env.DB.prepare("PRAGMA table_info(users)").all();
  const names = new Set(cols.results.map(r => r.name));
  // 兼容旧表：补齐可能缺失的列（含 nickname/avatar_id/bio，旧版 ALTER 漏建导致 INSERT 500）
  const addCol = async (col, type) => {
    if (!names.has(col)) await env.DB.prepare(`ALTER TABLE users ADD COLUMN ${col} ${type}`).run();
  };
  await addCol('user_id', 'TEXT');
  await addCol('password_hash', "TEXT NOT NULL DEFAULT ''");
  await addCol('nickname', "TEXT DEFAULT ''");
  await addCol('avatar_id', 'TEXT');
  await addCol('bio', "TEXT DEFAULT ''");
  await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id)").run();
  // 给已有的旧用户补 user_id（取 phone 后 8 位，不足用 id 前 8 位）
  const needFix = await env.DB.prepare("SELECT id, phone, user_id FROM users WHERE user_id IS NULL OR user_id = ''").all();
  for (const r of needFix.results) {
    let u = (r.phone && /^\d{8}$/.test(r.phone)) ? r.phone : String(r.id).replace(/\D/g, '').padStart(8, '0').slice(-8);
    while (await env.DB.prepare('SELECT 1 FROM users WHERE user_id = ? AND id != ?').bind(u, r.id).first()) {
      u = randomUserId();
    }
    await env.DB.prepare('UPDATE users SET user_id = ? WHERE id = ?').bind(u, r.id).run();
  }
}
async function getMigrate(env) {
  if (!migratePromise) migratePromise = doMigrate(env);
  return migratePromise;
}

// ==================== 图片存取（D1 base64；R2 迁移预留）====================
const MAX_IMG_B64 = 2_500_000;
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
  if (!row) return new Response('not found', { status: 404, headers: cors });
  try {
    const buf = b64d(row.data);
    return new Response(buf, { headers: { ...cors, 'Content-Type': row.mime, 'Cache-Control': 'public, max-age=31536000, immutable' } });
  } catch { return new Response('bad image', { status: 500, headers: cors }); }
}

// ==================== 用户数据组装 ====================
function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    user_id: u.user_id || '',
    nickname: u.nickname || '知友',
    avatar: u.avatar_id ? `/media/${u.avatar_id}` : '',
    bio: u.bio || '',
    created_at: u.created_at
  };
}
async function cardView(env, card, meId) {
  const author = await env.DB.prepare('SELECT id, user_id, nickname, avatar_id, bio FROM users WHERE id = ?').bind(card.user_id).first();
  let liked = false, faved = false;
  if (meId) {
    const [l, f] = await env.DB.batch([
      env.DB.prepare('SELECT 1 FROM likes WHERE card_id=? AND user_id=?').bind(card.id, meId),
      env.DB.prepare('SELECT 1 FROM favorites WHERE card_id=? AND user_id=?').bind(card.id, meId)
    ]);
    liked = !!l.results[0]; faved = !!f.results[0];
  }
  const images = JSON.parse(card.images || '[]');
  let tags = [];
  try { tags = JSON.parse(card.tags || '[]'); } catch { tags = []; }
  return {
    id: card.id,
    title: card.title || '',
    summary: card.summary || '',
    theme: card.theme || 'knowledge',
    tags,
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
  await getMigrate(env);
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  if (method === 'OPTIONS') return opts();

  // 公开图片
  if (method === 'GET' && path.startsWith('/media/')) return readImage(env, path.slice(7));

  // ---- 登录：随机账号（一键） ----
  if (method === 'POST' && path === '/api/auth/random') {
    // 生成唯一 user_id
    let userId;
    for (let i = 0; i < 20; i++) {
      userId = randomUserId();
      const exists = await env.DB.prepare('SELECT 1 FROM users WHERE user_id = ?').bind(userId).first();
      if (!exists) break;
    }
    const tempPassword = randomPassword();
    const id = uid();
    const passwordHash = await hashPassword(tempPassword);
    const nickname = '知友' + userId.slice(-4);
    // 线上旧表 users.phone 为 NOT NULL 且有 UNIQUE 索引；新流程不采集手机号，用唯一非空占位兼容
    await env.DB.prepare('INSERT INTO users (id, user_id, password_hash, nickname, avatar_id, bio, phone, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .bind(id, userId, passwordHash, nickname, null, '', 'u_' + userId, now()).run();
    const user = await env.DB.prepare('SELECT id, user_id, nickname, avatar_id, bio, created_at FROM users WHERE id = ?').bind(id).first();
    const token = await signJWT({ sub: id, uid: userId, exp: now() + 60 * 60 * 24 * 30 }, env.JWT_SECRET);
    return json({ ok: true, token, user: publicUser(user), user_id: userId, temp_password: tempPassword });
  }

  // ---- 登录：检查 user_id 是否已注册（用于登录页提前提示） ----
  if (method === 'GET' && path === '/api/auth/check') {
    const userId = String(url.searchParams.get('user_id') || '').trim();
    if (!/^[\w一-龥]{3,20}$/.test(userId)) return fail('用户名应为 3~20 位（字母/数字/中文/下划线）');
    const row = await env.DB.prepare('SELECT 1 FROM users WHERE user_id = ?').bind(userId).first();
    return json({ ok: true, exists: !!row });
  }

  // ---- 登录：user_id + 密码 ----
  if (method === 'POST' && path === '/api/auth/login') {
    const body = await req.json().catch(() => ({}));
    const userId = String(body.user_id || '').trim();
    const password = String(body.password || '');
    if (!/^[\w一-龥]{3,20}$/.test(userId)) return fail('用户名应为 3~20 位（字母/数字/中文/下划线）');
    if (!password || password.length < 6 || password.length > 32) return fail('密码长度应为 6~32 位');
    const row = await env.DB.prepare('SELECT id, user_id, password_hash, nickname, avatar_id, bio, created_at FROM users WHERE user_id = ?').bind(userId).first();
    if (!row) return fail('账号不存在');
    const ok = await verifyPassword(password, row.password_hash);
    if (!ok) return fail('密码错误');
    const token = await signJWT({ sub: row.id, uid: row.user_id, exp: now() + 60 * 60 * 24 * 30 }, env.JWT_SECRET);
    return json({ ok: true, token, user: publicUser(row) });
  }

  // ---- 注册：用户名 + 密码，自己创建账号（注册成功即自动登录） ----
  if (method === 'POST' && path === '/api/auth/register') {
    const body = await req.json().catch(() => ({}));
    const userId = String(body.user_id || '').trim();
    const password = String(body.password || '');
    if (!/^[\w一-龥]{3,20}$/.test(userId)) return fail('用户名应为 3~20 位（字母/数字/中文/下划线）');
    if (!password || password.length < 6 || password.length > 32) return fail('密码长度应为 6~32 位');
    const exists = await env.DB.prepare('SELECT 1 FROM users WHERE user_id = ?').bind(userId).first();
    if (exists) return fail('该用户名已被注册');
    const id = uid();
    const passwordHash = await hashPassword(password);
    const nickname = userId;
    // 线上旧表 users.phone 为 NOT NULL 且有 UNIQUE 索引；新流程不采集手机号，用唯一非空占位兼容
    await env.DB.prepare('INSERT INTO users (id, user_id, password_hash, nickname, avatar_id, bio, phone, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .bind(id, userId, passwordHash, nickname, null, '', 'u_' + userId, now()).run();
    const user = await env.DB.prepare('SELECT id, user_id, nickname, avatar_id, bio, created_at FROM users WHERE id = ?').bind(id).first();
    const token = await signJWT({ sub: id, uid: userId, exp: now() + 60 * 60 * 24 * 30 }, env.JWT_SECRET);
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
    if (body.password !== undefined) {
      const np = String(body.password);
      if (np.length < 6 || np.length > 32) return fail('密码长度应为 6~32 位');
      const newHash = await hashPassword(np);
      sets.push('password_hash = ?'); binds.push(newHash);
    }
    if (!sets.length) return fail('没有可更新的字段');
    binds.push(me.id);
    await env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
    const u = await env.DB.prepare('SELECT id, user_id, nickname, avatar_id, bio, created_at FROM users WHERE id = ?').bind(me.id).first();
    return json({ ok: true, user: publicUser(u) });
  });

  // ---- 发布卡片 ----
  if (method === 'POST' && path === '/api/cards') return needLogin(async () => {
    const body = await req.json().catch(() => ({}));
    const title = String(body.title || '').trim().slice(0, 60);
    if (!title) return fail('标题不能为空');
    let tags = Array.isArray(body.tags) ? body.tags.filter(t => TAG_KEYS.includes(String(t))).slice(0, 3).map(String) : [];
    if (!tags.length) {
      const mapped = THEME_TO_TAG[String(body.theme || '')];
      if (mapped) tags = [mapped];
    }
    const rawImages = Array.isArray(body.images) ? body.images.slice(0, 12) : [];
    if (!rawImages.length) return fail('请至少上传一张卡片图');
    const ids = [];
    for (const d of rawImages) { const r = await saveImage(env, d); if (!r.id) return r; ids.push(r.id); }
    const id = uid();
    await env.DB.prepare('INSERT INTO cards (id, user_id, title, summary, theme, tags, cover_id, images, cards, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(id, me.id, title, String(body.summary || '').slice(0, 200), String(body.theme || 'knowledge'), JSON.stringify(tags), ids[0], JSON.stringify(ids), JSON.stringify(Array.isArray(body.cards) ? body.cards : []), now()).run();
    const card = await env.DB.prepare('SELECT * FROM cards WHERE id = ?').bind(id).first();
    return json({ ok: true, card: await cardView(env, card, me.id) });
  });

  // 删除自己的卡片
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

  // 瀑布流 feed
  if (method === 'GET' && path === '/api/feed') {
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 1), 50);
    const sort = url.searchParams.get('sort') || 'latest';
    const tag = url.searchParams.get('tag') || '';
    const validTag = TAG_KEYS.includes(tag) ? tag : '';
    const tagCond = validTag ? ` AND instr(tags, '"${validTag}"') > 0` : '';
    let cards = [];

    if (sort === 'hot' || sort === 'for_you') {
      const page = Math.max(parseInt(url.searchParams.get('page') || '1', 10) || 1, 1);
      const offset = (page - 1) * limit;
      let orderBy = '(like_count*3 + fav_count*2 + comment_count*2) DESC, created_at DESC, id DESC';
      let prefScore = '';
      if (sort === 'for_you') {
        if (!me) return fail('喜好推送需要登录', 401);
        const rows = await env.DB.prepare(
          `SELECT DISTINCT tags FROM cards WHERE id IN (SELECT card_id FROM likes WHERE user_id = ?) OR id IN (SELECT card_id FROM favorites WHERE user_id = ?)`
        ).bind(me.id, me.id).all();
        const counter = {};
        for (const r of rows.results) {
          try { for (const t of JSON.parse(r.tags || '[]')) if (TAG_KEYS.includes(t)) counter[t] = (counter[t] || 0) + 1; } catch {}
        }
        const prefs = Object.entries(counter).sort((a, b) => b[1] - a[1]).slice(0, 5).map(x => x[0]);
        if (prefs.length) {
          prefScore = '(' + prefs.map(t => `CASE WHEN instr(tags, '"${t}"') > 0 THEN 1 ELSE 0 END`).join(' + ') + ')*100 + ';
          orderBy = prefScore + orderBy;
        }
      }
      const rows = await env.DB.prepare(`SELECT * FROM cards WHERE 1=1${tagCond} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
        .bind(limit, offset).all();
      for (const c of rows.results) cards.push(await cardView(env, c, me ? me.id : null));
      const hasMore = cards.length === limit;
      return json({ ok: true, cards, next_page: hasMore ? page + 1 : null });
    }

    const cursor = url.searchParams.get('cursor') || '';
    let rows;
    if (cursor) {
      const [cts, cid] = cursor.split('_');
      rows = await env.DB.prepare(`SELECT * FROM cards WHERE (created_at < ? OR (created_at = ? AND id < ?))${tagCond} ORDER BY created_at DESC, id DESC LIMIT ?`)
        .bind(Number(cts), Number(cts), cid, limit).all();
    } else {
      rows = await env.DB.prepare(`SELECT * FROM cards WHERE 1=1${tagCond} ORDER BY created_at DESC, id DESC LIMIT ?`).bind(limit).all();
    }
    for (const c of rows.results) cards.push(await cardView(env, c, me ? me.id : null));
    const last = cards.length ? cards[cards.length - 1] : null;
    return json({ ok: true, cards, next_cursor: last ? `${last.created_at}_${last.id}` : null });
  }

  // 卡片详情
  if (method === 'GET' && /^\/api\/cards\/[^/]+\/?$/.test(path)) {
    const cardId = path.split('/')[3];
    const card = await env.DB.prepare('SELECT * FROM cards WHERE id = ?').bind(cardId).first();
    if (!card) return fail('卡片不存在', 404);
    const view = await cardView(env, card, me ? me.id : null);
    const cmts = await env.DB.prepare('SELECT c.id, c.content, c.created_at, u.id AS user_id, u.nickname, u.avatar_id FROM comments c JOIN users u ON u.id = c.user_id WHERE c.card_id = ? ORDER BY c.created_at ASC LIMIT 200').bind(cardId).all();
    view.comments = cmts.results.map(r => ({ id: r.id, content: r.content, created_at: r.created_at, author: publicUser({ id: r.user_id, nickname: r.nickname, avatar_id: r.avatar_id }) }));
    return json({ ok: true, card: view });
  }

  // 点赞/取消
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

  // 收藏/取消
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

  // 评论
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

  // 用户主页
  if (method === 'GET' && /^\/api\/users\/[^/]+$/.test(path)) {
    const userId = path.split('/')[3];
    const u = await env.DB.prepare('SELECT id, user_id, nickname, avatar_id, bio, created_at FROM users WHERE id = ?').bind(userId).first();
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
