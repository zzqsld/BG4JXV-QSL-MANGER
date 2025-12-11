# QSL 卡片签收基础版

一个简单的三端雏形：
- **表单端（外部）**：使用 Microsoft Forms 收集姓名（可选）、呼号（必填）、密码（写在信封内）。
- **服务端**：Node + Express，记录寄出、保存签收码、提供状态查询，并可与表单轮询脚本共享本地 JSON 存储。
- **用户端 UI**：自带响应式 Web 页面，可在 Windows 浏览器和安卓浏览器中使用。

> 当前代码不包含真实的 Microsoft Forms 抓取逻辑，`server/poller.js` 里提供了接口和一个本地 `data/mock_form_entries.json` 示例。替换抓取逻辑后即可定时同步。

## 运行方式
1. 安装依赖（在 `server` 目录）：
   ```powershell
   cd server
   npm install
   npm start  # http://localhost:4000
   ```
   服务器会同时服务 `web/` 目录作为前端。

2. 寄出登记
   - 打开网页，输入呼号、（可选）姓名、信封内密码。
   - 服务端会生成 6 位签收码，记录寄出时间，状态为 `sent`。

3. 签收同步
   - 运行一次：`npm run poll`（在 `server` 目录）。
   - 逻辑：读取 `data/mock_form_entries.json`，按呼号/密码匹配后将状态标记为 `received`。
   - 可用操作系统的计划任务（如 Windows 任务计划程序）每小时执行一次。

4. 手动签收
   - 页面右侧的“手动签收”可在异常情况下直接标记为已签收。

## 文件说明
- `data/state.json`：本地状态存储（呼号、密码、签收码、时间戳等）。
- `data/mock_form_entries.json`：模拟的 Microsoft Forms 返回数据列表。
- `server/index.js`：HTTP API 与静态文件服务。
- `server/poller.js`：表单轮询逻辑（需替换抓取实现）。
- `web/index.html`：响应式前端界面。

## 下一步可做
- 将 `fetchFormEntries` 替换为 Microsoft Graph / Forms 抓取逻辑，并安全存储凭据。
- 增加签收码比对（表单里回填签收码），或生成 PDF/打印标签。
- 加入导出 CSV / Excel、分批过滤、短信或邮件通知。
- 部署到免费平台：静态前端可放 GitHub Pages / Cloudflare Pages；后端可用 Cloudflare Workers + KV、Deta Space、Render 免费实例等。

## 新增脚本
- 表单导出：在 `server` 目录运行
   ```powershell
   set ANALYSIS_PAGE_URL=https://...  # 如需分析页抓取
   npm run export:forms -- --out=../data/form_entries.json
   ```
   输出包含 `entries` 列表，可作为 GitHub Actions 的产物上传到 release。

- 发行加密（公钥加密，私钥只留本地）：
   1) 生成密钥（不要提交）：
   ```powershell
   mkdir keys
   openssl genrsa -out keys/private.pem 2048
   openssl rsa -in keys/private.pem -pubout -out keys/public.pem
   ```
   2) 加密发布物：
   ```powershell
   npm run encrypt:asset -- --in=../dist/app.zip --out=../dist/app.enc.json --pub=../keys/public.pem
   ```
   3) 本地解密（需要私钥）：
   ```powershell
   node encrypt_release.js --mode=decrypt --in=../dist/app.enc.json --out=../dist/app.zip --priv=../keys/private.pem
   ```
   发布时只上传加密文件，私钥保存在本地即可公开仓库。

## 轮询数据源优先级
- `RELEASE_JSON_URL`：指向 GitHub Release 里的 JSON 资产，格式可为 `{ entries: [...] }` 或数组，优先使用。
- `ANALYSIS_PAGE_URL`：Microsoft Forms 分析页抓取（HTML 解析）。
- 兜底：`data/mock_form_entries.json`。
