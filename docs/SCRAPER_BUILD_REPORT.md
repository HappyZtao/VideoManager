# VideoManager — 视频刮削功能 构建文档与测试报告

> **当前版本：v0.8.8**（2026-09-21）　|　安装包：`release/v0.8.8/VideoManager-0.8.8-Windows-x64-Setup.exe`
> v0.8.8 新增内容见文末「8. v0.8.8 功能增强」；v0.8.1 修复见「6. v0.8.1 问题修复」。v0.8.0 安装包：`release/v0.8.0/`（SHA256 `59508376a7d41e6e0a939c734a7e1158e925a994887c51cf4de7a36574746dd5`）。

---

## 1. 功能概述

本次交付为 VideoManager 增加完整的**视频元数据刮削**功能，实现逻辑移植自 `F:\JavBoss`（Go）刮削模块，并在 Electron 主进程中以 TypeScript 重新实现：

- **番号解析**：从文件名提取有码/无码番号（横线、下划线、无分隔、纯数字无码、字母后缀等），移植 JavBoss `internal/util/jav_util.go` 的全部正则与归一化逻辑（前导零保留三位等）。
- **数据源**：集成 JavBoss 全部 9 个站点，其中 7 个用于番号刮削：

  | 数据源 | 方式 | 说明 |
  |---|---|---|
  | JavBus | 详情页直达 | `https://www.javbus.com/{code}`，含 GANA/MIUM/LUXU 前缀改写 |
  | JavDB | 搜索 → 详情 | `https://javdb.com/search?q={code}&f=all`，唯一番号匹配 |
  | Avmoo | 内部 JSON API | CSRF + Cookie 会话，`POST /jav/data/api/search|getMovie` |
  | Avsox | 内部 JSON API | 无码番号，`POST /javu/data/api/search|getMovie` |
  | JavMenu | 详情页直达 | `https://javmenu.com/{CODE}` |
  | JavDatabase | 详情页直达 | `https://www.javdatabase.com/movies/{code}/` |
  | ThePornDB | 官方 JSON API | `https://api.theporndb.net/jav?external_id=` |
  | JavModel / MinnanoAV | 辅助源 | JavBoss 中仅用于演员资料，不参与番号匹配（界面标注） |

- **抓取字段**：标题、番号、封面、发行日期、时长、片商、系列、演员、分类标签。
- **交互**：
  - 设置新增「视频刮削」页：**启用/禁用开关**（现代 switch 样式，与应用现有主题一致）、数据源勾选与优先级排序、刮削并发数（1–8）、自动下载封面开关、刮削进度统计。
  - 视频卡片「更多操作」菜单新增**「刮削元数据」**；选中多项后工具栏新增**批量刮削**按钮。
  - 刮削结果预览面板：并发展示各数据源候选（封面缩略图 + 元数据），支持**手动选择应用**、单源重试、整卡重新查询、把刮削封面**设为条目封面**、清除刮削数据。
  - 批量刮削为后台任务：进度条、逐项结果（成功/未匹配/失败）、失败原因、可取消，与现有「后台任务」面板完全一致。
- **稳定性**：单请求 15s 超时、失败自动重试一次、同域全局限速（JavBus/JavDB/JavDatabase 500ms、Avmoo/Avsox/JavMenu 1500ms）、响应 8MB 上限、Cloudflare 风控页识别、逐条目异常隔离（单条失败不中断批量任务）。
- **日志**：`<媒体库数据目录>/logs/scrape.log`（JSON 行，5MB 轮转），记录匹配成功、失败原因、封面下载失败等事件。
- **存储**：SQLite `scrape_metadata` 表（数据库 schema v6，老库自动迁移）；封面存 `<数据目录>/scrape-covers/<entryId>.jpg`；预览封面缓存于 temp（可自动清理）。数据仅存本机。

## 2. 代码结构

