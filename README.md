# TaskMall

任务商城平台项目。

**新服务器部署**：请查看 [DEPLOY.md](./DEPLOY.md)，按步骤安装 Node.js、Nginx、PM2，放代码、装依赖、配 `.env`、PM2 启动、Nginx 配置与数据迁移。

## 运行

```bash
npm install
# 配置 .env 后启动
node server/app.js
```

## 数据库备份

使用内置脚本备份 SQLite 数据库（复制 db 文件，适合定时任务）：

```bash
# 备份到默认目录 backups/（带时间戳文件名）
node server/scripts/backup-db.js

# 备份到指定目录
node server/scripts/backup-db.js /path/to/backup-dir
```

建议配合 cron 定时执行，例如每天凌晨 4 点：  
`0 4 * * * cd /path/to/project && node server/scripts/backup-db.js`

## 日志清理

`login_logs`、`audit_logs` 会持续增长，建议定期清理过期记录：

```bash
# 保留最近 90 天，删除更早的登录/操作日志
node server/scripts/cleanup-old-logs.js 90

# 保留 30 天
node server/scripts/cleanup-old-logs.js 30
```

建议配合 cron 每周执行一次，例如周日凌晨 3 点：  
`0 3 * * 0 cd /path/to/project && node server/scripts/cleanup-old-logs.js 90`

## 定时任务说明

建议在服务器上配置 cron，定期执行以下脚本：

| 任务       | 脚本 | 建议 cron | 说明 |
|------------|------|-----------|------|
| 数据库备份 | `node server/scripts/backup-db.js` | `0 4 * * *`（每天 4 点） | 将 SQLite 数据库复制到 `backups/` 目录，文件名带时间戳 |
| 日志清理   | `node server/scripts/cleanup-old-logs.js 90` | `0 3 * * 0`（每周日 3 点） | 删除 90 天前的登录日志与操作审计日志，保留最近 90 天 |

执行前请确保工作目录为项目根目录，例如：  
`cd /path/to/project && node server/scripts/backup-db.js`
