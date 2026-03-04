# TaskMall 新服务器部署指南

按顺序执行以下步骤，即可在新服务器上跑起整站。

---

## 一、安装系统软件

在**新服务器**上安装：

| 软件 | 版本/说明 |
|------|-----------|
| **Node.js** | 18 或以上（推荐 18.x / 20.x LTS） |
| **Nginx** | 任意稳定版，用于反向代理和静态资源 |
| **PM2** | 全局安装，用于守护 Node 进程与开机自启 |

示例（以 Ubuntu/Debian 为例）：

```bash
# Node.js 18+（若未装，可用 n 或 nvm 或官方源）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Nginx
sudo apt-get update && sudo apt-get install -y nginx

# PM2 全局
sudo npm install -g pm2
```

---

## 二、放代码

把整站代码放到新目录，例如：

```bash
# 例如目录：/www/wwwroot/你的域名/
# 用 git、scp、rsync 等方式把项目拷过去即可
```

---

## 三、安装项目依赖

```bash
cd /www/wwwroot/你的域名
npm install
```

无需单独安装 MySQL/PostgreSQL，本项目使用 **SQLite**（单文件数据库）。

---

## 四、配置环境

```bash
cp .env.example .env
```

编辑 `.env`，至少修改：

| 项 | 说明 |
|----|------|
| `JWT_SECRET` | 生产环境必须改为随机字符串，如：`openssl rand -hex 32` |
| `DB_PATH` | 数据库文件路径，**建议用绝对路径**，如：`/www/wwwroot/你的域名/data/taskmall.db` |
| `ADMIN_USERNAME` | 首次创建管理员时使用的账号名 |
| `ADMIN_PASSWORD` | 首次创建管理员时使用的密码（首次运行后请尽快在后台修改） |

其他可保持 `.env.example` 中的默认（如 `PORT=3000`、`NODE_ENV=production`）。

---

## 五、用 PM2 启动

在项目根目录执行：

```bash
cd /www/wwwroot/你的域名
pm2 start server/app.js --name taskmall-platform
pm2 save
pm2 startup   # 按提示执行生成的命令，实现开机自启
```

常用命令：

- 查看状态：`pm2 list`
- 看日志：`pm2 logs taskmall-platform`
- 重启：`pm2 restart taskmall-platform`

---

## 六、配置 Nginx

1. 把项目里的 `nginx.conf` 复制到 Nginx 的 sites-enabled：

   ```bash
   sudo cp /www/wwwroot/你的域名/nginx.conf /etc/nginx/sites-available/taskmall
   sudo ln -sf /etc/nginx/sites-available/taskmall /etc/nginx/sites-enabled/
   ```

2. 编辑该配置，把 **server_name**、**root** 以及所有**项目路径**改成你的域名和实际目录，例如：

   - `server_name 你的域名.com;`
   - `root /www/wwwroot/你的域名;`
   - `location /admin/` 和 `location /agent/` 里的 `alias` 也要改成：`/www/wwwroot/你的域名/views/admin/` 和 `.../views/agent/`（与 root 同前缀）。

3. 测试并重载 Nginx：

   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```

---

## 七、迁移数据（从旧机迁到新机）

若旧服务器上已有数据：

1. 把旧机上的 **data/** 目录下的 `taskmall.db`（或你 `.env` 里 `DB_PATH` 指向的库文件）拷贝到新机。
2. 放到新机项目目录下相同相对路径，或你 `.env` 里 `DB_PATH` 所写的**绝对路径**。
3. 确保新机 `.env` 中 `DB_PATH` 指向该文件（建议绝对路径）。

无需单独安装或迁移 MySQL/PostgreSQL。

---

## 八、新服务器“需要安装”的清单总结

| 类型 | 需要安装/准备的内容 |
|------|----------------------|
| **系统软件（必装）** | Node.js（18+）、Nginx、PM2（全局） |
| **项目依赖** | 在项目目录执行 `npm install` 即可，无需再装其它运行时 |
| **数据库** | SQLite，不需装 MySQL/PostgreSQL；只需把旧机的 `data/taskmall.db` 拷到新机并配置好 `DB_PATH` |

---

## 九、部署后建议

- **数据库备份**：`node server/scripts/backup-db.js`，可配合 cron 每天执行。
- **日志清理**：`node server/scripts/cleanup-old-logs.js 90`，可配合 cron 定期执行。

详见项目根目录 `README.md` 中的「数据库备份」「日志清理」「定时任务说明」。