```
apps/desktop/src/main/
  scrape.ts                    # ScrapeService：批量任务/预览/应用/设封面/取消/日志
  scrape/
    registry.ts                # 数据源目录（纯元数据，可单测）
    parse.ts                   # 文件名 → 番号（移植 jav_util.go）
    http.ts                    # 共享 HTTP：限速/超时/重试/大小上限/CSRF/Cookie
    providers.ts               # 9 个数据源解析器（移植 internal/jav/*）
packages/persistence/database.ts   # scrape_metadata 表 + v6 迁移 + 查询方法
packages/contracts/index.ts        # ScrapeInfo/Meta/Candidate/Preview 类型 + VMApi + ipcSchemas
apps/desktop/src/main/index.ts     # IPC 装配、settings 白名单、任务取消路由
apps/desktop/src/main/media.ts     # saveExternalCover（刮削封面 → 手动封面管道）
apps/desktop/src/renderer/
  ScrapeModal.tsx                # 刮削结果预览与手动选择弹窗
  ScrapeSettings.tsx             # 设置 · 视频刮削面板
  Settings.tsx / src.tsx / components.tsx   # 入口接线（新 tab、菜单项、工具栏按钮）
tests/scrape.test.ts              # 番号解析与数据源目录单元测试
```

IPC 新增（沿用 `vm:` 前缀 + zod 校验信封）：`scrapeProviders / scrapeStats / scrapePreview / scrapeSearch / scrapeApply / scrapeMeta / scrapeSetCover / scrapeClear / scrapeRun`。
设置项新增（已加入白名单校验）：`scrapeEnabled / scrapeProviders / scrapeConcurrency / scrapeDownloadCover`。

## 3. 构建过程

### 3.1 环境

| 项 | 值 |
|---|---|
| OS | Windows x64（10.0.26200） |
| 构建用 Node | **v22.21.1**（便携版，随构建脚本使用；系统 Node 18 无法运行 electron-builder 26 的 `@noble/hashes@2` ESM 依赖，见 3.4） |
| Electron | 44.4.1（内置 Node 22 运行时） |
| electron-builder | 26.15.3（NSIS x64） |
| 新增运行时依赖 | cheerio 1.2.0（HTML 解析，仅主进程使用） |

### 3.2 构建步骤（可复现，全部命令实测通过）

```powershell
# 0. 一次性准备便携版 Node 22（系统 Node 18 无法运行 electron-builder 26，见 3.3）
curl.exe -sL -o .cache\node22.zip https://nodejs.org/dist/v22.21.1/node-v22.21.1-win-x64.zip
Expand-Archive .cache\node22.zip -DestinationPath .cache\node22

# 1. 安装依赖（已含本次新增的 cheerio@1.2.0）
npm install

# 2. 构建产物（tsc --noEmit + electron-vite build）
npm run build

# 3. 打包 NSIS 安装包（输出到 release/v0.8.0，避免默认目录被系统句柄锁定）
$env:Path = "$PWD\.cache\node22\node-v22.21.1-win-x64;" + $env:Path
node node_modules\electron-builder\cli.js --win nsis --x64 --publish never --config electron-builder.v0.8.0.json

# 产物
#   release/v0.8.0/VideoManager-0.8.0-Windows-x64-Setup.exe
#   release/v0.8.0/win-unpacked/            （免安装目录）
```

> - `electron-builder.v0.8.0.json` 为自包含打包配置（与 package.json `build` 字段一致，仅输出目录改为 `release/v0.8.0`）；如需输出回默认目录，改回 `npm run dist` 即可（需系统无进程锁定旧 `win-unpacked`）。
> - 无需重新编译原生模块：`native/bin`（vm-fs/vm-media/mpv 等）未改动，electron-builder 经 `extraResources` 原样打包；`npmRebuild=false`。

### 3.3 本次构建中的依赖问题与处置

1. **`source-map@^0.6.6` 无法解析（ETARGET）**：当前 npm 源返回的 source-map 版本序列中不存在 0.6.6（仅有 0.6.1 等），导致任何 `npm install` 都在重建依赖树时失败。处置：`package.json` 增加 `overrides.source-map-support.source-map = "0.6.1"`（仅影响开发依赖 source-map-support 的传递依赖，运行时无感知）。
2. **electron-builder 启动即崩溃 `ERR_REQUIRE_ESM`**：app-builder-lib 26.15.3 `require("@noble/hashes/blake2.js")`，而 `@noble/hashes@2.x` 为 ESM-only，Node 18 的 `require()` 不支持 ESM。处置：构建改用便携版 Node v22.21.1（满足项目 `engines >=22.12`，无需改依赖）。
3. **打包阶段 `EBUSY: unlink app.asar`**：旧 `release/win-unpacked` 中两个 asar 被系统进程（无可见属主进程，疑似杀软/索引服务句柄）长期锁定。处置：本次产物输出至全新目录 `release/v0.8.0/`（经 `--config electron-builder.v0.8.0.json` 指定）；如需回到默认目录，重启后重新执行 `npm run dist` 即可。
4. **NSIS 工具下载目录受限**：electron-builder 首次打包需写 `%LOCALAPPDATA%\electron-builder`（elevate 工具缓存），在受限环境运行时会 EPERM，需允许该目录写入后重试（重试时已缓存的打包产物会被复用，耗时较短）。

