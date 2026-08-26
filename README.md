# 知卡 · 把内容变成知识卡片

第二个 App（矩阵：Spark 内容生成 → 知卡 知识沉淀）。

把长文 / 公众号文章 / 视频 / 电子书截图一键提炼成**可复习、可分享**的精美知识卡片。

## 核心能力

- 🌊 **多源摄取**：文章/公众号链接（`/extract`）、视频文案（`/transcribe`）、截图 OCR（`/ocr`）、纯文本
- 🃏 **6 类知识卡**：金句 / 概念 / 对比 / 方法论 / 时间线 / 数据
- 🎨 **精美出图**：1080×1440 卡片一键导出，可直接发小红书/朋友圈（竞品 Readwise/Anki 没有的形态）
- 🧠 **间隔复习**：1/3/7/15/30 天遗忘曲线
- 💰 **订阅变现**：RevenueCat IAP（zhika_pro_monthly / zhika_pro_yearly）

## 技术栈

- Capacitor 6 纯前端（`app/`）
- Cloudflare Worker 摄取网关（`worker/`，已部署 `https://zhika-gateway.1012425851.workers.dev`）
- DeepSeek 多模型层 + 反模板宪法（复用 Spark `llm.js`）
- GitHub Actions：iOS 构建 + TestFlight + App Store 提交 + Pages 演示页

## 目录

```
app/          前端（index.html + 卡片渲染/摄取/复习/会员）
worker/       摄取网关（/extract /transcribe /ocr + 订阅校验）
ios/          Capacitor 原生工程（已含相机权限）
fastlane/     上架元数据 + 截图
scripts/      截图生成 / 图标生成
```

## 开发

```bash
npm install
npx cap sync ios      # 同步原生工程
node scripts/make_screenshots.mjs   # 生成 App Store 截图
```

## 演示

GitHub Pages：`https://poelee621.github.io/zhika-app/`

## 上架

见 `UPSTORE_CHECKLIST.md`。
