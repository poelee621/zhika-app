# 知卡 · 上架操作手册（UPSTORE CHECKLIST）

> 坡哥专属操作清单。第二个 App，复用 Spark 全部家底（架构、Worker、IAP、上架流程）。
> 时间预估：网页操作 1-2 小时；云构建 30 分钟；App 审核 1-2 天。

---

## ✅ 当前进度（代码层全部已自动化）
- [x] 前端代码（llm / iap / ingest / spaced / cover / app / index.html / styles.css）
- [x] 摄取网关 Worker（/extract /transcribe /ocr 实测通过）`https://zhika-gateway.1012425851.workers.dev`
- [x] iOS 配置 + CI（ios-build.yml / appstore-submit.yml）
- [x] fastlane 元数据 + 分级 + 审核联系信息（沿用 Spark 真实信息）
- [x] App 图标（18 尺寸，Python 生成）
- [x] 截图脚本（scripts/make_screenshots.mjs，6.7"/6.5"/12.9" 各 6 张）
- [x] 隐私政策页（app/privacy.html）
- [x] GitHub Pages 演示部署（deploy-pages.yml，push 后手机扫码即试）
- [ ] **App Store Connect 新建知卡 App 记录（bundle `com.coldtank.cards`）**
- [ ] **授权 API Key `TVTRXQKFKT` 给知卡 App（Developer→App Manager 或加 App 权限）**
- [ ] **GitHub 知卡仓库配 Secrets（证书 / Profile / TEAM_ID / API Key）**
- [ ] push → 跑 App Store Submit → 提交审核

---

## §1 注册 Bundle ID（10 分钟）
1. https://developer.apple.com/account → Certificates, Identifiers & Profiles
2. Identifiers → `+` → App IDs → 继续
3. Description: `知卡`；Bundle ID: Explicit → **`com.coldtank.cards`**
4. Capabilities 默认（In-App Purchase 已勾选）→ Register

## §2 在 App Store Connect 创建 App（15 分钟）
1. https://appstoreconnect.apple.com → 我的 App → `+` → 新建 App
2. 平台 iOS；名称：**知卡 - 把内容变成知识卡片**；主要语言：简体中文
3. Bundle ID：选 `com.coldtank.cards`；SKU：`zhika001`
4. 隐私政策 URL：`https://poelee621.github.io/zhika-app/privacy.html`（GitHub Pages 上线后）
5. 定价：免费 + 应用内购买（订阅见 §5）

## §3 证书与描述文件（30 分钟，网页操作，无需 Mac）
> 若 Spark 的 Distribution 证书仍在有效期内且可复用，可跳过新建，直接用同一个 .p12 + Profile（只需新建一个指向 `com.coldtank.cards` 的描述文件）。
1. 生成密钥对：
   ```bash
   openssl req -new -newkey rsa:2048 -nodes -keyout zhika_key.pem -out zhika_cert.csr -subj "/CN=Zhika Distribution"
   ```
2. Certificates → `+` → Apple Distribution → 上传 csr → 下载 `distribution.cer`
3. 转 .p12：`openssl pkcs12 -export -out dist.p12 -inkey zhika_key.pem -in distribution.cer`（设密码）
4. 编码：`base64 -w0 dist.p12`
5. Profiles → `+` → App Store Connect → 选 App ID `com.coldtank.cards` → 选证书 → 命名 `Zhika Distribution Profile` → 下载 → `base64 -w0 Zhika_Distribution_Profile.mobileprovision`

## §4 App Store Connect API Key（复用 Spark 的）
- Spark 已建 Key `TVTRXQKFKT`（Key ID / Issuer ID / .p8 已知）。
- **关键**：在 App Store Connect → 用户和访问 → 集成 → API Keys，确认该 Key 对**新建的知卡 App 有访问权限**（App Manager 角色默认可访问同团队所有 App）。若仍报权限错，升级角色或显式授权。
- Team ID：developer.apple.com/account 右上角。

## §5 RevenueCat（内购商品）
1. app.revenuecat.com → Apps → + → App Store → 选知卡
2. Products → + 两个非消耗型订阅：
   - `zhika_pro_monthly` ¥18/月
   - `zhika_pro_yearly` ¥98/年
3. Public SDK Key 填进 `app/iap.js` 的 `API_KEY`
4. Webhooks → `https://zhika-gateway.1012425851.workers.dev/webhook/revenuecat` + 共享密钥
5. App Store Connect 创建同名 App 内购买项目订阅组

## §6 GitHub 仓库 + Secrets（云构建，推荐）
1. 把 `zhika-app` 推到 GitHub 仓库 `poelee621/zhika-app`
2. Settings → Secrets and variables → Actions → 添加：

| Secret | 值 | 用途 |
|--------|-----|------|
| `IOS_P12_BASE64` | §3.4 base64 | 签名证书 |
| `IOS_P12_PASSWORD` | p12 密码 | 签名证书 |
| `IOS_PROFILE_BASE64` | §3.5 base64 | 描述文件 |
| `TEAM_ID` | §4 | 团队 |
| `APPLE_API_KEY_ID` | Spark Key ID | API Key |
| `APPLE_API_ISSUER_ID` | Spark Issuer ID | API Key |
| `APPLE_API_KEY_B64` | Spark .p8 base64 | API Key |

> 注意：若复用 Spark 同一套密钥/证书，值可从 Spark 仓库 Secrets 复制（同团队同账号）。
3. push main → iOS Build 自动构建上传 TestFlight
4. Actions → App Store Submit → Run workflow（默认用已提交截图）

## §7 截图 / 提交（已自动化）
1. 本机重生成：`npm ci && npx playwright install chromium && SIZES=6.7,6.5 node scripts/make_screenshots.mjs`
2. 提交前必改：`fastlane/metadata/zh-Hans/review_information.json`（已填 Spark 真实信息，可复用）
3. 隐私标签：App Store Connect 后台填「照片或视频 + 其他用户内容」均选 App 功能、关联用户=是、追踪=否，**必须点「发布」才生效**
4. 定价：后台手动确认「免费」+ 175 地区供应（API 建的 price schedule 不计数）
5. 审核注意：内购先「批准」；AI 内容合规已在 review notes 说明

## §8 演示页（friction-free 内测）
- push 后 GitHub Pages 自动部署知卡 demo 到 `https://poelee621.github.io/zhika-app/`
- 手机 Safari 打开即可试卡片生成（IAP 在网页端不可用，其余功能全跑）
- 这是上架前最好的内测方式，无需 TestFlight

## §9 审核通过后
- [ ] 验证 RevenueCat Webhook 落库（沙盒购买测试）
- [ ] 监控：D7 留存 / 付费转化 / 卡片分享率
- [ ] 与 Spark 形成「内容生产 → 知识沉淀」矩阵
