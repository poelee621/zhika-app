// 封面主题引擎 v1.0 —— 按主题渲染有设计感的封面/卡片（HTML → html2canvas → PNG）
// 不依赖任何外部 CSS；所有样式内联，确保 html2canvas 可稳定转图。
// 主题配色随主题切换，每类含渐变底 + 光晕 + 主题水印 + 装饰 SVG。
// 知卡复用 Spark 的主题库，仅把默认品牌兜底改为「知卡」。
(function (global) {
  'use strict';

  // 10 类主题：label 中文名 / g 渐变(深→浅) / accent 点缀色 / ink 暗底上的字色
  //            / tint 亮卡第二色 / icon 主题图标 / motif 装饰 SVG
  var THEMES = {
    tech: {
      label: '科技', g: ['#0b1f3a', '#1b6ca8'], accent: '#38e8ff', ink: '#eafaff', tint: '#e8f6ff',
      icon: '🤖',
      motif: '<svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid slice"><g fill="none" stroke="#38e8ff" stroke-width="1.2" opacity="0.5"><circle cx="40" cy="40" r="2.5"/><circle cx="80" cy="40" r="2.5"/><circle cx="120" cy="40" r="2.5"/><circle cx="40" cy="80" r="2.5"/><circle cx="80" cy="80" r="2.5"/><circle cx="120" cy="80" r="2.5"/><circle cx="40" cy="120" r="2.5"/><circle cx="80" cy="120" r="2.5"/><circle cx="120" cy="120" r="2.5"/></g><path d="M150 150 L175 150 L175 125" stroke="#38e8ff" stroke-width="2.5" fill="none" opacity="0.6"/></svg>'
    },
    finance: {
      label: '财经', g: ['#06281f', '#0f7a52'], accent: '#ffd166', ink: '#eafff5', tint: '#e9fbf2',
      icon: '💰',
      motif: '<svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid slice"><g fill="#ffd166" opacity="0.55"><rect x="60" y="120" width="18" height="50" rx="3"/><rect x="91" y="95" width="18" height="75" rx="3"/><rect x="122" y="70" width="18" height="100" rx="3"/><rect x="153" y="48" width="18" height="122" rx="3"/></g></svg>'
    },
    emotion: {
      label: '情感', g: ['#3a1c4f', '#b03a6e'], accent: '#ffb3d1', ink: '#fff0f6', tint: '#fdeef5',
      icon: '💗',
      motif: '<svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid slice"><g fill="none" stroke="#ffb3d1" stroke-width="2" opacity="0.5"><circle cx="80" cy="90" r="38"/><circle cx="130" cy="90" r="38"/></g></svg>'
    },
    food: {
      label: '美食', g: ['#3c1a08', '#d2691e'], accent: '#ffd27a', ink: '#fff6ec', tint: '#fdf1e3',
      icon: '🍜',
      motif: '<svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid slice"><g fill="none" stroke="#ffd27a" stroke-width="2" opacity="0.5"><circle cx="100" cy="100" r="56"/><circle cx="100" cy="100" r="36"/><circle cx="100" cy="100" r="16"/></g></svg>'
    },
    travel: {
      label: '旅行', g: ['#06324a', '#1f9e8f'], accent: '#8be9ff', ink: '#eafcff', tint: '#e6f8f6',
      icon: '✈️',
      motif: '<svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid slice"><g fill="#8be9ff" opacity="0.5"><path d="M10 170 L70 110 L100 130 L150 80 L190 110 L190 170 Z"/></g></svg>'
    },
    career: {
      label: '职场', g: ['#1a1a40', '#4b3fbb'], accent: '#b6a8ff', ink: '#f1efff', tint: '#efeefc',
      icon: '💼',
      motif: '<svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid slice"><g fill="none" stroke="#b6a8ff" stroke-width="2.5" opacity="0.55"><path d="M55 140 L100 95 L145 140"/><path d="M100 95 L100 55"/><path d="M88 67 L100 55 L112 67"/></g></svg>'
    },
    knowledge: {
      label: '知识', g: ['#1c2b4a', '#3b5bdb'], accent: '#8fb6ff', ink: '#eef3ff', tint: '#eaefff',
      icon: '📚',
      motif: '<svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid slice"><g stroke="#8fb6ff" stroke-width="3" opacity="0.5"><line x1="50" y1="70" x2="150" y2="70"/><line x1="50" y1="90" x2="150" y2="90"/><line x1="50" y1="110" x2="150" y2="110"/><line x1="50" y1="130" x2="120" y2="130"/></g></svg>'
    },
    health: {
      label: '健康', g: ['#0d3a2e', '#2faa6a'], accent: '#b8ffd9', ink: '#eafff2', tint: '#e7fbf0',
      icon: '🌿',
      motif: '<svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid slice"><g fill="#b8ffd9" opacity="0.5"><path d="M100 60 C70 90 70 140 100 160 C130 140 130 90 100 60 Z"/></g></svg>'
    },
    fashion: {
      label: '时尚', g: ['#3a1530', '#c94f7c'], accent: '#ffc2dd', ink: '#fff0f6', tint: '#fdebf2',
      icon: '👜',
      motif: '<svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid slice"><g fill="none" stroke="#ffc2dd" stroke-width="2" opacity="0.5"><rect x="70" y="70" width="60" height="60" rx="6" transform="rotate(45 100 100)"/></g></svg>'
    },
    life: {
      label: '生活', g: ['#3a2a1a', '#c98a4a'], accent: '#ffe0b8', ink: '#fff6ec', tint: '#fbf1e4',
      icon: '🏠',
      motif: '<svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid slice"><g fill="none" stroke="#ffe0b8" stroke-width="2" opacity="0.5"><rect x="55" y="80" width="40" height="40" rx="4"/><rect x="105" y="80" width="40" height="40" rx="4"/><rect x="80" y="130" width="40" height="40" rx="4"/></g></svg>'
    }
  };

  var DEFAULT_THEME = 'knowledge'; // 知卡默认知识主题

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function themeOf(key) { return THEMES[key] || THEMES[DEFAULT_THEME]; }

  // 主题识别：优先用 AI 返回的 theme，否则按关键词兜底
  function detectTheme(topic) {
    var t = (topic || '').toLowerCase();
    var map = [
      ['tech', /(科技|数码|ai|人工智能|软件|代码|程序|互联网|芯片|新能源|电池|算法|app|应用|数码|电脑|手机|机器|智能)/],
      ['finance', /(财经|理财|存钱|股票|基金|投资|创业|副业|赚钱|省钱|工资|收入|房贷|房价|经济|消费|信用卡|通胀|财富)/],
      ['emotion', /(情感|爱情|恋爱|婚姻|关系|前任|心态|治愈|孤独|焦虑|emo|委屈|原生|家庭|婆媳|异地)/],
      ['food', /(美食|吃|餐厅|做菜|探店|菜品|料理|烘焙|咖啡|奶茶|减脂餐|火锅|小吃|食谱|胃|饭)/],
      ['travel', /(旅行|旅游|风景|攻略|露营|自驾|徒步|民宿|机票|签证|打卡|出片|海岛|雪山|云南|西藏|新疆|海南|青海|贵州|川西|丽江|大理|西湖|故宫|环球影城|迪士尼|出去玩|去.*游|去.*玩)/],
      ['career', /(职场|工作|上班|面试|晋升|跳槽|简历|效率|副业|同事|老板|述职|考证|考公|考研|offer)/],
      ['knowledge', /(知识|学习|读书|认知|思维|成长|干货|方法论|逻辑|原理|概念|科普|历史|心理|哲学)/],
      ['health', /(健康|健身|养生|睡眠|减肥|运动|跑步|瑜伽|体检|营养|护眼|颈椎|免疫力|情绪)/],
      ['fashion', /(穿搭|时尚|美妆|护肤|妆容|口红|香水|包包|显瘦|气质|ootd|发型)/],
      ['life', /(生活|日常|家居|收纳|好物|母婴|育儿|宠物|租房|装修|笔记|手帐|仪式感|断舍离)/]
    ];
    for (var i = 0; i < map.length; i++) { if (map[i][1].test(t)) return map[i][0]; }
    return DEFAULT_THEME;
  }

  function today() {
    var d = new Date();
    return d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0');
  }

  // 公共暗底包装：渐变 + 光晕 + 主题水印 + 装饰 SVG
  function darkWrap(t, inner, opts) {
    opts = opts || {};
    var deco = opts.deco || '';
    return '' +
      '<section style="position:relative;width:100%;height:100%;overflow:hidden;' +
      'background:linear-gradient(135deg,' + t.g[0] + ' 0%,' + t.g[1] + ' 100%);' +
      'font-family:-apple-system,BlinkMacSystemFont,\'PingFang SC\',\'Microsoft YaHei\',sans-serif;' +
      'box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;">' +
      '<div style="position:absolute;top:-30%;right:-15%;width:60%;height:60%;border-radius:50%;' +
      'background:radial-gradient(circle,' + t.accent + ' 0%,rgba(0,0,0,0) 70%);opacity:.22;"></div>' +
      '<div style="position:absolute;bottom:-25%;left:-10%;width:55%;height:55%;border-radius:50%;' +
      'background:radial-gradient(circle,rgba(255,255,255,.9) 0%,rgba(0,0,0,0) 70%);opacity:.10;"></div>' +
      '<div style="position:absolute;right:0;bottom:0;width:62%;height:62%;opacity:.9;pointer-events:none;">' + t.motif + '</div>' +
      '<div style="position:absolute;top:6%;right:5%;font-size:84px;line-height:1;opacity:.12;filter:none;">' + t.icon + '</div>' +
      '<div style="position:relative;flex:1;display:flex;flex-direction:column;justify-content:center;padding:18px;">' + inner + '</div>' +
      deco +
      '</section>';
  }

  // 亮底卡片包装（痛点/干货），主题点缀色，无头部提示词，直接段落
  function lightWrap(t, inner) {
    return '' +
      '<section style="position:relative;width:100%;height:100%;overflow:hidden;' +
      'background:linear-gradient(160deg,#ffffff 0%,' + t.tint + ' 100%);' +
      'font-family:-apple-system,BlinkMacSystemFont,\'PingFang SC\',\'Microsoft YaHei\',sans-serif;' +
      'box-sizing:border-box;display:flex;flex-direction:column;">' +
      '<div style="position:absolute;top:0;left:0;width:6px;height:100%;background:' + t.accent + ';"></div>' +
      '<div style="position:relative;flex:1;padding:18px 16px 16px 24px;display:flex;flex-direction:column;justify-content:center;">' + inner + '</div>' +
      '</section>';
  }

  // 把短文案渲染为大字海报：大字占绝对主导、精简、绝不裁切
  function shortPoster(t, text) {
    var W = 980;
    var raw = String(text == null ? '' : text).replace(/\r/g, '').trim();
    if (!raw) raw = '知卡';
    var intent = raw.split(/\n/).map(function (s) {
      return s.trim().replace(/^["“”'']+|["“”'']+$/g, '');
    }).filter(function (s) { return s; });
    if (!intent.length) intent = ['知卡'];
    var lines = [];
    intent.forEach(function (s) {
      while (s.length > 8) { lines.push(s.slice(0, 8)); s = s.slice(8); }
      if (s.length) lines.push(s);
    });
    if (lines.length > 3) lines = lines.slice(0, 3);
    if (!lines.length) lines = ['知卡'];
    var maxLen = Math.max.apply(null, lines.map(function (s) { return s.length; }));
    var totalChars = lines.join('').length;
    var fs;
    if (lines.length === 1) {
      fs = maxLen <= 4 ? 160 : maxLen <= 6 ? 132 : maxLen <= 8 ? 108 : 88;
    } else if (lines.length === 2) {
      fs = maxLen <= 4 ? 124 : maxLen <= 6 ? 104 : maxLen <= 8 ? 86 : 72;
    } else {
      fs = maxLen <= 4 ? 100 : maxLen <= 6 ? 86 : maxLen <= 8 ? 74 : 62;
    }
    var fit = Math.floor(W / Math.max(1, maxLen) * 0.96);
    if (fs > fit) fs = Math.max(18, fit);
    if (totalChars > 16 && lines.length >= 2) fs = Math.max(18, Math.floor(fs * 0.92));
    var lh = lines.length === 1 ? 1.18 : (lines.length === 2 ? 1.32 : 1.44);
    var html = lines.map(function (s) {
      return '<div style="font-size:' + fs + 'px;font-weight:900;line-height:' + lh + ';color:' + t.ink +
        ';text-shadow:0 4px 20px rgba(0,0,0,.32);white-space:normal;word-break:break-all;overflow-wrap:break-word;letter-spacing:1px;">' + esc(s) + '</div>';
    }).join('');
    return '<div style="width:100%;max-width:980px;text-align:center;margin:auto;">' + html + '</div>';
  }

  global.CoverEngine = {
    THEMES: THEMES,
    detectTheme: detectTheme,
    shortPoster: shortPoster,
    darkWrap: darkWrap,
    lightWrap: lightWrap,
    esc: esc
  };
})(typeof window !== 'undefined' ? window : this);
