// app.js —— 知卡主逻辑：来源切换 / 摄取 / 生成 / 出图 / 复习 / 会员墙
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  // ===== 免费档每日限额（3 次）=====
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
  function isVip() { return localStorage.getItem('zhika_vip') === '1'; }

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

  // ===== 选图（真机用 Camera，web 用 file input）=====
  async function pickImage() {
    const native = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
    if (native && window.Capacitor.Plugins && window.Capacitor.Plugins.Camera) {
      const { Camera } = window.Capacitor.Plugins;
      const photo = await Camera.getPhoto({ quality: 80, resultType: 'base64', source: 'PROMPT' });
      return photo.base64String;
    }
    return await new Promise((resolve, reject) => {
      const inp = $('#fileInput');
      inp.onchange = () => {
        const f = inp.files[0]; if (!f) return reject(new Error('未选择'));
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1]);
        r.onerror = reject; r.readAsDataURL(f);
      };
      inp.click();
    });
  }

  // ===== 生成流程 =====
  let lastSet = null;
  let currentTheme = null;
  async function produceCards(text, source) {
    if (!isVip() && genCount() >= FREE_DAILY) {
      openVip('今日免费次数已用完，升级 PRO 无限生成');
      return;
    }
    if (!text || text.trim().length < 20) { setStatus('内容太短，至少 20 字', true); return; }
    setStatus('AI 正在提炼知识卡片…（约 10-30 秒）', true);
    try {
      const set = await LLM.callCards(text, { source: source || '', count: 6 });
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
    const list = $('#cardList'); list.innerHTML = '';
    const urls = KnowledgeCards.generateSet(set, { theme: currentTheme });
    paintCards(list, urls, set);
    $('#result').dataset.urls = JSON.stringify(urls);
    renderThemeBar();
  }

  // 把 DataURL 列表画进卡片网格（封面 + 各卡）
  function paintCards(list, urls, set) {
    list.innerHTML = '';
    urls.forEach((u, i) => {
      const label = i === 0 ? '封面' : (set.cards[i - 1] && set.cards[i - 1].label) || '卡片';
      const item = document.createElement('div');
      item.className = 'card-item';
      item.innerHTML = `<img src="${u}" alt="card"/><span class="cap">${label}</span>`;
      list.appendChild(item);
    });
  }

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
    const urls = KnowledgeCards.generateSet(lastSet, { theme });
    paintCards($('#cardList'), urls, lastSet);
    $('#result').dataset.urls = JSON.stringify(urls);
    renderThemeBar();
    const name = ((window.CoverEngine.THEMES[theme] || {}).label) || theme;
    setStatus('已切换主题：' + name, true);
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

  // ===== 保存全部图片 =====
  $('#saveAllBtn').addEventListener('click', () => {
    const urls = JSON.parse($('#result').dataset.urls || '[]');
    if (!urls.length) return;
    urls.forEach((u, i) => {
      const a = document.createElement('a');
      a.href = u; a.download = `知卡_${(lastSet && lastSet.title) || 'card'}_${i + 1}.jpg`;
      document.body.appendChild(a); a.click(); a.remove();
    });
    setStatus('已触发下载（iOS 可长按图片保存到相册）', true);
    setTimeout(() => setStatus('', false), 2500);
  });

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

  // ===== 摄取：图片 =====
  $('#pickImgBtn').addEventListener('click', async () => {
    setStatus('请选择图片…', true);
    try {
      const b64 = await pickImage();
      setStatus('正在识别图中文字（OCR）…', true);
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
    }
  });

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
  function openVip(msg) {
    $('#vipModal').classList.remove('hidden');
    if (msg) {
      $('#priceHint').textContent = msg;
    } else if (isWeb()) {
      $('#priceHint').textContent = 'Web 预览版暂不支持购买，请在 iOS App 内升级 PRO';
    }
  }
  $('#vipBtn').addEventListener('click', () => openVip(''));
  $('#closeVip').addEventListener('click', () => $('#vipModal').classList.add('hidden'));
  function webBlockBuy() {
    if (!isWeb()) return false;
    $('#priceHint').textContent = '订阅仅在 iOS App 内可用（Web 预览版）';
    return true;
  }
  $('#buyMonthly').addEventListener('click', () => { if (webBlockBuy()) return; IAP.purchase('monthly').then(ok => { if (ok) { refreshVip(); $('#vipModal').classList.add('hidden'); } }); });
  $('#buyYearly').addEventListener('click', () => { if (webBlockBuy()) return; IAP.purchase('yearly').then(ok => { if (ok) { refreshVip(); $('#vipModal').classList.add('hidden'); } }); });
  $('#restoreBtn').addEventListener('click', () => { if (webBlockBuy()) return; IAP.restore().then(ok => { if (ok) refreshVip(); }); });

  // ===== 初始化 =====
  refreshVip();
  renderDue();
})();
