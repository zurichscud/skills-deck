---
name: app-icon
description: 用一张源图（PNG/JPG）重新生成 Skills Deck 全套应用图标——build/icon.icns、build/icon.ico、build/icon.png、resources/icon.png、resources/tray-icon.png、src/renderer/public/icon.png。当用户提供新 logo，要求设置/更换应用图标、Dock 图标、安装包图标、托盘图标、favicon，或提到 icns、ico、图标尺寸、窗口图标时使用。
---

# 换应用图标（app-icon）

## 触发场景

用户给出一张图要求「设为 / 换成应用图标」时，不要手工拼 icns / ico，直接跑现成脚本。

## 流程

1. **检查源图**：正方形、≥1024px 最佳。脚本会强制校验：非正方形、小于 256px 直接报错；<1024px 警告放大可能发虚。带 EXIF 旋转（orientation 3/6/8）会自动转正，镜像方向（2/4/5/7）会被拒绝并提示先转正。
2. **预览（可选，不碰仓库文件）**：
   ```bash
   node scripts/make-icons.mjs <源图> --out /tmp/icons-preview
   ```
3. **正式生成**：
   ```bash
   node scripts/make-icons.mjs <源图>
   ```
   原地更新 6 个图标文件，并把源图留档为 `build/logo.<ext>`；末尾打印自检结果（ico / icns 容器条目与 PNG 字节逐一比对）。
4. **验证**：
   - `npm run dev`：窗口图标（Windows/Linux）、托盘、侧栏 logo、favicon 四处肉眼确认。
   - macOS 的 .app / Dock 图标只认 bundle 里的 icns：`npm run dist:mac` 后打开 `release/<version>/Skills Deck.app` 确认。
   - `npm run check`：确认 lint / 格式 / 类型没被破坏。

## 关键事实（别踩坑）

- electron-builder 走目录约定：`build/icon.icns`（mac）、`build/icon.ico`（win）、`build/icon.png`（linux），`electron-builder.yml` 里没有 icon 字段，改文件名会失效。
- `resources/**/*` 经 `asarUnpack` 打进安装包：运行时窗口图标读 `src/main/index.ts:23` 的 `resources/icon.png`（256），托盘读 `src/main/ipc.ts:186` 的 `resources/tray-icon.png`（32）。
- macOS 运行时 `BrowserWindow.icon` 不生效，只能靠打包时的 icns；托盘图标固定 32×32。
- 渲染层 `src/renderer/public/icon.png` 同时是 favicon（`index.html:11`）和侧栏 logo（`sidebar.tsx:149`），与 `build/icon.png` 同字节（512）。

## 相关文件

- 脚本：`scripts/make-icons.mjs`（零依赖，仅用 macOS 自带 sips；PNG 梯度 16–1024 九档 → ico 取 16–256 七档、icns 取 128–1024 四档）
- 图标落位：`build/`、`resources/`、`src/renderer/public/`