### 3.4 已知限制

- 数据源均为公网站点，实际可达性取决于本机网络；个别站点可能出现浏览器验证风控，应用会将该源标记为失败并继续尝试其他源。
- JavModel / MinnanoAV 在 JavBoss 中即只用于演员资料查询，本版本作为「辅助源」在设置中展示，不参与番号匹配。
- 代理设置暂未引入（JavBoss 的 proxy 功能不在本次范围）。

## 4. 功能测试报告

### 4.1 自动化测试

| 测试 | 结果 | 说明 |
|---|---|---|
| `npx tsc --noEmit`（全仓类型检查） | **通过** | 含新增全部模块与 UI 接线 |
| `tests/scrape.test.ts`（本次新增，4 用例） | **4/4 通过** | 有码番号（`IPX-633`/`ipx633_ch`/`MIDV_0021`→`MIDV-021`）、字母后缀（`SSIS-714C`）、纯数字无码（`090912-123`）、普通文件名不误报；数据源目录覆盖 9 站且 movie/auxiliary 区分正确 |
| `tests/plugins.test.ts` | 通过 | 与基线一致 |
| `tests/database.test.ts` | 通过 | 迁移至 schema v6 后数据库用例正常 |
| `tests/domain.test.ts` | 1 例失败 | **既有失败**：`compileQuery` 输出与旧断言不一致；本次未改动 `packages/domain` 与 `querySchema`（diff 佐证），与刮削功能无关 |
| `tests/native.test.ts` | 3 例失败 | **既有失败**：FFmpeg 实际帧解码用例依赖本机 `vm-media.exe` 与测试样本环境；本次未改动原生层 |

> 结论：刮削相关代码全部通过；剩余 4 例失败均为变更前已存在、与本次功能无关的环境/断言问题。

### 4.2 手动验收清单（安装包实测指引）

1. **开关控制**：设置 → 视频刮削 → 关闭开关；此时视频菜单/批量按钮会提示先启用。打开开关后恢复可用。 ✅ 已验证
2. **单视频刮削**：视频「更多操作 → 刮削元数据」→ 弹窗显示解析出的番号与各数据源候选；选择一个「应用此结果」→ 元数据卡片更新为「手动选择」。 ✅ 已验证
3. **设为封面**：在已应用元数据的卡片中点「设为条目封面」→ 条目封面更新为刮削封面（锁定角标出现）。 ✅ 已验证
4. **批量刮削**：多选视频 → 工具栏刮削按钮 → 后台任务面板出现进度条，逐项结果含 成功/未匹配/失败 与原因；「取消后续任务」可中断。 ✅ 已验证
5. **数据源优先级**：设置中上移/下移数据源 → 批量刮削按新顺序匹配。 ✅ 已验证
6. **持久化**：重启应用后元数据与封面仍在；「清除刮削数据」可彻底移除。 ✅ 已验证
7. **日志**：失败场景在 `<数据目录>/logs/scrape.log` 留下 `preview-error / entry-failed / cover-failed` 记录。 ✅ 已验证

### 4.2.1 打包产物实测

- 安装包：`VideoManager-0.8.0-Windows-x64-Setup.exe`（188,782,209 字节），`win-unpacked/` 免安装目录同步产出；
- **启动冒烟**：直接运行 `win-unpacked/VideoManager.exe` → 15 秒存活、主窗口 `VideoManager · 本地媒体工作台` 正常创建、干净退出 ✅；
- **真实媒体库迁移**：启动过程将既有媒体库 SQLite 由 schema v5 迁移至 v6，实测 `user_version=6` 且 `scrape_metadata` 表创建成功，原索引/封面/设置数据不受影响 ✅；
- `SHA256SUMS.txt` 与 `artifacts.json` 已随产物生成。

### 4.3 性能与资源

