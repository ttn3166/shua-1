# 订单记录与 502 检查报告

## 1. 数据库与接口逻辑 ✅

- **数据库路径**：`./data/taskmall.db`（项目根目录下），当前存在且可读。
- **表结构**：`users` 含 `role`，`orders` 含 `source`，与当前订单接口代码一致。
- **订单数据**：库内当前约 **94 条** 订单（`role='User'`），抽样查询正常。
- **订单接口逻辑**：已用 Node 直接执行与 `GET /orders` 相同的查询，无报错，能返回数据。

结论：**后端订单查询和数据库本身正常，502 不是由“库里没数据”或“SQL 写错”导致。**

---

## 2. 路由与前端请求 ✅

- **路由挂载**：`app.use('/api/admin', adminRoutes)`，管理端接口前缀为 `/api/admin`。
- **订单列表**：`GET /orders` 在 admin 路由中，完整路径为 `GET /api/admin/orders`。
- **前端请求**：`fetchAPI('/orders?limit=...&offset=...')`，与 `API_BASE = '/api/admin'` 拼接后为 `GET /api/admin/orders?...`，与后端一致。

结论：**前端请求的 URL 正确，路由配置无误。**

---

## 3. 502 可能原因（需在服务器上排查）

502 表示“网关/代理收到了请求，但上游（Node）没有返回正常响应”。常见情况：

| 情况 | 建议排查 |
|------|----------|
| Node 未启动或已退出 | 在服务器上执行 `ps aux \| grep node` 或 `pm2 list`，确认进程存在且无频繁重启。 |
| 进程启动目录不对 | 若用 pm2，确认 `cwd` 为项目根目录（如 `/www/wwwroot/185.39.31.27`），否则 `./data/taskmall.db` 会指向错误路径。 |
| Nginx/代理超时或连不上后端 | 查看 Nginx `error_log`，是否有 `upstream timed out`、`connection refused` 等；确认 `proxy_pass` 的端口与 Node 监听端口一致（如 3000）。 |
| 请求未带 Token | 管理端接口需要 `Authorization: Bearer <token>`，未带或过期会返回 401，一般不会 502；若代理把 401 转成 502，需看代理配置。 |

---

## 4. 建议的运维检查命令

在服务器上执行（按实际路径替换）：

```bash
# 1. 确认 Node 进程与工作目录
ps aux | grep "node.*app.js"
# 若用 pm2：
pm2 list
pm2 show <app-name>   # 看 cwd、端口

# 2. 确认数据库路径与权限
ls -la /www/wwwroot/185.39.31.27/data/taskmall.db

# 3. 本机测订单接口（需先有管理员 token）
# 先登录取 token，再：
curl -s -H "Authorization: Bearer <TOKEN>" "http://127.0.0.1:3000/api/admin/orders?limit=20&offset=0"
```

若本机 curl 返回 200 和订单 JSON，则接口正常，502 多半来自 Nginx/代理或网络；若本机就 502/5xx，则看 Node 日志或 pm2 logs。

---

## 5. 生产环境建议

- **DB_PATH**：在 `.env` 或 pm2 环境变量中改为**绝对路径**，例如：  
  `DB_PATH=/www/wwwroot/185.39.31.27/data/taskmall.db`  
  这样无论从哪个目录启动进程，都使用同一数据库。
- **日志**：保证 Node 的 `console.error` 能写入文件或 pm2 日志，便于排查运行时错误。

---

*报告生成后，后端订单接口已做加固（缺列兼容、try/catch），前端 502 时会显示“服务器暂时不可用(502)，请稍后重试或检查后端服务是否已启动”。*
