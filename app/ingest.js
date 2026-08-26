// ingest.js —— 多源摄取编排（调 Cloudflare Worker 摄取网关）
// 端点（部署在 Cloudflare Worker zhika-gateway）：
//   POST /extract    {url}      → {title, text}        文章/新闻/公众号
//   POST /transcribe {url}      → {title, text}        视频文案/字幕
//   POST /ocr        {image}    → {text}               电子书/截图 OCR
// 失败回退：提示用户手动粘贴文本。
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
      if (!res.ok) throw new Error('网关 ' + res.status);
      return await res.json();
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  },

  // 文章/新闻/公众号链接
  async extract(url) {
    if (!this._available()) throw new Error('GATEWAY未配置');
    return await this._post('/extract', { url });
  },

  // 视频链接（文案/字幕）
  async transcribe(url) {
    if (!this._available()) throw new Error('GATEWAY未配置');
    return await this._post('/transcribe', { url });
  },

  // 图片 OCR（电子书截图等）
  async ocr(base64) {
    if (!this._available()) throw new Error('GATEWAY未配置');
    return await this._post('/ocr', { image: base64 });
  }
};
