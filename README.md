# QSL 表单爬取（精简版）

此仓库已精简，仅保留爬取与发布相关脚本，方便在 GitHub Actions 上定时抓取并将结果作为 release 资产提供下载。网页与后端服务端代码已移除，避免泄露本地密钥与降低维护复杂度。

## 目录与脚本
- `server/export_form_entries.js`：抓取脚本，输出 JSON（默认 `data/form_entries.json`）。
- `server/encrypt_release.js`：加密/解密发布物（本地持有私钥，仓库仅公开加密文件）。
- `.github/workflows/forms-scrape.yml`：定时/手动运行抓取并发布到 tag `data-latest`。

## 本地运行（仅用于你自己的机器）
```powershell
cd server
npm install
set ANALYSIS_PAGE_URL=https://...  # 如需直接抓取分析页
npm run export:forms -- --out=../data/form_entries.json
```

## 发布到 Release（GitHub Actions）
工作流已配置为：checkout → Node 18 → `npm ci` → `npm run export:forms` → 上传产物到 tag `data-latest`。

## 发行加密（可选）
```powershell
mkdir keys
openssl genrsa -out keys/private.pem 2048
openssl rsa -in keys/private.pem -pubout -out keys/public.pem
npm run encrypt:asset -- --in=../data/form_entries.json --out=../data/form_entries.enc.json --pub=../keys/public.pem
```
仅上传加密文件，私钥留本地。

## 轮询数据源优先级
- `RELEASE_JSON_URL`：指向 GitHub Release 的 JSON 资产（或本地文件）。
- `ANALYSIS_PAGE_URL`：Microsoft Forms 分析页。
- 兜底：`data/mock_form_entries.json`。
未设置 `RELEASE_JSON_URL` 时，系统默认尝试硬编码的 tag：`zzqsld/BG4JXV-QSL-MANGER@data-latest`。

## 本地密钥使用（仅本地，不提交到仓库）
在 Windows PowerShell 设置令牌（后端触发 Actions 时使用）：
```powershell
$env:SERVER_GITHUB_TOKEN = "<你的 Fine-grained Token>"
```
或永久：
```powershell
setx SERVER_GITHUB_TOKEN "<你的 Fine-grained Token>"
```
切勿将令牌写入代码或提交到仓库。

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
- `RELEASE_JSON_URL`：指向 GitHub Release 里的 JSON 资产（或本地文件），格式可为 `{ entries: [...] }` 或数组，优先使用。
- `ANALYSIS_PAGE_URL`：Microsoft Forms 分析页抓取（HTML 解析）。
- 兜底：`data/mock_form_entries.json`。

当未设置 `RELEASE_JSON_URL` 时，系统会默认尝试硬编码的 tag：
`zzqsld/BG4JXV-QSL-MANGER@data-latest`，自动通过 GitHub API 找到资产 `form_entries.json` 并拉取。

## 网页签收码验证
新增“签收码验证签收”表单：输入呼号与签收码直接校验并标记为已签收（与轮询逻辑一致）。
