// knowledge_cards.js —— 知卡知识卡片生成器（Canvas 绘制，3:4 竖版 1080×1440）
// 根据 LLM 提炼结果 set {title, summary, theme, cards:[{type,label,content}]}
// 产出：第 0 张封面卡 + 各知识卡，全部可直接保存/分享。
// 设计：竞品(Readwise/Anki)只有丑文字卡；知卡直接出精美图，可发小红书/朋友圈。

const KnowledgeCards = {
  W: 1080, H: 1440,
  INK: '#1a1a1a', SUB: '#8a8a8a', WHITE: '#ffffff',
  FONT: '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif',

  _theme(key) {
    return (window.CoverEngine && window.CoverEngine.THEMES[key]) || window.CoverEngine.THEMES.knowledge;
  },

  // 中文按字符测量换行
  _wrap(ctx, text, maxW) {
    const lines = []; let line = '';
    for (const ch of String(text || '')) {
      if (ctx.measureText(line + ch).width > maxW) { lines.push(line); line = ch; }
      else line += ch;
    }
    if (line) lines.push(line);
    return lines;
  },

  _rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  },

  _brandBar(ctx) {
    ctx.fillStyle = '#3b5bdb';
    this._rrect(ctx, 64, 56, 132, 60, 30); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '700 32px ' + this.FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('📚 知卡', 130, 86);
  },

  _foot(ctx, t) {
    ctx.fillStyle = this.SUB; ctx.font = '400 28px ' + this.FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('知卡 · 把内容变成你的知识卡片', this.W / 2, this.H - 56);
  },

  _label(ctx, text, x, y, accent) {
    ctx.fillStyle = accent;
    this._rrect(ctx, x, y - 34, 8 + ctx.measureText(text).width + 64, 64, 32); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '700 34px ' + this.FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 32, y);
  },

  // 0) 封面卡（渐变底 + 大标题 + 摘要）
  _cover(ctx, set, t) {
    const g = ctx.createLinearGradient(0, 0, this.W, this.H);
    g.addColorStop(0, t.g[0]); g.addColorStop(1, t.g[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.W, this.H);
    ctx.fillStyle = 'rgba(255,255,255,.10)';
    ctx.beginPath(); ctx.arc(940, 200, 150, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(120, 1240, 110, 0, 7); ctx.fill();

    ctx.fillStyle = t.accent; ctx.font = '700 36px ' + this.FONT;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(t.icon + '  ' + t.label + ' · 知识卡片', 84, 110);

    const title = set.title || '知识卡片';
    ctx.fillStyle = this.WHITE; ctx.font = '800 76px ' + this.FONT;
    const tlines = this._wrap(ctx, title, this.W - 168).slice(0, 3);
    let y = 320;
    tlines.forEach(l => { ctx.fillText(l, 84, y); y += 96; });

    if (set.summary) {
      ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = '500 38px ' + this.FONT;
      const slines = this._wrap(ctx, set.summary, this.W - 168).slice(0, 2);
      y += 20;
      slines.forEach(l => { ctx.fillText(l, 84, y); y += 56; });
    }

    const n = (set.cards || []).length;
    ctx.fillStyle = t.accent; ctx.font = '600 36px ' + this.FONT;
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText('共 ' + n + ' 张 · 可逐张保存分享', this.W - 84, this.H - 110);
  },

  // 金句卡（暗底大字）
  _quote(ctx, card, t) {
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, t.g[0]); g.addColorStop(1, t.g[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.W, this.H);
    ctx.fillStyle = 'rgba(255,255,255,.16)';
    ctx.beginPath(); ctx.arc(180, 260, 120, 0, 7); ctx.fill();
    ctx.fillStyle = t.accent; ctx.font = '700 34px ' + this.FONT;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('“', 90, 150);
    const quote = (card.content || '').replace(/^“|”$/g, '');
    ctx.fillStyle = this.WHITE; ctx.font = '800 64px ' + this.FONT;
    const lines = this._wrap(ctx, quote, this.W - 200).slice(0, 7);
    let y = 360;
    lines.forEach(l => { ctx.fillText(l, 90, y); y += 92; });
    ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.font = '600 34px ' + this.FONT;
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText('—— 金句 · 知卡', this.W - 84, this.H - 90);
  },

  // 概念卡（白底 + 左色条 + 标签）
  _concept(ctx, card, t) {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, this.W, this.H);
    ctx.fillStyle = t.accent; ctx.fillRect(0, 0, 14, this.H);
    ctx.fillStyle = t.g[0]; ctx.font = '800 52px ' + this.FONT;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('概念', 100, 150);
    ctx.fillStyle = t.accent; ctx.fillRect(100, 230, 120, 8);
    ctx.fillStyle = this.INK; ctx.font = '600 46px ' + this.FONT;
    const lines = this._wrap(ctx, card.content, this.W - 220).slice(0, 12);
    let y = 320;
    lines.forEach(l => { ctx.fillText(l, 100, y); y += 74; });
    this._foot(ctx, t);
  },

  // 对比卡（白底双栏）
  _compare(ctx, card, t) {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, this.W, this.H);
    this._brandBar(ctx);
    ctx.fillStyle = t.g[0]; ctx.font = '800 52px ' + this.FONT;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('对比', 100, 150);
    // 左右分隔
    ctx.strokeStyle = 'rgba(0,0,0,.08)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(this.W / 2, 280); ctx.lineTo(this.W / 2, this.H - 160); ctx.stroke();
    const parts = String(card.content || '').split(/\n|；|;|，|、|→|vs|VS|Vs/u);
    const half = (this.W - 220) / 2;
    parts.slice(0, 2).forEach((part, i) => {
      const cx = i === 0 ? 100 : this.W / 2 + 40;
      ctx.fillStyle = t.accent; ctx.font = '700 40px ' + this.FONT;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(i === 0 ? 'A' : 'B', cx, 300);
      ctx.fillStyle = this.INK; ctx.font = '600 40px ' + this.FONT;
      const lines = this._wrap(ctx, part.replace(/^[AB][：:]/, ''), half).slice(0, 8);
      let y = 360;
      lines.forEach(l => { ctx.fillText(l, cx, y); y += 62; });
    });
    this._foot(ctx, t);
  },

  // 方法论卡（白底编号清单）
  _method(ctx, card, t) {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, this.W, this.H);
    this._brandBar(ctx);
    ctx.fillStyle = this.INK; ctx.font = '800 52px ' + this.FONT;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('方法论', 100, 150);
    const items = String(card.content || '').split(/[；;\n，、→]/u).map(s => s.trim()).filter(Boolean).slice(0, 5);
    let y = 300;
    items.forEach((it, i) => {
      ctx.fillStyle = t.accent;
      ctx.beginPath(); ctx.arc(124, y + 34, 34, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '800 38px ' + this.FONT;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), 124, y + 38);
      ctx.fillStyle = this.INK; ctx.font = '600 42px ' + this.FONT;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      const lines = this._wrap(ctx, it, this.W - 280).slice(0, 2);
      lines.forEach(l => { ctx.fillText(l, 200, y); y += 60; });
      y += 44;
    });
    this._foot(ctx, t);
  },

  // 时间线卡（白底竖向时间轴）
  _timeline(ctx, card, t) {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, this.W, this.H);
    this._brandBar(ctx);
    ctx.fillStyle = this.INK; ctx.font = '800 52px ' + this.FONT;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('时间线', 100, 150);
    const nodes = String(card.content || '').split(/[；;\n，、→]/u).map(s => s.trim()).filter(Boolean).slice(0, 5);
    let y = 300;
    ctx.strokeStyle = t.accent; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(130, y); ctx.lineTo(130, y + (nodes.length - 1) * 180); ctx.stroke();
    nodes.forEach((nd, i) => {
      ctx.fillStyle = t.accent;
      ctx.beginPath(); ctx.arc(130, y + 30, 18, 0, 7); ctx.fill();
      ctx.fillStyle = this.INK; ctx.font = '600 40px ' + this.FONT;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      const lines = this._wrap(ctx, nd, this.W - 260).slice(0, 2);
      lines.forEach(l => { ctx.fillText(l, 200, y); y += 58; });
      y += 70;
    });
    this._foot(ctx, t);
  },

  // 数据卡（暗底大数字）
  _data(ctx, card, t) {
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, t.g[0]); g.addColorStop(1, t.g[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.W, this.H);
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    ctx.beginPath(); ctx.arc(920, 1180, 150, 0, 7); ctx.fill();
    const content = card.content || '';
    const m = content.match(/([\d.]+%?)/);
    const num = m ? m[1] : '';
    const rest = num ? content.replace(num, '').trim() : content;
    ctx.fillStyle = t.accent; ctx.font = '700 36px ' + this.FONT;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('📊 数据', 84, 160);
    if (num) {
      ctx.fillStyle = this.WHITE; ctx.font = '900 200px ' + this.FONT;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(num, this.W / 2, 560);
    }
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.font = '500 44px ' + this.FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const lines = this._wrap(ctx, rest, this.W - 200).slice(0, 4);
    let y = 720;
    lines.forEach(l => { ctx.fillText(l, this.W / 2, y); y += 64; });
    this._foot(ctx, t);
  },

  _router(type) {
    return {
      quote: this._quote.bind(this),
      concept: this._concept.bind(this),
      compare: this._compare.bind(this),
      method: this._method.bind(this),
      timeline: this._timeline.bind(this),
      data: this._data.bind(this)
    }[type] || this._concept.bind(this);
  },

  // 生成整套：第 0 张封面 + 各知识卡，返回 [dataURL,...]
  generateSet(set, opts) {
    const t = this._theme((opts && opts.theme) || set.theme);
    const out = [];
    // 封面
    let c = document.createElement('canvas'); c.width = this.W; c.height = this.H;
    let x = c.getContext('2d'); x.textBaseline = 'top';
    this._cover(x, set, t); out.push(c.toDataURL('image/jpeg', 0.92));
    // 各卡
    (set.cards || []).forEach(card => {
      const cc = document.createElement('canvas'); cc.width = this.W; cc.height = this.H;
      const cx = cc.getContext('2d'); cx.textBaseline = 'top';
      this._router(card.type)(cx, card, t);
      out.push(cc.toDataURL('image/jpeg', 0.92));
    });
    return out;
  }
};

// 暴露到 window，给 app.js / page.evaluate(WebView/Playwright) 用
window.KnowledgeCards = KnowledgeCards;