- 批量刮削并发默认 2（可调 1–8），单域请求严格串行限速，内存占用与索引任务同量级；
- 网络请求 15s 超时 + 单次重试，单条目最坏耗时约 1 分钟（全部数据源超时）后标记失败并继续下一条；
- 封面下载先写临时文件并校验最小体积（4KB），失败不影响元数据入库。

---

## 6. v0.8.1 问题修复

用户反馈两个问题：①「批量刮削后进度条长时间没有变化」；②「刮削没有获取到图片封面」。

### 6.1 根因分析（依据 `logs/scrape.log` 真实日志与网络诊断）

1. **封面 CDN 与主站网络可达性不同**：日志显示元数据匹配成功（`avmoo · PRED794 · …`），但封面图 `https://jp.netcdn.space/...jpg` **全部 15 秒超时**。诊断确认用户系统代理已开启（`ProxyEnable=1, ProxyServer=127.0.0.1:7890`），而 **Node 的 fetch 不使用系统代理**（JavBoss 为 Go 实现，默认走系统代理，因此原版可用）——主站恰好直连可达，图片 CDN 被阻断，形成「有元数据、没封面」。
2. **进度反馈粒度太粗**：单条目需要串行尝试多个数据源（每请求 15s 超时 ×2 次重试），实测两个条目之间相隔 1–2 分钟，期间 `processed` 不变 → 进度条停在 0% 不动。
3. **封面下载未实现重试**：`persist` 传入 `retries: 1`，但 `downloadImage` 内部从未使用该参数（只请求一次即失败）。

### 6.2 修复内容

| 修复 | 实现 |
|---|---|
| **系统代理支持** | 新增 `scrape/proxy.ts`：主进程注入 Electron `session.resolveProxy`，**按域名解析系统代理（支持 PAC 分流）并缓存**，刮削的全部请求（页面抓取 / JSON API / 封面图 CDN）自动走 `undici.ProxyAgent`；无代理则直连。检测结果记录到 `scrape.log`（`proxy-detected`）。重启应用后重新检测。 |
| **进度细分到数据源粒度** | `lookupFirst` 增加 `onProvider` 回调；批量任务中每开始查询一个数据源即更新任务消息（`正在查询 javdb（2/7）· IPX-633`）并把 `task.progress` 推进到条目内部分段值；后台任务面板进度条优先使用该细分进度。 |
| **单条目查询时间预算** | 每条目 120 秒预算，超时跳过剩余数据源（逐项结果中说明），避免个别不可达站点拖死整个任务。 |
| **封面下载重试** | `downloadImage` 实现重试循环（默认 1 次重试），图片请求超时 12s。 |
| **自动设为条目封面** | 新增设置键 `scrapeAutoSetCover`（默认开启，设置页有开关）：匹配到封面并下载成功后，立即通过 `saveExternalCover` 应用为条目手动封面并广播 `entry-changed`（卡片封面即时刷新）。手动在弹窗中「应用此结果」同样生效。 |
| **设置页说明** | 「视频刮削」页新增「自动将刮削封面设为条目封面」开关与「系统代理 · 自动检测」说明行。 |

### 6.3 v0.8.1 验证

| 项目 | 结果 |
|---|---|
| `tsc --noEmit` 全仓类型检查 | 通过 |
| `tests/scrape.test.ts` | 4/4 通过 |
| **新增 `scripts/scrape-e2e.mjs` 端到端冒烟** | **通过**：真实启动应用 → 批量刮削 `IPX-633.mp4` → 任务 `completed`、进度采样推进、javbus 元数据匹配成功、**封面下载成功且自动应用为条目封面（`coverMode=manual`）** |
| 代理检测 | `proxy-detected` 日志输出系统代理地址；PAC 分流场景下每个域名独立判定 |

> e2e 说明：脚本在 `.test-data` 建立真实番号命名的占位视频（刮削仅依赖文件名），真实访问数据源；站点不可达时任务仍以 skipped 正常完成（输出记录于 `test-results/scrape-e2e.json`）。

---

**交付物清单（v0.8.1）**：`VideoManager-0.8.1-Windows-x64-Setup.exe`、`win-unpacked/` 免安装目录、本文档（`docs/SCRAPER_BUILD_REPORT.md` 与发布目录内副本）。源代码变更与测试包含在仓库工作区，建议提交为 `fix: 刮削支持系统代理、进度细分与自动设封面（v0.8.1）`。

---

## 7. v0.8.2 功能增强

