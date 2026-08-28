// app.js —— 知卡主逻辑：来源切换 / 摄取 / 生成 / 出图 / 复习 / 会员墙
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  // ===== 测试期：取消知卡 PRO 会员墙，全功能无限量使用 =====
  // 上线付费时把此处改为 false，并在 refreshVip / produceCards 恢复会员校验
  const TEST_UNLIMITED = true;

  // ===== 免费档每日限额（测试期被 TEST_UNLIMITED 覆盖，不再拦截）=====
  const FREE_DAILY = 3;
  function genCount() {
    const d = new Date().toDateString();
    const stored = JSON.parse(localStorage.getItem('zhika_gen') || '{}');
    if (stored.date !== d) { localStorage.setItem('zhika_gen', JSON.stringify({ date: d, n: 0 })); return 0; }
    return stored.n;
  }
  function bumpGen() {
    const d = new Date().toDateString();
    const stored = JSON.parse(localStorage.getItem('zhika_gen') || '{}');
    stored.date = d; stored.n = (stored.n || 0) + 1;
    localStorage.setItem('zhika_gen', JSON.stringify(stored));
  }
  function isVip() { return TEST_UNLIMITED || localStorage.getItem('zhika_vip') === '1'; }

  function setStatus(msg, show) {
    const el = $('#status');
    if (!show) { el.classList.add('hidden'); el.textContent = ''; return; }
    // 支持富文本：{ title, body } 两行，title 加粗（用于错误提示）
    if (msg && typeof msg === 'object') {
      const safe = (s) => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      el.innerHTML = `<b>${safe(msg.title)}</b>${msg.body ? `<br/><span class="muted">${safe(msg.body)}</span>` : ''}`;
    } else {
      el.textContent = msg;
    }
    el.classList.remove('hidden');
  }

  function refreshVip() {
    // 测试期：彻底隐藏 PRO 升级入口与徽章，全功能无限量
    if (TEST_UNLIMITED) {
      $('#vipBadge').classList.add('hidden');
      $('#vipBtn').classList.add('hidden');
      return;
    }
    const vip = isVip();
    $('#vipBadge').classList.toggle('hidden', !vip);
    $('#vipBtn').classList.toggle('hidden', vip);
  }

  // ===== Tab 切换 =====
  $$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach(t => t.classList.remove('active'));
      $$('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      $(`.panel[data-panel="${tab.dataset.src}"]`).classList.add('active');
    });
  });

  // ===== 生成流程 =====
  let lastSet = null;
  let currentTheme = null;
  let currentTemplate = null;   // 当前排版模板；空字符串 = 走 lastSet.template / pickTemplate 自动
  async function produceCards(text, source) {
    if (!isVip() && genCount() >= FREE_DAILY) {
      openVip('今日免费次数已用完，升级 PRO 无限生成');
      return;
    }
    if (!text || text.trim().length < 20) { setStatus('内容太短，至少 20 字', true); return; }
    setStatus('AI 正在提炼知识卡片…（约 10-30 秒）', true);
    try {
      const set = await LLM.callCards(text, { source: source || '' });
      lastSet = set;
      if (!isVip()) bumpGen();
      renderResult(set);
      setStatus('', false);
    } catch (e) {
      console.error(e);
      setStatus('生成失败：' + (e.message || e) + '（可重试或改用文本模式）', true);
    }
  }

  function renderResult(set) {
    $('#result').classList.remove('hidden');
    $('#resultTitle').textContent = set.title || '知识卡片';
    $('#resultSummary').textContent = set.summary || '';
    currentTheme = set.theme || 'knowledge';
    currentTemplate = (set && set.template) || '';   // AI 推荐 → 用户可换
    const list = $('#cardList'); list.innerHTML = '';
    const urls = KnowledgeCards.generateSet(set, { theme: currentTheme, template: currentTemplate });
    paintCards(list, urls, set);
    $('#result').dataset.urls = JSON.stringify(urls);
    renderThemeBar();
    renderTemplateBar();
  }

  // 把 DataURL 列表画进卡片网格（封面 + 各卡），点击单图 → 全屏预览
  function paintCards(list, urls, set) {
    list.innerHTML = '';
    urls.forEach((u, i) => {
      const label = i === 0 ? '封面' : '补充观点';
      const item = document.createElement('div');
      item.className = 'card-item';
      item.innerHTML = `<img src="${u}" alt="card"/><span class="cap">${label}</span>`;
      item.addEventListener('click', () => openPreview(urls, i));
      list.appendChild(item);
    });
  }

  // ===== 全屏图片预览：长按保存 / 分享社媒 / 发布社区 =====
  let previewUrls = [], previewIdx = 0;
  function openPreview(urls, idx) {
    previewUrls = urls; previewIdx = idx;
    renderPreview();
    $('#previewModal').classList.remove('hidden');
  }
  function renderPreview() {
    $('#previewImg').src = previewUrls[previewIdx];
    $('#previewCount').textContent = (previewIdx + 1) + ' / ' + previewUrls.length;
    const multi = previewUrls.length > 1;
    $('#prevImg').classList.toggle('hidden', previewIdx === 0 || !multi);
    $('#nextImg').classList.toggle('hidden', previewIdx >= previewUrls.length - 1 || !multi);
  }
  function closePreview() { $('#previewModal').classList.add('hidden'); }
  function stepPreview(delta) {
    const n = previewUrls.length; if (!n) return;
    previewIdx = (previewIdx + delta + n) % n;
    renderPreview();
  }
  $('#closePreview').addEventListener('click', closePreview);
  $('#previewModal').addEventListener('click', (ev) => { if (ev.target.id === 'previewModal') closePreview(); });
  $('#prevImg').addEventListener('click', () => stepPreview(-1));
  $('#nextImg').addEventListener('click', () => stepPreview(1));
  // 左右滑动切换
  let touchX = null;
  $('#previewStage').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  $('#previewStage').addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 50) stepPreview(dx < 0 ? 1 : -1);
    touchX = null;
  }, { passive: true });

  // 保存单张（触发下载；iOS 提示长按保存到相册）
  $('#pvSave').addEventListener('click', () => {
    const u = previewUrls[previewIdx]; if (!u) return;
    const a = document.createElement('a');
    a.href = u; a.download = '知卡_' + (previewIdx + 1) + '.jpg';
    document.body.appendChild(a); a.click(); a.remove();
    setStatus('已触发保存（iOS 也可长按图片直接存相册）', true);
    setTimeout(() => setStatus('', false), 2500);
  });

  // 分享单张到其他社媒（Web Share API，含图片文件）
  $('#pvShare').addEventListener('click', async () => {
    const u = previewUrls[previewIdx]; if (!u) return;
    try {
      if (navigator.share && !isWeb()) {
        // iOS 原生分享（可带图片文件 → 微信/相册等）
        const blob = await (await fetch(u)).blob();
        const file = new File([blob], '知卡_' + (previewIdx + 1) + '.jpg', { type: 'image/jpeg' });
        await navigator.share({ title: '知卡知识卡片', files: [file] });
      } else if (navigator.share) {
        // Web：分享链接/文案
        await navigator.share({ title: '知卡知识卡片', text: lastSet ? lastSet.title || '知卡知识卡片' : '知卡知识卡片' });
      } else {
        throw new Error('unsupported');
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return; // 用户取消
      // 降级：复制当前图片 dataURL 到剪贴板不可行（太大），提示长按保存
      setStatus('当前浏览器不支持一键分享，可长按图片保存后手动分享', true);
      setTimeout(() => setStatus('', false), 2500);
    }
  });

  // 发布当前图片到知卡社区（单张发布）
  $('#pvPublish').addEventListener('click', () => {
    const u = previewUrls[previewIdx]; if (!u) return;
    if (window.COMM) {
      const singleSet = lastSet ? { title: lastSet.title || '知识卡片', summary: lastSet.summary || '', theme: currentTheme || lastSet.theme, cards: lastSet.cards || [] } : {};
      COMM.openPublish([u], singleSet);
    } else {
      setStatus('社区功能未加载，请刷新后重试', true);
    }
    closePreview();
  });

  // 主题切换条：列出 CoverEngine 的全部主题，点击即时换配色重渲染
  function renderThemeBar() {
    const bar = $('#themeBar'); if (!bar) return;
    const themes = (window.CoverEngine && window.CoverEngine.THEMES) || {};
    const keys = Object.keys(themes);
    if (!keys.length) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden'); bar.innerHTML = '';
    const label = document.createElement('span');
    label.className = 'theme-label'; label.textContent = '主题配色：';
    bar.appendChild(label);
    keys.forEach(k => {
      const t = themes[k];
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'theme-chip' + (k === currentTheme ? ' active' : '');
      chip.textContent = t.icon + ' ' + t.label;
      chip.style.background = k === currentTheme ? t.accent : '#fff';
      chip.style.color = k === currentTheme ? '#1a1a1a' : '#555';
      chip.style.borderColor = t.accent;
      chip.onclick = () => applyTheme(k);
      bar.appendChild(chip);
    });
  }

  function applyTheme(theme) {
    if (!lastSet) return;
    currentTheme = theme;
    const urls = KnowledgeCards.generateSet(lastSet, { theme, template: currentTemplate });
    paintCards($('#cardList'), urls, lastSet);
    $('#result').dataset.urls = JSON.stringify(urls);
    renderThemeBar();
    renderTemplateBar();
    const name = ((window.CoverEngine.THEMES[theme] || {}).label) || theme;
    setStatus('已切换主题：' + name, true);
    setTimeout(() => setStatus('', false), 1800);
  }

  // 模板选择器（5 套）
  function renderTemplateBar() {
    const bar = $('#templateBar'); if (!bar) return;
    const tpls = (window.KnowledgeCards && window.KnowledgeCards.TEMPLATES) || {};
    const keys = Object.keys(tpls);
    if (!keys.length) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden'); bar.innerHTML = '';
    // 当前实际生效的模板（用户手选 vs 自动）
    const active = currentTemplate || (lastSet && lastSet.template) || (KnowledgeCards && KnowledgeCards.pickTemplate(lastSet || { cards: [] })) || 'minimal';
    const label = document.createElement('span');
    label.className = 'theme-label'; label.textContent = '排版：';
    bar.appendChild(label);
    keys.forEach(k => {
      const tp = tpls[k];
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'theme-chip' + (k === active ? ' active' : '');
      chip.title = tp.desc || '';
      chip.textContent = tp.icon + ' ' + tp.label;
      if (k === active) { chip.style.background = 'var(--brand)'; chip.style.color = '#fff'; chip.style.borderColor = 'var(--brand)'; }
      chip.onclick = () => applyTemplate(k);
      bar.appendChild(chip);
    });
  }
  function applyTemplate(tpl) {
    if (!lastSet) return;
    currentTemplate = tpl;
    const urls = KnowledgeCards.generateSet(lastSet, { theme: currentTheme, template: tpl });
    paintCards($('#cardList'), urls, lastSet);
    $('#result').dataset.urls = JSON.stringify(urls);
    renderTemplateBar();
    const label = (KnowledgeCards.TEMPLATES[tpl] || {}).label || tpl;
    setStatus('已切换排版：' + label, true);
    setTimeout(() => setStatus('', false), 1800);
  }

  // 复制全部文案到剪贴板
  function buildCopyText(set) {
    if (!set) return '';
    let txt = (set.title || '知识卡片') + '\n';
    if (set.summary) txt += set.summary + '\n';
    txt += '\n';
    (set.cards || []).forEach(c => { txt += (c.label || '卡片') + '：' + (c.content || '') + '\n\n'; });
    txt += '—— 知卡 ZhiCard · 把内容变成你的知识卡片';
    return txt.trim();
  }
  async function copyText() {
    if (!lastSet) return;
    const txt = buildCopyText(lastSet);
    try {
      await navigator.clipboard.writeText(txt);
      setStatus('已复制全部文案到剪贴板', true);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); setStatus('已复制全部文案到剪贴板', true); }
      catch (_) { setStatus('复制失败，请手动选择文字', true); }
      ta.remove();
    }
    setTimeout(() => setStatus('', false), 2000);
  }

  // ===== 复制全部文案 =====
  $('#copyBtn').addEventListener('click', copyText);

  // ===== 发布到社区 =====
  $('#publishBtn').addEventListener('click', () => {
    const urls = JSON.parse($('#result').dataset.urls || '[]');
    if (!urls.length) { setStatus('先生成卡片再发布', true); return; }
    if (window.COMM) COMM.openPublish(urls, lastSet || {});
  });

  // ===== 加入复习 =====
  $('#reviewAddBtn').addEventListener('click', () => {
    if (!lastSet) return;
    SPACED.saveSet(lastSet);
    renderDue();
    setStatus('已加入间隔复习，按遗忘曲线提醒你', true);
    setTimeout(() => setStatus('', false), 2500);
  });

  // ===== 摄取：链接 =====
  $('#ingestBtn').addEventListener('click', async () => {
    const url = $('#urlInput').value.trim();
    if (!url) { setStatus('请先粘贴链接', true); return; }
    const type = $('#linkType').value;
    setStatus(type === 'video' ? '正在提取视频文案/字幕…' : '正在抓取文章内容…', true);
    try {
      const r = type === 'video' ? await INGEST.transcribe(url) : await INGEST.extract(url);
      const text = (r && r.text) || '';
      if (!text.trim()) {
        // 防御：Worker 未识别为空，但 body 仍空
        const e = new Error('未抓到到正文'); e.kind = 'empty'; e.status = 0;
        throw e;
      }
      setStatus('提取成功，正在生成卡片…', true);
      await produceCards(text, r.title || url);
    } catch (e) {
      console.error('[ingest]', e);
      setStatus(INGEST.explainError(e), true);
    }
  });

  // ===== 摄取：图片（用 label[for=fileInput] 原生唤起 iOS 选图器，不依赖原生 Camera 插件）=====
  // 选图后先压成 ≤1280px 的 JPEG 再传，避免原图 4~10MB 拖慢 GLM-4V（OCR 超时主因）
  function compressImageToBase64(file, maxDim, quality) {
    maxDim = maxDim || 1280; quality = quality || 0.85;
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          let { width, height } = img;
          const scale = Math.min(1, maxDim / Math.max(width, height));
          width = Math.round(width * scale); height = Math.round(height * scale);
          const cv = document.createElement('canvas');
          cv.width = width; cv.height = height;
          cv.getContext('2d').drawImage(img, 0, 0, width, height);
          URL.revokeObjectURL(url);
          // 导出 JPEG，去掉前缀 data:image/jpeg;base64,
          const dataUrl = cv.toDataURL('image/jpeg', quality);
          resolve(String(dataUrl).split(',')[1]);
        } catch (e) { reject(e); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片解码失败')); };
      img.src = url;
    });
  }

  (function setupImageUpload() {
    const inp = $('#fileInput');
    if (!inp) return;
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      setStatus('正在压缩图片并识别文字（OCR）…', true);
      try {
        let b64;
        try {
          b64 = await compressImageToBase64(f, 1280, 0.85);
        } catch (e) {
          // 压缩失败兜底：直接读原图（仍可能慢/超时，但至少不报错卡死）
          b64 = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result).split(',')[1]);
            r.onerror = reject; r.readAsDataURL(f);
          });
        }
        if (b64.length > 1800 * 1024) {
          // 仍过大（超大长图）：再压一轮到 900px
          try { b64 = await compressImageToBase64(f, 900, 0.8); } catch (_) {}
        }
        const r = await INGEST.ocr(b64);
        const text = (r && r.text) || '';
        if (!text.trim()) {
          const e = new Error('未识别到文字'); e.kind = 'empty'; e.status = 0;
          throw e;
        }
        setStatus('识别成功，正在生成卡片…', true);
        await produceCards(text, '图片OCR');
      } catch (e) {
        console.error('[ocr]', e);
        setStatus(INGEST.explainError(e), true);
      } finally {
        inp.value = ''; // 允许重复选同一张
      }
    });
  })();

  // ===== 摄取：文本 =====
  $('#genTextBtn').addEventListener('click', () => {
    const text = $('#textInput').value.trim();
    produceCards(text, '手动输入');
  });

  // ===== 复习区 =====
  function renderDue() {
    const due = SPACED.dueToday();
    $('#dueCount').textContent = due.length;
    const box = $('#dueList'); box.innerHTML = '';
    if (!due.length) { box.innerHTML = '<p class="hint">今天没有待复习的卡片，去生成一套吧～</p>'; return; }
    due.forEach(d => {
      const item = document.createElement('div');
      item.className = 'due-item';
      item.innerHTML = `<div><div class="content">${KnowledgeCards ? esc(d.card.content) : d.card.content}</div>
        <div class="meta">${esc(d.setTitle)} · ${d.card.label}</div></div>`;
      const btn = document.createElement('button');
      btn.textContent = '已记住';
      btn.onclick = () => { SPACED.review(d.setId, d.card.cid); renderDue(); };
      item.appendChild(btn);
      box.appendChild(item);
    });
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // ===== 会员 =====
  function isWeb() { return !(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); }
  function vipPrices() {
    const w = window.__zhikaPrices || {};
    return { monthly: w.monthly || '¥18/月', yearly: w.yearly || '¥128/年' };
  }
  function openVip(msg) {
    $('#vipModal').classList.remove('hidden');
    const p = vipPrices();
    $('#buyMonthly').textContent = '按月订阅 ' + p.monthly;
    $('#buyYearly').textContent = '按年订阅（更划算）' + p.yearly;
    if (msg) {
      $('#priceHint').textContent = msg;
    } else if (isWeb()) {
      $('#priceHint').textContent = 'Web 预览版暂不支持购买，请在 iOS App 内升级 PRO';
    } else {
      $('#priceHint').textContent = '';
    }
  }
  $('#vipBtn').addEventListener('click', () => openVip(''));
  $('#closeVip').addEventListener('click', () => $('#vipModal').classList.add('hidden'));
  function webBlockBuy() {
    if (!isWeb()) return false;
    $('#priceHint').textContent = '订阅仅在 iOS App 内可用（Web 预览版）';
    return true;
  }
  function tryBuy(plan, label) {
    if (webBlockBuy()) return;
    $('#priceHint').textContent = '正在拉起 App Store 购买…';
    IAP.purchase(plan).then(ok => {
      if (ok) { refreshVip(); $('#vipModal').classList.add('hidden'); }
      else {
        // 测试 key / 未上架 / 插件未配置 → 给明确反馈而不是静默
        $('#priceHint').textContent = IAP.isConfigured()
          ? '购买未完成（可检查 App Store 登录或稍后重试）'
          : 'App 尚未上架，正式版上线后即可订阅 ' + label;
      }
    });
  }
  $('#buyMonthly').addEventListener('click', () => tryBuy('monthly', vipPrices().monthly));
  $('#buyYearly').addEventListener('click', () => tryBuy('yearly', vipPrices().yearly));
  $('#restoreBtn').addEventListener('click', () => {
    if (webBlockBuy()) return;
    IAP.restore().then(ok => { if (ok) refreshVip(); else $('#priceHint').textContent = '未找到可恢复的订阅'; });
  });

  // ===== 初始化 =====
  refreshVip();
  renderDue();
})();
