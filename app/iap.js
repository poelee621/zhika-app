// app/iap.js —— 内购集成（RevenueCat），未配置时降级为演示解锁
// 接入步骤：
//   1) npm install @revenuecat/purchases-capacitor
//   2) 在原生工程(ios/)按 RevenueCat 文档完成原生配置
//   3) 填入下方 REVENUECAT_API_KEY（建议由后端下发，避免硬编码）
const IAP = {
  API_KEY: 'test_cHieRhZHRzWrOeWsJzaDRCwkpWx', // RevenueCat 测试公钥；上架前换成生产 key
  PRODUCT_IDS: { monthly: 'zhika_pro_monthly', yearly: 'zhika_pro_yearly' }, // 月度/年度商品 ID
  ENTITLEMENT: 'pro',               // RevenueCat 中 entitlement 标识
  // 展示价格（RevenueCat 有货时用商店价，否则用此 fallback）
  PRICES: { monthly: '¥18/月', yearly: '¥128/年' },
  _ready: false,
  _plugin() {
    const C = window.Capacitor;
    return (C && C.Plugins && C.Plugins.Purchases) || window.Purchases || null;
  },
  isConfigured() { return this._ready && !!this.API_KEY; },
  async init() {
    const p = this._plugin();
    if (!p || !this.API_KEY) { this._ready = false; return false; }
    try { await p.configure({ apiKey: this.API_KEY }); this._ready = true; return true; }
    catch (e) { console.warn('IAP init failed', e); this._ready = false; return false; }
  },
  _pick(offerings, plan) {
    const id = this.PRODUCT_IDS[plan] || this.PRODUCT_IDS.yearly;
    const pkgs = offerings?.current?.availablePackages || [];
    return pkgs.find(x => x.product?.identifier === id) || pkgs[0] || null;
  },
  // 展示价格文案：商店有货用商店价；否则用写死价
  async priceText(plan) {
    const p = this._plugin(); let storePrice = '';
    if (p && this._ready) {
      try { const { offerings } = await p.getOfferings(); const pkg = this._pick(offerings, plan); storePrice = pkg ? pkg.product.priceString : ''; }
      catch (e) { storePrice = ''; }
    }
    return storePrice || this.PRICES[plan] || '';
  },
  async purchase(plan) {
    const p = this._plugin(); if (!p || !this._ready) return false;
    try {
      const { offerings } = await p.getOfferings();
      const pkg = this._pick(offerings, plan);
      if (!pkg) throw new Error('无可选商品');
      const { customerInfo } = await p.purchasePackage(pkg);
      if (customerInfo?.entitlements?.active?.[this.ENTITLEMENT]) {
        localStorage.setItem('zhika_vip', '1'); return true;
      }
      return false;
    } catch (e) {
      if (/cancel|user cancelled|2$/.test(String(e?.code) + e?.message)) return false; // 用户取消
      console.warn('purchase error', e); return false;
    }
  },
  async restore() {
    const p = this._plugin(); if (!p || !this._ready) return false;
    try {
      const { customerInfo } = await p.restorePurchases();
      if (customerInfo?.entitlements?.active?.[this.ENTITLEMENT]) {
        localStorage.setItem('zhika_vip', '1'); return true;
      }
      return false;
    } catch (e) { return false; }
  }
};

// 真实环境下自动初始化；预取价格文本
IAP.init();
IAP.priceText('monthly').then(pr => { window.__zhikaPrices = window.__zhikaPrices || {}; window.__zhikaPrices.monthly = pr; });
IAP.priceText('yearly').then(pr => { window.__zhikaPrices = window.__zhikaPrices || {}; window.__zhikaPrices.yearly = pr; });