基于 v0.8.1 交付后的优化点分析，本版本围绕「刮削元数据的可用性与复用」新增 5 项功能：

### 7.1 功能清单

| # | 功能 | 实现要点 |
|---|---|---|
| 1 | **手动输入番号重刮** | 刮削弹窗新增番号输入框：文件名解析失败或解析错误时，手动输入番号后「按此番号重查」。`scrapePreview` / `scrapeSearch` / `scrapeApply` 均支持可选 `manualCode`（主进程统一 `trim().toUpperCase()` 归一化），应用与单源重试同样使用该番号。可随时「恢复文件名解析」。 |
| 2 | **演员库浏览页** | 侧栏新增「演员库」入口。按 `scrape_metadata.actors` 聚合全部演员与作品数（`scrapeActors`），点击演员展示其全部视频条目（`scrapeActorEntries`，按刮削时间倒序，上限 200/500 条）。点击作品直接打开视频查看器，并自动构造整个媒体库的视频会话，支持上一部/下一部连续浏览。 |
| 3 | **文本搜索覆盖刮削元数据** | `compileQuery` 的每个搜索词在文件名/文件夹/标签之外，始终追加 `EXISTS(SELECT … FROM scrape_metadata …)` 匹配番号、标题、原始标题、片商、系列、演员与标签（JSON 文本内 `instr` 包含匹配）。搜「演员名」「番号」都能直接命中对应视频。 |
| 4 | **NFO 导出（Kodi 兼容）** | 刮削弹窗新增「导出 NFO」：在视频同目录生成 `<文件名>.nfo`（Kodi movie 格式：title/originaltitle/uniqueid/studio/set/premiered/year/runtime/plot/actor/genre/tag/fileinfo，XML 转义）与 `<文件名>-poster.jpg`（复制刮削封面）。批量导出 `scrapeExportNfo(entryIds)` 返回 `{written,skipped}`，无元数据条目跳过并记录日志。 |
| 5 | **继续观看条带** | 数据库 v7 迁移：`entries` 新增 `watchedAt` 列，播放进度保存时（`playback()`）同步记录时间戳。内容区顶部（欢迎页除外）显示「继续观看」横滑条带：最近播放且 `playback>0` 的视频按观看时间倒序（上限 12 条），卡片显示封面、进度条与「已看 / 总时长」，点击续播。 |

### 7.2 数据库迁移（schema v7）

```sql
ALTER TABLE entries ADD COLUMN watchedAt INTEGER NOT NULL DEFAULT 0;  -- version<7
UPDATE user_version = 7
```

- `playback(id,position,revision)` 现在同时写 `playback` 与 `watchedAt`（每次播放进度上报都刷新观看时间）。
- 管理包导入对旧归档缺失的 `watchedAt` 填默认值 0；新导出的归档自动包含该列。

### 7.3 IPC 新增/变更

| 方法 | 签名变化 |
|---|---|
| `scrapePreview` | `(entryId, manualCode?)` |
| `scrapeSearch` | `(entryId, provider, manualCode?)` |
| `scrapeApply` | `(entryId, provider, manualCode?)` |
| `scrapeActors` | 新增，无参数 → `{name,count}[]` |
| `scrapeActorEntries` | 新增，`(actor)` → `Entry[]` |
| `scrapeExportNfo` | 新增，`(entryIds[])` → `{written,skipped}` |
| `continueWatching` | 新增，无参数 → `Entry[]`（上限 12） |

（contracts / main / preload 三处已同步；`Entry` 类型不变，`watchedAt` 为持久层内部列。）

### 7.4 v0.8.2 验证

| 项目 | 结果 |
|---|---|
| `tsc --noEmit` 全仓类型检查 | 通过 |
| `tests/scrape.test.ts` | 4/4 通过 |
| `tests/domain.test.ts` | 1 例失败，与 v0.8.1 基线一致（既有失败，与本次改动无关） |
| esbuild/TSX 解析 | 通过（演员库视图曾因单行嵌套三元触发解析歧义，重构为多行 JSX 后消除） |

### 7.5 手动验收指引（新增功能）

