// community.js —— 知卡社区版前端：瀑布流首页 / 卡片详情 / 登录 / 发布 / 个人主页 / 底部导航
// 依赖：social.js（API 客户端）
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const COMM = {
    _feedCursor: null,
    _feedPage: 1,
    _feedReqId: 0,
    _feedLoading: false,
    _feedEnd: false,
    _feedSort: 'latest',  // latest | hot | for_you
    _feedTag: '',         // '' = 全部
    _mineCursor: null,
    _mineEnd: false,
    _meId: (SOCIAL.user() || {}).id || '',
    _detailCard: null,
    _publishUrls: [],
    _publishSet: null,
    _publishTags: [],
    _smsTimer: null,

    // 分类体系（与 CoverEngine 10 主题对齐）
    TAG_DEFS: [
      { key: 'tech', label: '科技', icon: '🤖' },
      { key: 'finance', label: '财经', icon: '📈' },
      { key: 'emotion', label: '情感', icon: '💗' },
      { key: 'food', label: '美食', icon: '🍜' },
      { key: 'travel', label: '旅行', icon: '✈️' },
      { key: 'career', label: '职场', icon: '💼' },
      { key: 'knowledge', label: '知识', icon: '📚' },
      { key: 'health', label: '健康', icon: '💪' },
      { key: 'fashion', label: '时尚', icon: '👗' },
      { key: 'life', label: '生活', icon: '🏡' }
    ],
    tagLabel(key) { const t = this.TAG_DEFS.find(x => x.key === key); return t ? t.label : key; },
    tagIcon(key) { const t = this.TAG_DEFS.find(x => x.key === key); return t ? t.icon : '🏷'; },

    // ==================== 视图切换（底部导航）====================
    switchView(name) {
      ['home', 'create', 'mine'].forEach(v => {
        const el = $('#view-' + v);
        if (el) el.classList.toggle('active', v === name);
        const btn = $(`.tabbar-btn[data-view="${v}"]`);
        if (btn) btn.classList.toggle('active', v === name);
      });
      if (name === 'home') this.loadFeed(true);
      if (name === 'mine') this.renderMine();
    },

    // ==================== 首页分类栏 ====================
    renderFeedTabs() {
      const bar = $('#feedTabs');
      if (!bar || bar.childElementCount) return;
      // 排序模式：最新 / 热门 / 推荐
      const modes = [
        { sort: 'latest', label: '🕐 最新' },
        { sort: 'hot', label: '🔥 热门' },
        { sort: 'for_you', label: '❤️ 推荐' }
      ];
      const modeWrap = document.createElement('div');
      modeWrap.className = 'feed-mode-row';
      modes.forEach(m => {
        const b = document.createElement('button');
        b.className = 'feed-mode' + (this._feedSort === m.sort ? ' active' : '');
        b.textContent = m.label;
        b.dataset.sort = m.sort;
        b.onclick = () => this.setFeedMode(m.sort, '');
        modeWrap.appendChild(b);
      });
      bar.appendChild(modeWrap);
      // 分类（横向滚动）
      const tagWrap = document.createElement('div');
      tagWrap.className = 'feed-tag-row';
      const all = document.createElement('button');
      all.className = 'feed-tag' + (this._feedTag === '' ? ' active' : '');
      all.textContent = '全部';
      all.onclick = () => this.setFeedMode(this._feedSort, '');
      tagWrap.appendChild(all);
      this.TAG_DEFS.forEach(t => {
        const b = document.createElement('button');
        b.className = 'feed-tag' + (this._feedTag === t.key ? ' active' : '');
        b.textContent = t.icon + ' ' + t.label;
        b.onclick = () => this.setFeedMode(this._feedSort, t.key);
        tagWrap.appendChild(b);
      });
      bar.appendChild(tagWrap);
    },
    setFeedMode(sort, tag) {
      if (sort === 'for_you' && !SOCIAL.isLogin()) {
        this.openLogin('登录后开启个性化推荐');
        return;
      }
      this._feedSort = sort;
      this._feedTag = tag;
      // 高亮
      $$('#feedTabs .feed-mode').forEach(b => b.classList.toggle('active', b.dataset.sort === sort));
      $$('#feedTabs .feed-tag').forEach((b, i) => {
        const key = i === 0 ? '' : this.TAG_DEFS[i - 1].key;
        b.classList.toggle('active', key === tag);
      });
      this.loadFeed(true);
    },

    // ==================== 首页瀑布流 ====================
    async loadFeed(reset) {
      this.renderFeedTabs();
      if (reset) { this._feedCursor = null; this._feedPage = 1; this._feedEnd = false; $('#feedList').innerHTML = ''; }
      // 竞争保护：reset 时强制重发请求并丢弃旧响应；非 reset（滚动加载）时避免并发
      if (this._feedLoading && !reset) return;
      this._feedLoading = true;
      const myId = ++this._feedReqId;
      const sentinel = $('#feedSentinel');
      if (sentinel) sentinel.textContent = '加载中…';
      try {
        const opts = { sort: this._feedSort, tag: this._feedTag, limit: 20 };
        let d;
        if (this._feedSort === 'latest') {
          opts.cursor = this._feedCursor;
          d = await SOCIAL.feed(opts);
          if (myId !== this._feedReqId) return; // 过期响应
          this._feedCursor = d.next_cursor;
          if (!d.next_cursor) this._feedEnd = true;
          this._appendCards($('#feedList'), d.cards, false);
        } else {
          opts.page = this._feedPage;
          d = await SOCIAL.feed(opts);
          if (myId !== this._feedReqId) return;
          this._feedPage = d.next_page || this._feedPage + 1;
          if (!d.next_page) this._feedEnd = true;
          this._appendCards($('#feedList'), d.cards, false);
        }
        if (sentinel) sentinel.textContent = this._feedEnd ? (($('#feedList').childElementCount) ? '— 到底啦 —' : '') : '上滑加载更多';
        $('#feedEmpty').classList.toggle('hidden', !!$('#feedList').childElementCount);
      } catch (e) {
        console.error('[feed]', e);
        if (e && e.status === 401) { this._pendingForYou = true; this.openLogin('登录后开启个性化推荐'); }
        else if (sentinel) sentinel.textContent = '加载失败，上滑重试';
      } finally { if (myId === this._feedReqId) this._feedLoading = false; }
    },

    // 渲染卡片列表（瀑布流项）
    _appendCards(container, cards, mine) {
      cards.forEach(c => {
        const item = document.createElement('div');
        item.className = 'wf-item';
        item.dataset.id = c.id;
        const cover = SOCIAL.abs(c.cover);
        const likes = c.like_count || 0, cmts = c.comment_count || 0;
        item.innerHTML = `
          <div class="wf-imgwrap">
            <img class="wf-img" src="${cover}" alt="${esc(c.title)}" loading="lazy" onerror="this.closest('.wf-item').style.display='none'"/>
            <span class="wf-title">${esc(c.title)}</span>
            ${(c.tags && c.tags.length) ? `<span class="wf-tag">${this.tagIcon(c.tags[0])} ${esc(this.tagLabel(c.tags[0]))}</span>` : ''}
          </div>
          <div class="wf-meta">
            <span class="wf-author">
              ${c.author && c.author.avatar ? `<img class="wf-avatar" src="${SOCIAL.abs(c.author.avatar)}" alt=""/>` : '<span class="wf-avatar ph">' + esc((c.author && c.author.nickname || '知友').slice(0, 1)) + '</span>'}
              <span class="wf-name">${esc((c.author && c.author.nickname) || '知友')}</span>
            </span>
            <span class="wf-stats">♥ ${likes} · 💬 ${cmts}</span>
          </div>`;
        if (!mine) {
          item.addEventListener('click', () => COMM.openDetail(c.id));
          // 点击作者区进入其主页
          const auth = item.querySelector('.wf-author');
          if (auth) auth.addEventListener('click', (ev) => { ev.stopPropagation(); if (c.author) COMM.openUser(c.author.id); });
        }
        container.appendChild(item);
      });
    },

    // ==================== 卡片详情 ====================
    async openDetail(id) {
      $('#detailModal').classList.remove('hidden');
      $('#detailBody').innerHTML = '<div class="detail-loading">加载中…</div>';
      try {
        const d = await SOCIAL.card(id);
        this._detailCard = d.card;
        this._renderDetail();
      } catch (e) {
        $('#detailBody').innerHTML = `<p class="detail-error">加载失败：${esc(e.message)}</p>`;
      }
    },
    _renderDetail() {
      const c = this._detailCard;
      if (!c) return;
      const imgs = (c.images || []).map(i => SOCIAL.abs(i));
      const author = c.author || {};
      const isMine = this._meId && c.author && c.author.id === this._meId;
      $('#detailBody').innerHTML = `
        <div class="dt-author">
          <img class="dt-avatar" src="${author.avatar ? SOCIAL.abs(author.avatar) : ''}" onerror="this.style.visibility='hidden'" alt=""/>
          <span class="dt-name">${esc(author.nickname || '知友')}</span>
          <span class="dt-time">${SOCIAL.relTime(c.created_at)}</span>
          <span class="dt-del ${isMine ? '' : 'hidden'}">删除</span>
        </div>
        <div class="dt-imgs" id="dtImgs">
          ${imgs.map((u, i) => `<div class="dt-imgwrap"><img src="${u}" loading="lazy" alt="card ${i + 1}"/></div>`).join('')}
        </div>
        <div class="dt-title">${esc(c.title)}</div>
        ${c.summary ? `<div class="dt-summary">${esc(c.summary)}</div>` : ''}
        ${(c.tags && c.tags.length) ? `<div class="dt-tags">${c.tags.map(t => `<span class="dt-tag" data-tag="${t}">${this.tagIcon(t)} ${esc(this.tagLabel(t))}</span>`).join('')}</div>` : ''}
        <div class="dt-actions">
          <button class="dt-btn ${c.liked ? 'on' : ''}" id="dtLike">${c.liked ? '♥' : '♡'} <span id="dtLikeN">${c.like_count || 0}</span></button>
          <button class="dt-btn ${c.faved ? 'on' : ''}" id="dtFav">${c.faved ? '★' : '☆'} <span id="dtFavN">${c.fav_count || 0}</span></button>
          <button class="dt-btn" id="dtShare">↗ 转发</button>
          <button class="dt-btn" id="dtSave">⤓ 下载</button>
        </div>
        <div class="dt-comments">
          <div class="dt-cmt-head">评论 <span class="pill">${c.comment_count || 0}</span></div>
          <div id="dtCmtList" class="dt-cmt-list"></div>
          <div class="dt-cmt-input">
            <input id="dtCmtText" type="text" maxlength="500" placeholder="友善评论，理性交流…"/>
            <button id="dtCmtSend" class="primary-btn small">发送</button>
          </div>
        </div>`;
      // 评论列表
      const cl = $('#dtCmtList');
      if (c.comments && c.comments.length) {
        cl.innerHTML = c.comments.map(cm => `
          <div class="dt-cmt">
            <img class="dt-cmt-avatar" src="${cm.author.avatar ? SOCIAL.abs(cm.author.avatar) : ''}" onerror="this.style.visibility='hidden'" alt=""/>
            <div class="dt-cmt-body">
              <div class="dt-cmt-name">${esc(cm.author.nickname || '知友')} <span class="dt-time">${SOCIAL.relTime(cm.created_at)}</span></div>
              <div class="dt-cmt-text">${esc(cm.content)}</div>
            </div>
          </div>`).join('');
      } else {
        cl.innerHTML = '<p class="hint">还没有评论，来抢沙发～</p>';
      }
      // 事件
      const needLogin = () => {
        if (SOCIAL.isLogin()) return true;
        this.openLogin('登录后才能互动');
        return false;
      };
      $('#dtLike').onclick = async (ev) => {
        if (!needLogin()) return;
        const btn = ev.currentTarget, cid = this._detailCard.id;
        try {
          const d = this._detailCard.liked ? await SOCIAL.unlike(cid) : await SOCIAL.like(cid);
          this._detailCard.liked = !this._detailCard.liked;
          btn.classList.toggle('on', this._detailCard.liked);
          btn.innerHTML = (this._detailCard.liked ? '♥' : '♡') + ` <span>${d.like_count}</span>`;
          $('#dtLikeN').textContent = d.like_count;
        } catch (e) { this.toast(e.message); }
      };
      $('#dtFav').onclick = async (ev) => {
        if (!needLogin()) return;
        const btn = ev.currentTarget, cid = this._detailCard.id;
        try {
          const d = this._detailCard.faved ? await SOCIAL.unfav(cid) : await SOCIAL.fav(cid);
          this._detailCard.faved = !this._detailCard.faved;
          btn.classList.toggle('on', this._detailCard.faved);
          btn.innerHTML = (this._detailCard.faved ? '★' : '☆') + ` <span>${d.fav_count}</span>`;
          $('#dtFavN').textContent = d.fav_count;
        } catch (e) { this.toast(e.message); }
      };
      $('#dtShare').onclick = () => this.shareCard(c);
      $('#dtSave').onclick = () => this.saveCard(c);
      // 详情页标签点击 → 跳到该分类
      $$('#detailModal .dt-tag').forEach(tag => {
        tag.onclick = () => {
          this.closeDetail();
          this.switchView('home');
          this.setFeedMode('latest', tag.dataset.tag);
        };
      });
      $('#dtCmtSend').onclick = async () => {
        if (!needLogin()) return;
        const text = $('#dtCmtText').value.trim();
        if (!text) { this.toast('先写点内容'); return; }
        try {
          await SOCIAL.comment(this._detailCard.id, text);
          $('#dtCmtText').value = '';
          this.toast('评论成功');
          this.openDetail(this._detailCard.id); // 重新拉取
        } catch (e) { this.toast(e.message); }
      };
      const del = $('#detailModal .dt-del');
      if (del) del.onclick = async () => {
        if (!confirm('确定删除这张卡片吗？')) return;
        try { await SOCIAL.delCard(this._detailCard.id); this.closeDetail(); this.loadFeed(true); this.toast('已删除'); }
        catch (e) { this.toast(e.message); }
      };
      // 头像点击进主页
      $('#detailModal .dt-author').onclick = (ev) => {
        if (ev.target.classList.contains('dt-del')) return;
        if (this._detailCard.author) this.openUser(this._detailCard.author.id);
      };
    },

    shareCard(c) {
      const url = SOCIAL.BASE + '/card/' + c.id;
      const text = c.title + ' —— 来自 知卡ZhiCard';
      if (navigator.share) {
        navigator.share({ title: c.title, text, url }).catch(() => {});
      } else {
        (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(
          () => this.toast('链接已复制，去粘贴分享吧'),
          () => this.toast('复制失败，长按标题手动复制')
        );
      }
    },
    saveCard(c) {
      const img = (c.images || []).map(i => SOCIAL.abs(i));
      img.forEach((u, i) => {
        const a = document.createElement('a');
        a.href = u; a.download = `知卡_${c.title}_${i + 1}.jpg`;
        document.body.appendChild(a); a.click(); a.remove();
      });
      this.toast('已触发下载（iOS 可长按图片保存）');
    },
    closeDetail() { $('#detailModal').classList.add('hidden'); this._detailCard = null; },

    // ==================== 用户主页 ====================
    async openUser(id) {
      this._userCards = { cursor: null, end: false, id };
      $('#userModal').classList.remove('hidden');
      $('#userBody').innerHTML = '<div class="detail-loading">加载中…</div>';
      try {
        const d = await SOCIAL.userProfile(id);
        const u = d.user;
        $('#userBody').innerHTML = `
          <div class="up-head">
            <img class="up-avatar" src="${u.avatar ? SOCIAL.abs(u.avatar) : ''}" onerror="this.style.visibility='hidden'" alt=""/>
            <div class="up-info">
              <div class="up-name">${esc(u.nickname || '知友')}</div>
              <div class="up-bio">${esc(u.bio || '这个人很懒，什么都没写')}</div>
              <div class="up-time">加入时间 ${SOCIAL.relTime(u.created_at)}</div>
            </div>
          </div>
          <div class="up-cards" id="upCards"></div>
          <div id="upSentinel" class="wf-sentinel">上滑加载更多</div>`;
        this._userCards.cursor = d.next_cursor;
        this._appendCards($('#upCards'), d.cards, true);
        if (!d.next_cursor) { this._userCards.end = true; $('#upSentinel').textContent = d.cards.length ? '— 到底啦 —' : '还没有发布过卡片'; }
      } catch (e) {
        $('#userBody').innerHTML = `<p class="detail-error">加载失败：${esc(e.message)}</p>`;
      }
    },
    async _loadUserMore() {
      if (this._userCards.end) return;
      try {
        const d = await SOCIAL.userProfile(this._userCards.id, this._userCards.cursor);
        this._userCards.cursor = d.next_cursor;
        this._appendCards($('#upCards'), d.cards, true);
        if (!d.next_cursor) { this._userCards.end = true; $('#upSentinel').textContent = '— 到底啦 —'; }
      } catch (e) { /* silent */ }
    },
    closeUser() { $('#userModal').classList.add('hidden'); },

    // ==================== 我的页面 ====================
    renderMine() {
      const box = $('#view-mine');
      const u = SOCIAL.user();
      if (!u) {
        box.innerHTML = `
          <div class="mine-empty">
            <div class="mine-logo">📚</div>
            <p>登录后发布你的知识卡片，让更多人看见</p>
            <button class="primary-btn" id="mineLoginBtn">手机号登录</button>
          </div>`;
        $('#mineLoginBtn').onclick = () => this.openLogin('登录后即可发布、点赞、评论');
        return;
      }
      box.innerHTML = `
        <div class="mine-head">
          <img class="up-avatar" id="mineAvatar" src="${u.avatar ? SOCIAL.abs(u.avatar) : ''}" onerror="this.style.visibility='hidden'" alt=""/>
          <div class="up-info">
            <div class="up-name" id="mineNick">${esc(u.nickname || '知友')}</div>
            <div class="up-bio" id="mineBio">${esc(u.bio || '')}</div>
          </div>
          <input type="file" id="mineAvatarInput" accept="image/*" class="visually-hidden"/>
        </div>
        <div class="mine-actions">
          <button class="ghost-btn" id="mineEdit">✏️ 编辑资料</button>
          <button class="ghost-btn" id="mineLogout">退出登录</button>
        </div>
        <div class="mine-cards-title">我发布的卡片</div>
        <div id="mineCards" class="mine-cards"></div>
        <div id="mineSentinel" class="wf-sentinel">上滑加载更多</div>`;
      // 头像点击更换
      $('#mineAvatar').onclick = () => $('#mineAvatarInput').click();
      $('#mineAvatarInput').onchange = (ev) => {
        const f = ev.target.files[0]; if (!f) return;
        const r = new FileReader();
        r.onload = () => this._uploadAvatar(String(r.result));
        r.readAsDataURL(f);
      };
      $('#mineEdit').onclick = () => this.openEditProfile(u);
      $('#mineLogout').onclick = () => { SOCIAL.logout(); this._meId = ''; this.renderMine(); this.toast('已退出登录'); };
      this._loadMine(true);
    },
    async _uploadAvatar(dataUrl) {
      try {
        const small = await this._compressImg(dataUrl, 256);
        const u = await SOCIAL.updateMe({ avatar: small });
        this._meId = u.id;
        this.toast('头像已更新');
        this.renderMine();
      } catch (e) { this.toast('头像更新失败：' + e.message); }
    },
    openEditProfile(u) {
      const nn = prompt('修改昵称（20 字内）', u.nickname || '');
      if (nn === null) return;
      const bio = prompt('一句话简介（100 字内）', u.bio || '');
      if (bio === null) return;
      SOCIAL.updateMe({ nickname: nn.trim().slice(0, 20), bio: bio.trim().slice(0, 100) })
        .then(nu => { this._meId = nu.id; this.renderMine(); this.toast('资料已保存'); })
        .catch(e => this.toast(e.message));
    },
    async _loadMine(reset) {
      if (reset) { this._mineCursor = null; this._mineEnd = false; $('#mineCards').innerHTML = ''; }
      if (this._mineEnd) { $('#mineSentinel').textContent = '— 到底啦 —'; return; }
      try {
        const me = SOCIAL.user(); if (!me) return;
        const d = await SOCIAL.userProfile(me.id, this._mineCursor);
        this._mineCursor = d.next_cursor;
        if (!d.next_cursor) this._mineEnd = true;
        this._appendCards($('#mineCards'), d.cards, true);
        $('#mineSentinel').textContent = this._mineEnd ? (d.cards.length ? '— 到底啦 —' : '还没有发布过卡片，去创作吧～') : '上滑加载更多';
      } catch (e) { $('#mineSentinel').textContent = '加载失败'; }
    },

    // ==================== 登录弹窗 ====================
    openLogin(hint) {
      $('#loginModal').classList.remove('hidden');
      $('#loginHint').textContent = hint || '手机号登录，未注册将自动创建账号';
      $('#loginStep').textContent = '1';
      $('#loginPhoneWrap').classList.remove('hidden');
      $('#loginCodeWrap').classList.add('hidden');
      $('#loginSendBtn').classList.remove('hidden');
      $('#loginCodeBtn').classList.add('hidden');
      $('#devCode').classList.add('hidden');
    },
    closeLogin() { $('#loginModal').classList.add('hidden'); if (this._smsTimer) clearInterval(this._smsTimer); },

    async _sendSms() {
      const phone = $('#loginPhone').value.trim();
      if (!/^1\d{10}$/.test(phone)) { this.toast('请输入正确的手机号'); return; }
      const btn = $('#loginSendBtn');
      btn.disabled = true;
      try {
        const d = await SOCIAL.sendCode(phone);
        let wait = 60;
        btn.textContent = wait + 's 后重发';
        this._smsTimer = setInterval(() => {
          wait--; btn.textContent = wait + 's 后重发';
          if (wait <= 0) { clearInterval(this._smsTimer); btn.disabled = false; btn.textContent = '重新发送'; }
        }, 1000);
        $('#loginStep').textContent = '2';
        $('#loginPhoneWrap').classList.add('hidden');
        $('#loginCodeWrap').classList.remove('hidden');
        $('#loginSendBtn').classList.add('hidden');
        $('#loginCodeBtn').classList.remove('hidden');
        $('#loginCode').focus();
        if (d.dev && d.code) {
          $('#devCode').classList.remove('hidden');
          $('#devCode').textContent = '测试环境验证码：' + d.code;
        } else {
          $('#devCode').classList.add('hidden');
        }
      } catch (e) {
        btn.disabled = false; btn.textContent = '发送验证码';
        this.toast(e.message);
      }
    },
    async _doLogin() {
      const phone = $('#loginPhone').value.trim();
      const code = $('#loginCode').value.trim();
      if (!code) { this.toast('请输入验证码'); return; }
      $('#loginCodeBtn').disabled = true;
      try {
        const u = await SOCIAL.verify(phone, code);
        this._meId = u.id;
        this.closeLogin();
        this.toast('登录成功，欢迎 ' + (u.nickname || '知友'));
        // 若是在发布流程中，继续发布
        if (this._pendingPublish) { const p = this._pendingPublish; this._pendingPublish = null; this.openPublish(p.urls, p.set); }
        // 若之前在推荐模式（401 被拦），登录后重载
        if (this._feedSort === 'for_you' || (this._feedSort === 'for_you' && this._pendingForYou)) {
          this._pendingForYou = false;
          this.loadFeed(true);
        }
        this.renderMine();
        if ($('#view-mine').classList.contains('active')) this.renderMine();
      } catch (e) {
        this.toast(e.message);
      } finally { $('#loginCodeBtn').disabled = false; }
    },

    // ==================== 发布弹窗 ====================
    // urls: dataURL 数组（含封面+各卡）；set: {title, summary, theme}
    openPublish(urls, set) {
      if (!SOCIAL.isLogin()) {
        this._pendingPublish = { urls, set };
        this.openLogin('发布卡片需要先登录');
        return;
      }
      this._publishUrls = urls || [];
      this._publishSet = set || {};
      $('#pubModal').classList.remove('hidden');
      $('#pubTitle').value = (set && set.title) || '';
      // 标签选择：默认按当前主题预选一个
      this._publishTags = [];
      const tagBox = $('#pubTags');
      tagBox.innerHTML = '';
      this.TAG_DEFS.forEach(t => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'tag-chip';
        chip.textContent = t.icon + ' ' + t.label;
        chip.dataset.key = t.key;
        chip.onclick = () => {
          const i = this._publishTags.indexOf(t.key);
          if (i >= 0) { this._publishTags.splice(i, 1); chip.classList.remove('on'); }
          else if (this._publishTags.length >= 3) { this.toast('最多选 3 个分类'); return; }
          else { this._publishTags.push(t.key); chip.classList.add('on'); }
        };
        tagBox.appendChild(chip);
      });
      const preset = this.TAG_DEFS.find(t => t.key === (set && set.theme));
      if (preset) {
        this._publishTags.push(preset.key);
        const chip = tagBox.querySelector(`[data-key="${preset.key}"]`);
        if (chip) chip.classList.add('on');
      }
      const list = $('#pubImgs');
      list.innerHTML = '';
      this._publishUrls.forEach((u, i) => {
        const label = i === 0 ? '封面' : '补充观点';
        const item = document.createElement('div');
        item.className = 'pub-img checked';
        item.innerHTML = `<img src="${u}" alt=""/><span class="pub-cap">${label}</span>`;
        item.dataset.i = i;
        item.onclick = () => item.classList.toggle('checked');
        list.appendChild(item);
      });
      $('#pubSend').disabled = false;
    },
    closePublish() { $('#pubModal').classList.add('hidden'); },
    async _doPublish() {
      const title = $('#pubTitle').value.trim();
      if (!title) { this.toast('给卡片起个标题吧'); return; }
      const selected = $$('#pubImgs .pub-img.checked').map(el => this._publishUrls[Number(el.dataset.i)]);
      if (!selected.length) { this.toast('至少选择一张图片'); return; }
      const btn = $('#pubSend');
      btn.disabled = true; btn.textContent = '发布中…';
      try {
        // 压缩图片再上传（1080x1440 → 最长边 900，质量 0.85）
        const compressed = [];
        for (const u of selected) compressed.push(await this._compressImg(u, 900, 0.85));
        await SOCIAL.publish({
          title,
          summary: this._publishSet.summary || '',
          theme: this._publishSet.theme || 'knowledge',
          tags: this._publishTags.slice(0, 3),
          cards: this._publishSet.cards || [],
          images: compressed
        });
        this.closePublish();
        this.toast('发布成功！');
        this.switchView('home');
        this.loadFeed(true);
      } catch (e) {
        this.toast('发布失败：' + e.message);
      } finally { btn.disabled = false; btn.textContent = '发布'; }
    },

    // 图片压缩：dataURL → 最长边 maxSide，返回 dataURL
    _compressImg(dataUrl, maxSide, quality) {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          let { width: w, height: h } = img;
          const scale = Math.min(1, maxSide / Math.max(w, h));
          w = Math.round(w * scale); h = Math.round(h * scale);
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(cv.toDataURL('image/jpeg', quality == null ? 0.85 : quality));
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
      });
    },

    // ==================== Toast ====================
    toast(msg) {
      let t = $('#toast');
      if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
      t.textContent = msg;
      t.classList.add('show');
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
    },

    // ==================== 初始化 ====================
    init() {
      // 底部导航
      $$('.tabbar-btn').forEach(btn => {
        btn.addEventListener('click', () => this.switchView(btn.dataset.view));
      });
      // 首页无限滚动
      const sentinel = $('#feedSentinel');
      if (sentinel && 'IntersectionObserver' in window) {
        new IntersectionObserver((entries) => {
          if (entries[0].isIntersecting) this.loadFeed(false);
        }, { rootMargin: '300px' }).observe(sentinel);
      }
      window.addEventListener('scroll', () => {
        if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 500) this.loadFeed(false);
      });
      // 用户主页无限滚动
      const upSent = $('#upSentinel');
      if (upSent && 'IntersectionObserver' in window) {
        new IntersectionObserver((entries) => {
          if (entries[0].isIntersecting) this._loadUserMore();
        }, { rootMargin: '300px' }).observe(upSent);
      }
      // 我的卡片无限滚动
      const mineSent = $('#mineSentinel');
      if (mineSent && 'IntersectionObserver' in window) {
        new IntersectionObserver((entries) => {
          if (entries[0].isIntersecting) this._loadMine(false);
        }, { rootMargin: '300px' }).observe(mineSent);
      }
      // 弹窗关闭
      $('#closeLogin').onclick = () => this.closeLogin();
      $('#closeDetail').onclick = () => this.closeDetail();
      $('#closeUser').onclick = () => this.closeUser();
      $('#closePub').onclick = () => this.closePublish();
      // 弹窗遮罩点击关闭
      ['loginModal', 'detailModal', 'userModal', 'pubModal'].forEach(id => {
        const m = document.getElementById(id);
        if (m) m.addEventListener('click', (ev) => { if (ev.target === m) { if (id === 'loginModal') this.closeLogin(); else if (id === 'detailModal') this.closeDetail(); else if (id === 'userModal') this.closeUser(); else this.closePublish(); } });
      });
      // 登录事件
      $('#loginSendBtn').onclick = () => this._sendSms();
      $('#loginCodeBtn').onclick = () => this._doLogin();
      // 发布事件
      $('#pubSend').onclick = () => this._doPublish();
      // 初始视图
      this.switchView('home');
    }
  };

  window.COMM = COMM;
  document.addEventListener('DOMContentLoaded', () => COMM.init());
})();
