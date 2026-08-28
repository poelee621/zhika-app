// knowledge_cards.js —— 知卡知识卡片生成器
// 设计：5 套模板（极简/小红书/杂志/文艺/信息图），根据内容自适应排版
// 1080×1440 (3:4) 单图 JPEG；首图带主题+首观点；如有多张观点再出第 2 张信息图
// 用户可在 index.html 顶部切模板，重渲染当前 set

const KnowledgeCards = {
  W: 1080, H: 1440,
  INK: '#1a1a1a', SUB: '#8a8a8a', WHITE: '#ffffff',
  SOFT: '#faf7f2',                                   // 文艺米色底
  FONT: '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif',
  FONT_SERIF: '"Songti SC","Source Han Serif SC","STSong","SimSun",serif',

  // 5 套可挑模板（UI 上展示用）
  TEMPLATES: {
    minimal:     { key: 'minimal',     label: '极简',  icon: '⬜', desc: '白底大字，留白极简' },
    xiaohongshu: { key: 'xiaohongshu', label: '小红书', icon: '🌸', desc: '渐变色块+装饰，社交感强' },
    magazine:    { key: 'magazine',    label: '杂志',  icon: '📰', desc: '白底标题分级，长文友好' },
    literary:    { key: 'literary',    label: '文艺',  icon: '🎨', desc: '米黄衬线，引号大字' },
    infograph:   { key: 'infograph',   label: '信息图', icon: '📊', desc: '多色卡片阵列，观点多时用' }
  },

  _theme(key) {
    return (window.CoverEngine && window.CoverEngine.THEMES[key]) || (window.CoverEngine && window.CoverEngine.THEMES.knowledge) || { g: ['#222', '#444'], accent: '#fff', ink: '#fff', tint: '#eee', icon: '📚', label: '知卡' };
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

  // 根据字符长度选字号：长文缩小、短文放大；maxCap 是该模板的上限
  _pickFontSize(len, maxCap) {
    if (len <= 20) return Math.min(150, maxCap);
    if (len <= 40) return Math.min(110, maxCap);
    if (len <= 80) return Math.min(80, maxCap);
    if (len <= 160) return Math.min(58, maxCap);
    if (len <= 320) return Math.min(44, maxCap);
    return Math.min(36, maxCap);
  },

  // ==================== 模板选择策略（AI 没指定时根据内容字数自动选）====================
  pickTemplate(set) {
    const cards = set.cards || [];
    if (!cards.length) return 'minimal';
    if (cards.length === 1) {
      const len = (cards[0].content || '').length;
      if (len <= 28) return 'minimal';          // 短→极简强留白
      if (len <= 90) return 'xiaohongshu';      // 中→小红书氛围
      return 'magazine';                         // 长→杂志段落
    }
    if (cards.length <= 3) return 'xiaohongshu';
    return 'infograph';                          // 多观点 → 信息图
  },

  // ==================== 主入口：返回 [dataURL1, dataURL2?] ====================
  generateSet(set, opts) {
    opts = opts || {};
    const t = this._theme((opts && opts.theme) || (set && set.theme));
    const template = opts.template || (set && set.template) || this.pickTemplate(set);
    const cards = Array.isArray(set && set.cards) ? set.cards.slice(0, 6) : [];

    const out = [];

    // 主图：覆盖标题 + 摘要 + 首条观点（如有）
    let c = document.createElement('canvas'); c.width = this.W; c.height = this.H;
    const x = c.getContext('2d'); x.textBaseline = 'top';
    this._renderByTemplate(template, x, set || {}, t, cards);
    out.push(c.toDataURL('image/jpeg', 0.92));

    // 多观点 + 模板适合多张 → 再出一张"补充"
    if (cards.length > 1 && (template === 'infograph' || template === 'xiaohongshu' || template === 'magazine')) {
      const c2 = document.createElement('canvas'); c2.width = this.W; c2.height = this.H;
      const x2 = c2.getContext('2d'); x2.textBaseline = 'top';
      this._renderRest(x2, set || {}, t, cards, template);
      out.push(c2.toDataURL('image/jpeg', 0.92));
    }
    return out;
  },

  _renderByTemplate(tpl, ctx, set, t, cards) {
    const map = {
      minimal: () => this._renderMinimal(ctx, set, t, cards),
      xiaohongshu: () => this._renderXiaohongshu(ctx, set, t, cards),
      magazine: () => this._renderMagazine(ctx, set, t, cards),
      literary: () => this._renderLiterary(ctx, set, t, cards),
      infograph: () => this._renderInfograph(ctx, set, t, cards)
    };
    (map[tpl] || map.xiaohongshu)();
  },

  // ==================== 模板1：极简（白底大字强留白）====================
  // 适合 1 张短观点（≤28 字）
  _renderMinimal(ctx, set, t, cards) {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, this.W, this.H);
    const mainText = (cards[0] && cards[0].content) || (set && set.title) || '';
    const accent = t.accent || '#3b5bdb';

    // 顶标：主题+知卡
    ctx.fillStyle = accent; ctx.fillRect(96, 96, 50, 6);
    ctx.fillStyle = t.g[0]; ctx.font = '600 30px ' + this.FONT;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText((t.icon || '📚') + '  ' + (t.label || '知卡'), 96, 124);

    // 大字观点（按字数自适应）
    const fs = this._pickFontSize(mainText.length, 150);
    ctx.fillStyle = this.INK;
    ctx.font = `800 ${fs}px ${this.FONT}`;
    const lines = this._wrap(ctx, mainText, this.W - 200);
    const lineH = fs * 1.28;
    const totalH = lines.length * lineH;
    let y = Math.max(260, (this.H - totalH) / 2 - 60);
    lines.forEach(l => { ctx.fillText(l, 100, y); y += lineH; });

    // 标题/摘要
    const subTitle = set.title && set.title !== mainText ? set.title : '';
    if (subTitle) {
      ctx.fillStyle = this.SUB; ctx.font = '500 32px ' + this.FONT;
      const sl = this._wrap(ctx, subTitle, this.W - 200).slice(0, 1);
      if (sl[0]) ctx.fillText('— ' + sl[0], 100, this.H - 280);
    }
    // 底部水印
    ctx.fillStyle = this.SUB; ctx.font = '400 24px ' + this.FONT;
    ctx.textAlign = 'right';
    ctx.fillText('知卡 · 内容变知识卡片', this.W - 100, this.H - 80);
    ctx.textAlign = 'left';
    ctx.fillText(set.summary || '', 100, this.H - 80);
  },

  // ==================== 模板2：小红书卡（渐变色块+装饰+大字+标签）====================
  // 适合 1~3 张中等长度观点
  _renderXiaohongshu(ctx, set, t, cards) {
    // 渐变底
    const g = ctx.createLinearGradient(0, 0, this.W, this.H);
    g.addColorStop(0, t.g[0]); g.addColorStop(1, t.g[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.W, this.H);

    // 装饰圆 + 模糊光斑
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    ctx.beginPath(); ctx.arc(940, 200, 160, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(120, 1240, 120, 0, 7); ctx.fill();
    ctx.fillStyle = t.accent;
    ctx.beginPath(); ctx.arc(this.W - 140, 880, 38, 0, 7); ctx.fill();

    // 顶部标签条
    ctx.fillStyle = t.accent;
    this._rrect(ctx, 96, 110, 220, 60, 30); ctx.fill();
    ctx.fillStyle = this.INK; ctx.font = '700 30px ' + this.FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText((t.icon || '📚') + ' ' + (t.label || '知卡'), 96 + 110, 110 + 30);

    // 标题
    const title = (set && set.title) || '';
    if (title) {
      ctx.fillStyle = t.ink || this.WHITE; ctx.font = '700 60px ' + this.FONT;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      const tlines = this._wrap(ctx, title, this.W - 200).slice(0, 2);
      let y = 220;
      tlines.forEach(l => { ctx.fillText(l, 100, y); y += 78; });
    }

    // 大字观点（首条）
    const mainText = (cards[0] && cards[0].content) || '';
    if (mainText) {
      const fs = this._pickFontSize(mainText.length, 110);
      ctx.fillStyle = t.ink || this.WHITE;
      ctx.font = `900 ${fs}px ${this.FONT}`;
      const lines = this._wrap(ctx, mainText, this.W - 240).slice(0, 6);
      const lineH = fs * 1.32;
      let y = Math.max(440, (this.H - lines.length * lineH) / 2);
      lines.forEach(l => { ctx.fillText(l, 120, y); y += lineH; });
    }

    // 底部小红书风标签条
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    this._rrect(ctx, 100, this.H - 220, this.W - 200, 120, 60); ctx.fill();
    ctx.fillStyle = t.ink || this.WHITE; ctx.font = '500 32px ' + this.FONT;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const sm = (set && set.summary) || '点击下方发布到知卡社区';
    const smLines = this._wrap(ctx, sm, this.W - 260).slice(0, 2);
    smLines.forEach((l, i) => ctx.fillText(l, 130, this.H - 220 + 40 + i * 44));

    // 右下小字
    ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = '400 22px ' + this.FONT;
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText('· 知卡 ZhiCard ·', this.W - 100, this.H - 36);
  },

  // ==================== 模板3：杂志风（白底+标题分级+正文段落）====================
  // 适合 1 张长观点（>90 字）
  _renderMagazine(ctx, set, t, cards) {
    // 白底 + 顶部色条
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, this.W, this.H);
    ctx.fillStyle = t.g[0]; ctx.fillRect(0, 0, this.W, 120);

    // 杂志头部色条
    ctx.fillStyle = t.accent; ctx.fillRect(80, 80, 80, 8);

    // 标题
    ctx.fillStyle = t.ink || this.WHITE;
    ctx.font = '700 48px ' + this.FONT;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText((t.icon || '📚') + ' ' + (t.label || '知卡') + ' · 知卡', 80, 50);

    // 大标题
    const title = (set && set.title) || '';
    ctx.fillStyle = this.INK;
    ctx.font = '800 80px ' + this.FONT;
    const tl = this._wrap(ctx, title, this.W - 160).slice(0, 2);
    let y = 200;
    tl.forEach(l => { ctx.fillText(l, 80, y); y += 100; });

    // 副标/摘要
    if (set && set.summary) {
      ctx.fillStyle = t.g[0];
      ctx.font = 'italic 36px ' + this.FONT_SERIF;
      const sl = this._wrap(ctx, set.summary, this.W - 160).slice(0, 1);
      if (sl[0]) { ctx.fillText(sl[0], 80, y + 18); y += 80; }
    }

    // 分隔线
    ctx.fillStyle = t.accent; ctx.fillRect(80, y + 18, 60, 4);

    // 正文（首条观点，多段）
    const mainText = (cards[0] && cards[0].content) || '';
    const fs = this._pickFontSize(mainText.length, 64);
    ctx.fillStyle = this.INK; ctx.font = `500 ${fs}px ${this.FONT}`;
    const maxLines = Math.floor((this.H - y - 200) / (fs * 1.7));
    const bodyLines = this._wrap(ctx, mainText, this.W - 160).slice(0, maxLines);
    let by = y + 50;
    const lh = fs * 1.7;
    bodyLines.forEach(l => { ctx.fillText(l, 80, by); by += lh; });

    // 底部页脚
    ctx.fillStyle = this.SUB; ctx.font = '400 24px ' + this.FONT;
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText('知卡 ZhiCard · Page 1', this.W - 80, this.H - 60);
  },

  // ==================== 模板4：文艺（米黄底+衬线+引号大字）====================
  _renderLiterary(ctx, set, t, cards) {
    ctx.fillStyle = this.SOFT; ctx.fillRect(0, 0, this.W, this.H);
    // 米色柔和渐变
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, '#fdfaf3'); g.addColorStop(1, '#f0e9d8');
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.W, this.H);

    // 装饰线
    ctx.strokeStyle = t.g[0]; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(80, 100); ctx.lineTo(80, this.H - 100); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(this.W - 80, 100); ctx.lineTo(this.W - 80, this.H - 100); ctx.stroke();

    // 顶部题款
    ctx.fillStyle = t.g[0]; ctx.font = 'italic 28px ' + this.FONT_SERIF;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText((t.icon || '📚') + ' ' + (t.label || '知卡'), 100, 90);

    // 引号大字
    const mainText = (cards[0] && cards[0].content) || '';
    ctx.fillStyle = t.g[0]; ctx.font = '900 200px ' + this.FONT_SERIF;
    ctx.fillText('“', 80, 140);

    // 大字观点（衬线）
    const fs = this._pickFontSize(mainText.length, 96);
    ctx.fillStyle = '#1a1a1a'; ctx.font = `600 ${fs}px ${this.FONT_SERIF}`;
    const lines = this._wrap(ctx, mainText, this.W - 280).slice(0, 6);
    const lh = fs * 1.32;
    let y = 280;
    lines.forEach(l => { ctx.fillText(l, 140, y); y += lh; });

    // 收尾引号
    ctx.fillStyle = t.g[0]; ctx.font = '900 200px ' + this.FONT_SERIF;
    if (y < this.H - 280) ctx.fillText('”', this.W - 200, y - 40);

    // 标题（署名）
    ctx.fillStyle = this.INK; ctx.font = 'italic 36px ' + this.FONT_SERIF;
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    if (set && set.title) ctx.fillText('— ' + set.title, this.W - 130, this.H - 140);

    ctx.fillStyle = this.SUB; ctx.font = '400 20px ' + this.FONT_SERIF;
    ctx.fillText('知卡 ZhiCard', this.W - 130, this.H - 90);
  },

  // ==================== 模板5：信息图（多色块卡片阵列）====================
  _renderInfograph(ctx, set, t, cards) {
    // 米色底
    ctx.fillStyle = this.SOFT; ctx.fillRect(0, 0, this.W, this.H);
    // 顶条
    ctx.fillStyle = t.g[0]; ctx.fillRect(0, 0, this.W, 110);

    ctx.fillStyle = t.ink || this.WHITE; ctx.font = '700 36px ' + this.FONT;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText((t.icon || '📚') + ' ' + (t.label || '知卡') + ' · 知卡', 80, 36);

    // 标题
    if (set && set.title) {
      ctx.fillStyle = this.INK; ctx.font = '700 56px ' + this.FONT;
      const tl = this._wrap(ctx, set.title, this.W - 160).slice(0, 2);
      let y = 130;
      tl.forEach(l => { ctx.fillText(l, 80, y); y += 70; });
    }

    // 每条观点一块色卡
    const list = cards.slice(0, 4);
    const cardW = this.W - 160, cardH = 180;
    const startY = 280;
    list.forEach((c, i) => {
      const cy = startY + i * (cardH + 22);
      // 卡底
      ctx.fillStyle = '#fff';
      this._rrect(ctx, 80, cy, cardW, cardH, 24); ctx.fill();
      // 左色条
      ctx.fillStyle = t.g[0];
      this._rrect(ctx, 80, cy, 12, cardH, 24); ctx.fill();
      // 序号
      ctx.fillStyle = t.accent;
      ctx.font = '900 50px ' + this.FONT;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), 116, cy + 30);
      // 文字
      ctx.fillStyle = this.INK; ctx.font = '600 36px ' + this.FONT;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      const lines = this._wrap(ctx, c.content || '', cardW - 120).slice(0, 3);
      let cy2 = cy + 28;
      lines.forEach(l => { ctx.fillText(l, 196, cy2); cy2 += 52; });
    });

    // 底部
    ctx.fillStyle = this.SUB; ctx.font = '400 22px ' + this.FONT;
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText('知卡 · 内容变知识卡片', this.W - 80, this.H - 36);
  },

  // ==================== 多观点补充页（用同模板的另一张布局）====================
  _renderRest(ctx, set, t, cards, template) {
    const rest = cards.slice(1);
    if (!rest.length) return;
    if (template === 'infograph') {
      // 重新走信息图，剔除首条
      this._renderInfograph(ctx, { ...set, title: '更多观点' }, t, rest);
      return;
    }
    if (template === 'magazine') {
      // 杂志风：左色条 + 多段正文
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, this.W, this.H);
      ctx.fillStyle = t.g[0]; ctx.fillRect(0, 0, 14, this.H);
      ctx.fillStyle = t.g[0]; ctx.font = '700 56px ' + this.FONT;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('更多观点', 80, 100);
      let y = 200;
      rest.slice(0, 4).forEach((c, i) => {
        // 编号
        ctx.fillStyle = t.accent;
        ctx.font = '900 60px ' + this.FONT;
        ctx.fillText(String(i + 1) + '.', 80, y);
        ctx.fillStyle = this.INK;
        ctx.font = '600 38px ' + this.FONT;
        const lines = this._wrap(ctx, c.content || '', this.W - 220).slice(0, 3);
        let cy = y;
        lines.forEach(l => { ctx.fillText(l, 200, cy); cy += 56; });
        y = cy + 30;
      });
      ctx.fillStyle = this.SUB; ctx.font = '400 22px ' + this.FONT;
      ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      ctx.fillText('知卡 · Page 2', this.W - 80, this.H - 60);
      return;
    }
    // 小红书补充页：色块列表
    const g = ctx.createLinearGradient(0, 0, this.W, this.H);
    g.addColorStop(0, t.g[0]); g.addColorStop(1, t.g[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.W, this.H);
    ctx.fillStyle = 'rgba(255,255,255,.10)';
    ctx.beginPath(); ctx.arc(100, 1240, 120, 0, 7); ctx.fill();
    ctx.fillStyle = t.accent; ctx.font = '700 56px ' + this.FONT;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('更多观点', 96, 110);
    let y = 220;
    rest.slice(0, 3).forEach((c, i) => {
      ctx.fillStyle = t.accent;
      ctx.beginPath(); ctx.arc(130, y + 38, 30, 0, 7); ctx.fill();
      ctx.fillStyle = t.ink || this.WHITE; ctx.font = '900 30px ' + this.FONT;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), 130, y + 42);
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillStyle = t.ink || this.WHITE;
      ctx.font = '700 40px ' + this.FONT;
      const lines = this._wrap(ctx, c.content || '', this.W - 260).slice(0, 3);
      let cy = y;
      lines.forEach(l => { ctx.fillText(l, 200, cy); cy += 56; });
      y = cy + 30;
    });
  }
};

window.KnowledgeCards = KnowledgeCards;
