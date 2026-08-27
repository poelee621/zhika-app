// social.js —— 知卡社区版 API 客户端 + 登录态管理
// 后端：Cloudflare Workers (zhika-social) + D1
// 登录：手机号+验证码；token 存 localStorage（30 天）
(function () {
  'use strict';

  const SOCIAL = {
    BASE: 'https://zhika-social.1012425851.workers.dev',

    // ---- 登录态 ----
    token() { return localStorage.getItem('zhika_token') || ''; },
    setToken(t) { if (t) localStorage.setItem('zhika_token', t); else localStorage.removeItem('zhika_token'); },
    user() { try { return JSON.parse(localStorage.getItem('zhika_me') || 'null'); } catch { return null; } },
    setUser(u) { if (u) localStorage.setItem('zhika_me', JSON.stringify(u)); else localStorage.removeItem('zhika_me'); },
    isLogin() { return !!this.token(); },

    // 相对路径(如 /media/xx) → 完整 URL
    abs(p) { return p && p.startsWith('http') ? p : this.BASE + p; },

    // ---- 请求封装 ----
    async req(method, path, body) {
      const headers = { 'Content-Type': 'application/json' };
      const t = this.token();
      if (t) headers['Authorization'] = 'Bearer ' + t;
      const res = await fetch(this.BASE + path, {
        method, headers,
        body: body ? JSON.stringify(body) : undefined
      });
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      if (!res.ok || !data || data.ok === false) {
        const e = new Error((data && data.error) || ('请求失败(' + res.status + ')'));
        e.status = res.status; throw e;
      }
      return data;
    },
    get(p) { return this.req('GET', p); },
    post(p, b) { return this.req('POST', p, b); },
    patch(p, b) { return this.req('PATCH', p, b); },
    del(p) { return this.req('DELETE', p); },

    // ---- 认证 ----
    sendCode(phone) { return this.post('/api/auth/send-code', { phone }); },
    async verify(phone, code) {
      const d = await this.post('/api/auth/verify', { phone, code });
      this.setToken(d.token);
      this.setUser(d.user);
      return d.user;
    },
    logout() { this.setToken(''); this.setUser(''); },
    me() { return this.get('/api/me').then(d => { this.setUser(d.user); return d.user; }); },
    updateMe(patch) {
      return this.patch('/api/me', patch).then(d => { this.setUser(d.user); return d.user; });
    },

    // ---- 卡片 ----
    publish(payload) { return this.post('/api/cards', payload); },
    // feed: opts {sort: latest|hot|for_you, tag: 分类key, cursor/page: 分页}
    feed(opts) {
      opts = opts || {};
      const qs = [];
      if (opts.sort) qs.push('sort=' + encodeURIComponent(opts.sort));
      if (opts.tag) qs.push('tag=' + encodeURIComponent(opts.tag));
      if (opts.cursor) qs.push('cursor=' + encodeURIComponent(opts.cursor));
      if (opts.page) qs.push('page=' + opts.page);
      qs.push('limit=' + (opts.limit || 20));
      return this.get('/api/feed?' + qs.join('&'));
    },
    card(id) { return this.get('/api/cards/' + id); },
    delCard(id) { return this.del('/api/cards/' + id); },
    like(id) { return this.post('/api/cards/' + id + '/like'); },
    unlike(id) { return this.del('/api/cards/' + id + '/like'); },
    fav(id) { return this.post('/api/cards/' + id + '/favorite'); },
    unfav(id) { return this.del('/api/cards/' + id + '/favorite'); },
    comment(id, content) { return this.post('/api/cards/' + id + '/comments', { content }); },

    // ---- 用户 ----
    userProfile(id, cursor) { return this.get('/api/users/' + id + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : '')); },

    // ---- 相对时间 ----
    relTime(ts) {
      if (!ts) return '';
      const s = Math.floor(Date.now() / 1000) - ts;
      if (s < 60) return '刚刚';
      if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
      if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
      if (s < 86400 * 7) return Math.floor(s / 86400) + ' 天前';
      const d = new Date(ts * 1000);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
  };

  window.SOCIAL = SOCIAL;
})();
