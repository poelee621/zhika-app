// ingest.js —— 多源摄取编排（调 Cloudflare Worker 摄取网关）
// 端点（部署在 Cloudflare Worker zhika-gateway）：
//   POST /extract    {url}      → {title, text}        文章/新闻/公众号
//   POST /transcribe {url}      → {title, text}        视频文案/字幕
//   POST /ocr        {image}    → {text}               电子书/截图 OCR
//
// 失败处理：parse 网关返的错误体（error/kind/status），抛 Error 时挂在 e.status / e.kind / e.message
// 前端按 status/kind 给针对性提示，不再"未抓取到内容，请手动粘贴"一句甩锅
const INGEST = {
  GATEWAY: 'https://zhika-gateway.1012425851.workers.dev',
  _available() { return !!this.GATEWAY && !/YOUR|example|localhost/.test(this.GATEWAY); },

  async _post(path, body, timeoutMs) {
    timeoutMs = timeoutMs || 45000;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(this.GATEWAY + path, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      clearTimeout(timer);
      if (!res.ok) {
        // 试图解析网关返的结构化错误体
        let body = null;
        try { body = await res.json(); } catch (_) { /* 非 JSON */ }
        const err = new Error((body && body.error) || `网关 HTTP ${res.status}`);
        err.status = (body && body.status) || res.status;
        err.kind = (body && body.kind) || 'http_error';
        throw err;
      }
      return await res.json();
    } catch (e) {
      clearTimeout(timer);
      // 网络层错误（DNS/CORS/abort）补一个 status=0 给前端识别
      if (e && !e.status && (e.name === 'AbortError' || /AbortError|Failed to fetch|TypeError/i.test(String(e)))) {
        const err = new Error(e.name === 'AbortError' ? '请求超时' : '网络异常，无法连接网关');
        err.status = 0;
        err.kind = e.name === 'AbortError' ? 'timeout' : 'network';
        throw err;
      }
      throw e;
    }
  },

  // 文章/新闻/公众号链接
  async extract(url) {
    if (!this._available()) {
      const e = new Error('GATEWAY未配置');
      e.kind = 'config';
      throw e;
    }
    return await this._post('/extract', { url });
  },

  // 视频链接（文案/字幕）
  async transcribe(url) {
    if (!this._available()) {
      const e = new Error('GATEWAY未配置');
      e.kind = 'config';
      throw e;
    }
    return await this._post('/transcribe', { url });
  },

  // 图片 OCR（电子书截图等）
  async ocr(base64) {
    if (!this._available()) {
      const e = new Error('GATEWAY未配置');
      e.kind = 'config';
      throw e;
    }
    return await this._post('/ocr', { image: base64 });
  }
};

// 给前端调用的"按状态码翻译成中文提示"工具
// 返回对象 { title: '短标题（红字前缀）', body: '可操作建议', canRetry }
//   title: 给用户的第一眼信息（链接已失效/需登录/服务器忙/网络问题…）
//   body:  该怎么做（复制正文粘贴/检查链接/稍后重试…）
INGEST.explainError = function (e) {
  const status = e && e.status, kind = e && e.kind;
  if (kind === 'config')    return { title: '未配置网关', canRetry: false };
  if (kind === 'timeout')   return { title: '⏱ 抓取超时',      body: '目标网站响应太慢，可稍后重试，或复制正文用「文本」模式粘贴。', canRetry: true };
  if (kind === 'network')   return { title: '🌐 网络异常',      body: '无法连接摄取网关，请检查网络后重试。', canRetry: true };
  if (kind === 'dns')       return { title: '🌐 域名解析失败',  body: '目标网站地址无法访问，可能是链接拼错或站点已下线。', canRetry: false };
  if (status === 404)       return { title: '🔗 链接已失效',    body: '目标页面不存在或已被删除，请检查链接是否完整、有效。', canRetry: false };
  if (status === 403)       return { title: '🚫 网站禁止抓取',  body: '该网站不允许自动访问（反爬/地域限制），建议复制正文后用「文本」模式粘贴。', canRetry: false };
  if (status === 401 || status === 451) return { title: '🔒 需要登录/受限', body: '该页面需要登录或所在地区不可访问，请打开原文复制正文粘贴。', canRetry: false };
  if (status === 429)       return { title: '⏳ 请求过于频繁',  body: '已触发对方限流，请稍等片刻再试。', canRetry: true };
  if (status >= 500)        return { title: '🛠 目标服务器异常', body: '对方站点返回 ' + status + '，请稍后重试，或改用「文本」模式粘贴。', canRetry: true };
  if (kind === 'empty')     return { title: '📄 未抓到正文',    body: '页面打开了但没读到文字（可能需要登录/JS 渲染/视频内容），请复制正文粘贴。', canRetry: false };
  if (kind === 'parse')     return { title: '📄 解析失败',      body: '抓到了但读不出文字，请稍后重试或改用「文本」模式。', canRetry: true };
  // 兜底
  return { title: '⚠ 提取失败', body: '请改用「文本」模式手动粘贴正文。', canRetry: false };
};
