// social.js —— 知卡社区版 API 客户端
// 登录方式：用户ID(8位数字) + 密码（PBKDF2 后端）

const SOCIAL = {
  BASE: 'https://zhika-social.1012425851.workers.dev',
  TOKEN_KEY: 'zhika_token',
  USER_KEY: 'zhika_user',

  get token() { return localStorage.getItem(this.TOKEN_KEY) || ''; },
  get user() {
    try { return JSON.parse(localStorage.getItem(this.USER_KEY) || 'null'); }
    catch (e) { return null; }
  },
  setToken(t) { t ? localStorage.setItem(this.TOKEN_KEY, t) : localStorage.removeItem(this.TOKEN_KEY); },
  setUser(u) { u ? localStorage.setItem(this.USER_KEY, JSON.stringify(u)) : localStorage.removeItem(this.USER_KEY); },

  async req(path, opts) {
    opts = opts || {};
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers.Authorization = 'Bearer ' + this.token;
    let res;
    try { res = await fetch(this.BASE + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined }); }
    catch (e) { return { ok: false, error: '网络异常，请稍后重试' }; }
    let json;
    try { json = await res.json(); }
    catch (e) { return { ok: false, error: '服务响应异常（' + res.status + '）' }; }
    if (!json.ok) {
      return { ok: false, error: json.error || '请求失败', status: res.status };
    }
    return json;
  },
  get(p) { return this.req(p); },
  post(p, body) { return this.req(p, { method: 'POST', body }); },
  patch(p, body) { return this.req(p, { method: 'PATCH', body }); },
  del(p) { return this.req(p, { method: 'DELETE' }); },

  // ---- 登录 ----
  // 一键随机账号：返回 {ok,token,user,user_id,temp_password}，temp_password 让用户复制保存
  async random() {
    const d = await this.post('/api/auth/random');
    if (!d.ok) return d;
    this.setToken(d.token);
    this.setUser(d.user);
    return d;
  },
  // 检查 user_id 是否已注册
  async check(user_id) { return await this.get('/api/auth/check?user_id=' + encodeURIComponent(user_id)); },
  // user_id + 密码登录
  async login(user_id, password) {
    const d = await this.post('/api/auth/login', { user_id, password });
    if (!d.ok) return d;
    this.setToken(d.token);
    this.setUser(d.user);
    return d;
  },
  logout() { this.setToken(''); this.setUser(''); },
  isLogin() { return !!(this.token && this.user && this.user.id); },

  // ---- 我的资料 ----
  async me() { return await this.get('/api/me'); },
  async updateMe(patch) { return await this.patch('/api/me', patch); },

  // ---- 卡片 ----
  async feed(opts) {
    opts = opts || {};
    const qs = new URLSearchParams();
    if (opts.sort) qs.set('sort', opts.sort);
    if (opts.tag) qs.set('tag', opts.tag);
    if (opts.cursor) qs.set('cursor', opts.cursor);
    if (opts.page) qs.set('page', String(opts.page));
    if (opts.limit) qs.set('limit', String(opts.limit));
    return await this.get('/api/feed?' + qs.toString());
  },
  async card(id) { return await this.get('/api/cards/' + id); },
  async publish(payload) {
    return await this.post('/api/cards', payload);
  },
  async deleteCard(id) { return await this.del('/api/cards/' + id); },
  async like(id) { return await this.post('/api/cards/' + id + '/like'); },
  async unlike(id) { return await this.del('/api/cards/' + id + '/like'); },
  async favorite(id) { return await this.post('/api/cards/' + id + '/favorite'); },
  async unfavorite(id) { return await this.del('/api/cards/' + id + '/favorite'); },
  async comment(id, content) { return await this.post('/api/cards/' + id + '/comments', { content }); },
  async userPage(id, opts) {
    opts = opts || {};
    const qs = new URLSearchParams();
    if (opts.cursor) qs.set('cursor', opts.cursor);
    qs.set('limit', String(opts.limit || 20));
    return await this.get('/api/users/' + id + '?' + qs.toString());
  },

  // ---- 兼容旧接口名（让 community.js 老代码继续工作）----
  fav(id) { return this.favorite(id); },
  unfav(id) { return this.unfavorite(id); },
  userProfile(id, cursor) { return this.userPage(id, cursor ? { cursor } : undefined); },
  delCard(id) { return this.deleteCard(id); },
  thirdLogin() { return Promise.resolve({ ok: false, error: '第三方登录已下线，请用「一键随机账号」' }); },

  // ---- 路径辅助 ----
  abs(p) {
    if (!p) return '';
    if (/^https?:/i.test(p)) return p;
    return this.BASE + p;
  },
  relTime(t) {
    if (!t) return '';
    const s = Math.floor(Date.now() / 1000) - Number(t);
    if (s < 60) return '刚刚';
    if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
    if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
    if (s < 30 * 86400) return Math.floor(s / 86400) + ' 天前';
    const d = new Date(Number(t) * 1000);
    return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
  }
};

window.SOCIAL = SOCIAL;
