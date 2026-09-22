# scripts/ —— 只放「发版链路」脚本

这个目录以前堆了 440 多个一次性脚本（查数据、改数据、临时补丁、CDP 截图……），
`git status` 里永远是几百个未入库文件，真正在用的发版脚本反而只有 4 个入库。
2026-09-22 按老板「你自己看着办」清理：**一次性脚本已全部备份并移出仓库**，
这里只保留下面这条发版/运维链路，并且**全部入库**（新克隆一份仓库也能直接发版）。

备份位置：`E:\source_code\_archive\game-workspace-scripts-20260922.zip`

## 发版链路（改完代码就按这个走，见 AGENTS.md）

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
| `_repack_client_zip.py` | 重打客户端 zip |
| `update-changelog.sh` | 从 git log 生成 CHANGELOG 片段 |

> 注意：`AGENTS.md` / `docs/DEPLOYMENT.md` 里出现过的 `scripts/_set_autokill_on.py` 已经删除
> （CHANGELOG 2026-09 记过：历史脚本、勿再执行）。

## 约定

- **一次性脚本不要放这里、也不要入库**（`.gitignore` 已经挡掉 `scripts/_*`）。
  真要用，写到仓库外或临时目录，用完删掉。
- 新增**长期使用**的链路脚本时，除了入库，还要在 `.gitignore` 的白名单里加一行，
  否则会被 `scripts/_*` 规则忽略、下一个人看不到。
