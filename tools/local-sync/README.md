# StarCull 本地同步工具

把服务器上的 `data/db.json` 和 `data/uploads/` 图片拉回本地，一条命令完成。
不需要额外依赖（Node 18+ 自带 `fetch`）。

## 目录

```
tools/local-sync/
├── sync.js               # 同步主程序
├── config.js             # 配置加载（默认值 + config.local.json + 环境变量 + 命令行）
├── config.example.json   # 配置模板
├── package.json
└── README.md
```

输出位置（默认）：

| 内容 | 本地路径 |
| --- | --- |
| 数据库 | `data/db.json`（直接覆盖） |
| 图片 | `data/uploads/<相对路径>`（直接覆盖） |
| 覆盖前备份 / 同步清单 | `.backups/local-sync/`（在 `data/` 之外，已被 `.gitignore` 忽略） |

## 配置

复制模板并填写 token：

```powershell
Copy-Item tools\local-sync\config.example.json tools\local-sync\config.local.json
```

```json
{
  "serverUrl": "http://45.64.75.15:4173",
  "adminToken": "<服务器 admin token>",
  "dataDir": "../../data",
  "backupDir": "../../.backups/local-sync",
  "keepDbBackups": 5,
  "concurrency": 4,
  "timeoutMs": 30000
}
```

- `config.local.json` 含密钥，**已被 `.gitignore` 忽略，不要提交**。
- 相对路径按 `tools/local-sync/` 解析，不受运行目录影响。
- 也可用环境变量覆盖：`STARCULL_SYNC_SERVER`、`STARCULL_ADMIN_TOKEN`、`STARCULL_SYNC_DATA_DIR`、`STARCULL_SYNC_BACKUP_DIR`。

## 运行

```bash
# 在仓库根目录
node tools/local-sync/sync.js

# 只检查差异，不写任何文件
node tools/local-sync/sync.js --dry-run

# 临时输出到别的目录（自测用，不动真实 data/）
node tools/local-sync/sync.js --out ./tmp-mirror
```

或在 `tools/local-sync` 目录下 `npm run sync` / `npm run sync:dry`。

## 行为说明

**覆盖范围**

- `db.json`：整文件覆盖为服务器版本。
- `uploads`：服务器清单里的每张图覆盖到本地同相对路径；服务器上没有、本地多出来的文件**默认不删除**，只在统计里提示数量与前 5 个文件名。

**备份与原子写**

- 覆盖 `db.json` 前，先把现有文件复制为 `.backups/local-sync/db-YYYYMMDD-HHmmssSSS.json`；备份失败则中止覆盖。
- 只保留最近 `keepDbBackups` 份（默认 5），更早的自动清理。
- `db.json` 先写同目录临时文件再 `rename`，中途失败不会留下半截文件；临时文件会清理。
- 图片同样先写 `.part-*` 临时文件再 `rename`，并按 `Content-Length` 校验完整性。
- 默认不备份被覆盖的图片（可从服务器重新拉取）；需要时把 `backupImages` 设为 `true`。

**增量**

- 对已存在的图片先 `HEAD /uploads/<path>` 取服务器大小；大小不同直接重下。
- 大小相同且同步清单里的 `sha256` 与本地文件哈希一致 → 跳过，不重新下载。
- 清单保存在 `.backups/local-sync/manifest.json`，只记录当前服务器仍存在的文件。

**失败处理**

- 连不上、DNS 失败、超时、401、非 2xx、磁盘写入失败都会打印明确错误并以退出码 1 结束。
- 任何一张图片失败时，本次**不覆盖** `db.json`（避免数据库引用本地缺失的图片），图片与清单仍会保留已成功的部分，修好后重跑即可补齐。

**结束统计**

打印 db 大小与 `products/users/draws/messages` 条数、图片总数/下载/跳过/失败、本地多出文件数、耗时、备份路径。

## 注意

- 本地服务运行时，`src/db.js` 在内存里持有旧数据，之后有任何写操作都会把旧数据写回 `data/db.json`，覆盖刚拉取的内容。**建议先停掉本地服务再执行同步**，或在同步后重启服务。
- 服务端接口未做任何修改：本工具只使用现有的 `/api/admin/export-db`、`/api/admin/list-uploads` 与静态 `/uploads/*`。

## 自测

```powershell
# 1. 启动本地服务
node server.js

# 2. 用环境变量提供 token，输出到临时目录，避免动真实 data/
$env:STARCULL_ADMIN_TOKEN = "<token>"
node tools/local-sync/sync.js --out tools/local-sync/tmp-mirror
node tools/local-sync/sync.js --out tools/local-sync/tmp-mirror   # 第二次应全部跳过
```