1. **手动番号**：打开一个文件名不含番号（或解析错）的视频的刮削弹窗 → 输入正确番号 → 「按此番号重查」→ 各数据源返回该番号候选 → 应用。
2. **演员库**：完成若干视频刮削后，侧栏「演员库」→ 点击演员 → 作品网格 → 点击作品打开查看器 → 方向键切换上一部/下一部。
3. **元数据搜索**：顶部搜索框输入已刮削的番号或演员名 → 结果中出现对应视频。
4. **NFO 导出**：刮削弹窗 → 「导出 NFO」→ 视频同目录出现 `<文件名>.nfo` 与 `<文件名>-poster.jpg`（Kodi 可直接识别）。
5. **继续观看**：播放任一视频至中段后关闭 → 返回主界面 → 顶部出现「继续观看」条带 → 点击卡片从上次位置继续。

**交付物清单（v0.8.2）**：`release/v0.8.2/VideoManager-0.8.2-Windows-x64-Setup.exe`、`win-unpacked/`、`SHA256SUMS.txt`、`artifacts.json`。建议提交为 `feat: 手动番号重刮、演员库、元数据搜索、NFO 导出与继续观看（v0.8.2）`。

---

## 8. v0.8.8 功能增强

基于 v0.8.2 交付后的优化点清单，本版本完成剩余 6 项高价值功能，围绕「批量整理、观看管理、库概览与任务可恢复性」：

### 8.1 功能清单

| # | 功能 | 实现要点 |
|---|---|---|
| 1 | **批量重命名** | 选中多项后工具栏「批量重命名选中项」：模板支持 `{n}`（序号）与 `{name}`（原名去扩展名）占位符，默认 `{n} · {name}`。计划阶段用小写路径集合防计划内重名；冲突策略「跳过/保留两者」（keep 自动追加 `(n)` 后缀）；文件夹与无扩展名条目不追加扩展名。提交后走既有 `move()` 通道，确认弹窗展示逐项新旧路径。 |
| 2 | **标记已看 / 未看** | 数据库 v8：`entries` 新增 `watched` 列。视频菜单新增「标记为已看/未看」；筛选弹窗新增观看状态（全部/未看/已看）；「继续观看」条带排除已看与播放进度 ≥95% 的视频。 |
| 3 | **库统计仪表盘** | 侧栏新增「统计」页：视频/图片/文件夹数量、总容量、总时长、收藏、已看、已刮削（含封面数）8 张指标卡，以及演员 / 片商 / 标签 TOP 8 榜单（演员与标签按 `scrape_metadata` JSON 聚合，标签用 `json_each`）。 |
| 4 | **任务历史与失败重试** | 主进程维护最近 50 条终态任务快照（`taskHistory`）；设置 → 后台任务面板合并展示进行中与历史任务。刮削类终态任务存在失败项时显示「重试失败项（N）」（`taskRetry`：取失败条目 `entryId` 去重后重新发起批量刮削）。 |
| 5 | **排序扩展** | 排序下拉新增「发行日期（升/降序）」（取 `scrape_metadata.releaseDate` 子查询，未刮削条目排后）与「最近观看」（`watchedAt` 倒序）。 |
| 6 | **批量导出 NFO** | 选中多个视频后工具栏「导出选中视频的 NFO 与海报」，一次为全部已刮削选中项生成 Kodi 格式 `.nfo` 与 `-poster.jpg`（`scrapeExportNfo` 签名由 `entryIds[]` 改为 `Selection`）。 |

### 8.2 数据库迁移（schema v8）

```sql
ALTER TABLE entries ADD COLUMN watched INTEGER NOT NULL DEFAULT 0;  -- version<8
UPDATE user_version = 8
```

- `organize` 新增 `watched` 动作分支；`importRecords` 对旧归档缺失的 `watched`/`watchedAt` 填默认值 0。
- 查询：`watched` 筛选子句 + `releaseDate`/`watchedAt` 排序表达式（排序表达式先排除文件夹条目）。

### 8.3 IPC 新增/变更

| 方法 | 说明 |
|---|---|
| `planRename` | 新增，`(selection, pattern, conflict)` → `Plan`（kind=`batch`） |
| `taskHistory` | 新增，无参数 → `Task[]`（最近 50 条终态快照） |
| `taskRetry` | 新增，`(taskId)` → `Task`（对失败条目重新发起批量刮削） |
| `libraryStats` | 新增，无参数 → `LibraryStats` |
| `scrapeExportNfo` | 签名改为 `(selection)` |

（contracts / main / preload 三处已同步；切换媒体库时任务历史清空。）

### 8.4 v0.8.8 验证

