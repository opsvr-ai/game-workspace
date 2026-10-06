# scripts/ —— 只放「发版链路」脚本

这个目录以前堆了 440 多个一次性脚本（查数据、改数据、临时补丁、CDP 截图……），
`git status` 里永远是几百个未入库文件，真正在用的发版脚本反而只有 4 个入库。
2026-09-22 按老板「你自己看着办」清理：**一次性脚本已全部备份并移出仓库**，
这里只保留下面这条发版/运维链路，并且**全部入库**（新克隆一份仓库也能直接发版）。

备份位置：`E:\source_code\_archive\game-workspace-scripts-20260922.zip`

## 发版链路（改完代码就按这个走，见 AGENTS.md）

> **先配口令（2026-10-03 起）**：脚本不再把服务器口令写死在代码里，
> 跑之前先设置环境变量，否则会直接报「缺少服务器口令」退出：
>
> ```powershell
> $env:CHUNLV_SSH_PASS = "<服务器 ubuntu 口令>"      # 必需
> $env:CHUNLV_SMB_CRED = "chunlvops:<运维口令>"      # 只有 _push_watchdog_all.py 需要
> ```

> **服务端跑在哪（2026-10-06 起）**：**root** + `/apps/server/game-workspace`（腾讯云 1.117.229.36）。
> pm2 是 root 那份，管理命令要带 `sudo env PM2_HOME=/root/.pm2 pm2 ...`；root 的 SSH 口令登录是关的，
> 所以脚本统一「ubuntu 登录 → 传到 ubuntu 可写的临时路径 → `sudo` 装进 root 目录」。
> 启动入口是 `apps/server/start-server.sh`（内部 `node --env-file=.env`），
> **别再用 `pm2 start dist/main.js`** —— 那样不会加载 `.env`，会 crash loop。
> 老目录 `/home/ubuntu/chunlv` 还在（可回滚），但数据库容器仍 bind 它的 `data/`，别删。

```powershell
# 1. 前端（网页端）——部署 + 打版本号
python scripts\_deploy_web_cloud.py
python scripts\_set_web_version.py vXXX

# 2. 服务端
python scripts\_deploy_server_cloud.py

# 3. 陪玩端客户端（会打断接单，注意老板的「这两天不发客户端」）
python scripts\_publish_client.py <版本号>

# 4. 客服端客户端（只影响客服电脑，客服端下次启动自己更新；不碰陪玩接单链路）
python scripts\_publish_cs_client.py <版本号>
```

## 运维 / 辅助

| 脚本 | 用途 |
|------|------|
| `_upload_sh_cloud.py` | 上传看门狗 `SystemHelper.exe` 到云端 `1.117.229.36:3001/uploads/` |
| `_push_watchdog_all.py` | 批量给各台陪玩机下发新看门狗（逐台停服务→换文件→起服务→回读构建号） |
| `_repack_client_zip.py` | 重打陪玩端客户端 zip（换看门狗之后必跑，只重打包不动版本号） |
| `_repack_cs_zip.py` | 重打客服端客户端 zip（同上，客服端那份） |
| `_export_api_contract.mjs` | 从 Controller / Gateway 源码导出四端契约（接口路径 + Socket 事件）到 `docs/API-CONTRACT.json`；CI 用 `--check` 比对 |
| `_export_web_routes.mjs` | 从 `router.tsx` 导出页面路由表到 `docs/WEB-ROUTES.json`；CI 用 `--check` 比对（`pnpm routes` / `routes:check`） |
| `_check_ui_tokens.mjs` | 扫前端还剩多少硬编码色值，和基线 `docs/UI-TOKEN-BASELINE.json` 比对（只能减不能增；`pnpm ui:tokens` / `ui:tokens:check`） |
| `_check_loading_state.mjs` | 加载态冻结：页面里「裸写的 `<Spin />`」只能减不能增（基线 `docs/LOADING-STATE-BASELINE.json`，统一用 `components/LoadingState.tsx`；`pnpm loading:check`） |
| `_check_stat_cards.mjs` | 统计卡冻结：自己写 `Kpi`/`statCard`/`MetricCard`、或 `<Card><Statistic/>` 拼统计卡，只能减不能增（基线 `docs/STAT-CARD-BASELINE.json`，统一用 `components/StatCard.tsx`；`pnpm stat-cards` / `stat-cards:check`） |
| `_export_css_vars.mjs` | 把 `styles/tokens.ts` 里的全部 CSS 变量生成进 `index.css` 的 `:root` 兜底区，并卡「CSS 里用了 var(--x) 但没人定义」（`pnpm css:vars` / `css:vars:check`） |
| `_shot_ui.mjs` | **界面改版前后对照用**：无头 Edge + CDP，给某一页 / 某一区块截图。选项：`--sel=` 只截某个元素、`--pre=<js 文件>` 导航前注入（造登录态）、`--await=` 等元素出现、`--full` 整页高度、`--eval=<js>` 顺手取个数（量宽度 / 对齐）（`node scripts/_shot_ui.mjs http://127.0.0.1:8100/ui-kit tmp_shots/x.png --sel="#controls" --scale=2`）|
| `_ui_audit.mjs` | **「界面体检」**：逐页跑探针，量「横向溢出 / 文字截断 / 每页页头的文字·字号·字重·颜色·是否渐变 / 有没有页面标题」，输出 JSON（`--json=`）。「有没有被切掉、页头齐不齐」用这个量，不要靠眼睛看截图 |
| `_shot_pages.mjs` | **批量**给多个页面截图（只开一次无头浏览器，第二页起每页几秒）—— UI 巡检用：`node scripts/_shot_pages.mjs --out=tmp_shots/audit --pre=scripts/_shot_seed_owner.js --base=http://127.0.0.1:8123 /admin /cs/dispatch` |
| `_mock_api.mjs` | **本地「假后台」**：把 `apps/web/dist` 当静态站发出去，同时把 `/api/*` 全部接管成假数据。于是**不用数据库、不连线上**也能把真实页面打开看。`--port=` 换端口、`--role=OWNER\|ADMIN\|CS\|COMPANION` 换身份（要看别的角色就再起一个实例）。请求路径会记进 `tmp_shots/_api_log.txt`，照着补假数据即可 |
| `_shot_seed_owner.js` | 配合 `--pre=` 用：导航前注入，让前端以为「已经登录、而且是老板」（只写本机 storage） |
| `update-changelog.sh` | 从 git log 生成 CHANGELOG 片段 |

> 注意：`AGENTS.md` / `docs/DEPLOYMENT.md` 里出现过的 `scripts/_set_autokill_on.py` 已经删除
> （CHANGELOG 2026-09 记过：历史脚本、勿再执行）。

## 约定

- **一次性脚本不要放这里、也不要入库**（`.gitignore` 已经挡掉 `scripts/_*`）。
  真要用，写到仓库外或临时目录，用完删掉。
- 新增**长期使用**的链路脚本时，除了入库，还要在 `.gitignore` 的白名单里加一行，
  否则会被 `scripts/_*` 规则忽略、下一个人看不到。