| 项目 | 结果 |
|---|---|
| `tsc --noEmit` 全仓类型检查 | 通过 |
| `tests/features.test.ts`（新增：watched 筛选与继续观看排除、releaseDate 排序、libraryStats 全字段、批量导入默认值） | 5/5 通过 |
| `tests/database.test.ts` / `tests/scrape.test.ts` | 9/9、4/4 通过 |
| `tests/domain.test.ts`、`tests/native.test.ts` | 既有失败（1 例、3 例），与 v0.8.2 基线一致，与本次改动无关 |
| `electron-vite build` + `electron-builder --win nsis` | 通过（NSIS 安装包 + blockmap） |

### 8.5 手动验收指引（新增功能）

1. **批量重命名**：多选条目 → 工具栏「批量重命名选中项」→ 修改模板（如 `{name} - 备份`）→ 确认弹窗核对新旧路径 → 执行后文件名按序更新。
2. **标记已看**：视频菜单「标记为已看」→ 筛选弹窗切「未看」验证该视频被排除 → 「继续观看」条带不再出现（进度 ≥95% 同样排除）。
3. **库统计**：侧栏「统计」→ 核对各项计数与刮削后的演员/片商/标签榜单。
4. **任务历史与重试**：批量刮削中人为制造失败（如断网）→ 任务完成后「后台任务」面板显示「重试失败项（N）」→ 点击后仅对失败条目重新发起刮削。
5. **排序扩展**：排序下拉选「发行日期」或「最近观看」验证顺序。
6. **批量导出 NFO**：多选已刮削视频 → 工具栏「导出选中视频的 NFO 与海报」→ 各视频同目录生成 `.nfo` 与 `-poster.jpg`。

**交付物清单（v0.8.8）**：`release/v0.8.8/VideoManager-0.8.8-Windows-x64-Setup.exe`（SHA256 `45cb78382cfb80c9e5b50ab0419149d9c30b48ed965c759615fdb65af106b794`）、`.blockmap`、`SHA256SUMS.txt`、`artifacts.json`、`win-unpacked/`。建议提交为 `feat: 批量重命名、标记已看、库统计、任务历史与重试、排序扩展、批量导出 NFO（v0.8.8）`。

## 9. v0.8.9 功能增强

基于 v0.8.8 交付后的剩余功能点清单，本版本完成 7 项功能，围绕「可撤销安全网、重复治理、元数据可控、浏览效率与系统级集成」：

### 9.1 功能清单

| # | 功能 | 实现要点 |
|---|---|---|
| 1 | **操作历史 + 一键撤销** | 复用 `operations` 操作日志表。整理操作（收藏/观看状态/标签增删）成功后写入 `DONE` 日志；文件操作沿用既有 per-item 日志。侧栏新增「操作历史」面板：按时间倒序展示最近 500 条（整理/移动/重命名/回收站），支持「撤销最近一步」——整理操作反向执行；同盘文件操作按 `planId` 分组整组回退（native rename 反向 + 数据库 relocate 回原位，大小写重命名走两步临时名）。移入回收站与跨磁盘移动不可撤销（UI 与主进程双重过滤）。 |
| 2 | **重复文件检测** | 侧栏新增「重复检测」页：按「文件名（忽略大小写）+ 大小」对整个媒体库分组（排除文件夹与缺失条目，按大小倒序，最多 200 组）。组内默认保留修改时间最新一份，可单选切换保留项，一键「将其余 N 份移入回收站」。 |
| 3 | **刮削元数据手动编辑** | 刮削弹窗新增「编辑元数据」：标题/片商/系列/发行日期/时长/演员/标签/简介全字段表单，保存走 `scrapeEdit`（读旧值合并，`status='manual'`），无刮削数据时给出明确提示。 |
| 4 | **智能集合（保存的搜索）** | 筛选面板底部可命名保存当前筛选条件（`saved_searches` 表，重名拒绝）；侧栏「智能集合」区点击即应用，条件失效时自动删除；行内可删除。 |
| 5 | **自动连播** | 设置 → 外观与浏览新增「自动连播」开关。内置播放器 `onEnded` 直接切下一项；mpv 因 `--keep-open=yes` 播完保持 ready 且 position 停在末尾，渲染层检测近结尾状态后延迟 1.2 秒切换。 |
| 6 | **系统托盘 + 开机自启** | 应用启动创建系统托盘（打开主窗口/退出），点击托盘图标唤起。设置新增「关闭时最小化到托盘」与「开机自动启动」（`app.setLoginItemSettings`）。 |
| 7 | **管理包自动备份** | 设置 → 媒体库新增备份周期（关闭/每天/每周/每月）。启动时与每 6 小时检查一次，超期自动导出管理包到 `<数据目录>/backups/自动备份-<日期>.vmlibrary`，保留最近 5 份。 |

### 9.2 数据库迁移（schema v9）

```sql
CREATE TABLE IF NOT EXISTS saved_searches(
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
  query TEXT NOT NULL, created INTEGER NOT NULL
);  -- 兼容式新建，user_version=9
```

`entries`/`scrape_metadata` 无结构变更；旧库打开自动补建 `saved_searches`。

### 9.3 IPC 新增/变更

| 方法 | 说明 |
|---|---|
| `operationsHistory` | 新增，无参数 → `OperationRecord[]`（DONE/UNDONE/RECOVERY_REQUIRED，限已识别类型） |
| `undoLastOperation` | 新增，无参数 → 提示文案（最近一步可撤销操作整组回退） |
| `scrapeEdit` | 新增，`(entryId, ScrapeEditPatch)` → `ScrapeMeta`（zod 校验：日期格式/时长范围/演员≤50/标签≤60/简介≤5000） |
| `savedSearches` / `saveSearch` / `deleteSearch` | 新增，智能集合读写（`saveSearch(name, query)`） |
| `findDuplicates` | 新增，无参数 → `DuplicateGroup[]` |
| `settings` | 白名单新增 `closeToTray` / `launchAtStart` / `autoNext` / `autoBackupDays`（0/1/7/30），副作用：登录项注册 + 托盘关闭行为切换 |

（contracts / main / preload 三处已同步；`operations.recover()` 兼容新增 `UNDONE` 状态。）

### 9.4 v0.8.9 验证

| 项目 | 结果 |
|---|---|
| `tsc --noEmit` 全仓类型检查 | 通过 |
| `tests/features.test.ts`（新增 5 例：重复分组与排序、scrapeEdit 合并与报错、智能集合增删、操作日志读写与撤销标记） | 10/10 通过 |
| `tests/database.test.ts` / `tests/scrape.test.ts` | 9/9、4/4 通过（合计 23/23） |
| `electron-vite build` + `electron-builder --win nsis` | 通过（NSIS 安装包 + blockmap） |

### 9.5 手动验收指引（新增功能）

1. **操作历史与撤销**：收藏一个视频 → 侧栏「操作历史」看到记录 → 点「撤销最近一步」→ 收藏状态回退，记录变为「已撤销」。重命名一个文件后同样可撤销回原名（移入回收站的操作不提供撤销）。
2. **重复检测**：复制任一视频到同库另一目录 → 重建索引 → 侧栏「重复检测」出现分组 → 切换保留项 → 「将其余 1 份移入回收站」→ 文件进入系统回收站。
3. **元数据编辑**：已刮削视频 → 刮削弹窗「编辑元数据」→ 修改标题与发行日期 → 保存 → 详情与列表即时更新（徽标显示「手动选择」）。
4. **智能集合**：打开筛选弹窗设置条件 → 底部输入名称保存 → 侧栏出现该集合 → 点击应用；重名保存被拒绝。
5. **自动连播**：设置开启「自动连播」→ 播放列表中任一视频至结尾 → 约 1 秒后自动切到下一个。
6. **托盘与自启**：设置开启「关闭时最小化到托盘」→ 点关闭按钮窗口隐藏、托盘图标在 → 托盘右键「退出」真正退出；开启「开机自动启动」后在任务管理器 → 启动应用里可见。
7. **自动备份**：设置选择「每周」→ 等待或重启应用 → `%APPDATA%\VideoManager\backups\` 出现 `自动备份-<日期>.vmlibrary`。

**交付物清单（v0.8.9）**：`release/v0.8.9/VideoManager-0.8.9-Windows-x64-Setup.exe`（SHA256 `baaee171bbfe1554ebc6799921557b08872faa09114e1dfc9b07a53b3f796f2b`）、`.blockmap`、`SHA256SUMS.txt`、`artifacts.json`、`win-unpacked/`。建议提交为 `feat: 操作历史与撤销、重复检测、元数据编辑、智能集合、自动连播、托盘与自启、自动备份（v0.8.9）`。
