# 全站后端功能检查报告

检查时间：按当前代码静态检查  
范围：`/server` 下入口、路由、中间件、数据库与配置。

---

## 一、整体架构

| 模块 | 挂载路径 | 说明 |
|------|----------|------|
| 认证 | `/api/auth` | 用户/管理员/代理登录、注册、登出 |
| 用户 | `/api/user` | C 端用户信息、团队、邀请、余额、抢单开关等 |
| 管理 | `/api/admin` | 统计、用户/商品/VIP/财务/设置等 |
| 代理 | `/api/agent` | 代理统计、团队列表 |
| 任务 | `/api/task` | 抢单 match/confirm、submit、派单等 |
| 财务 | `/api/finance` | 充值/提现申请、截图上传、记录查询 |

- 入口：`app.js` 统一挂载路由，注入 `req.db = getDb()`，JSON 解析、CORS、静态资源已配置。
- 认证：`middleware/auth.js` 支持 Header Bearer 与 Cookie `token`，`utils/jwt.js` 与 `config.jwt` 一致。
- 响应：`utils/response.js` 统一 `success`/`error`，管理员 500 使用 `message`，与前端 `data.message || data.error` 兼容。

---

## 二、已检查并正常的模块

### 1. 认证 (auth.js)

- `POST /register`：参数校验、重复用户名、推荐人/邀请码、写 users/referral_rewards、发 Token/Cookie。
- `POST /login`：限流、状态 banned/account_lock_status、密码校验、Token/Cookie。
- `POST /admin/login`：角色 in (SuperAdmin,Admin,Finance,Support)、login_logs。
- `POST /agent/login`：限流、Agent 角色。
- `POST /logout`：authenticate、清 Cookie、写登出日志。

### 2. 财务 (finance.js)

- `POST /upload-screenshot`：multer 存 `public/uploads/deposits/`，返回 url，错误处理与 5MB 限制。
- `POST /deposit`：配置校验、最低金额、哈希/截图二选一、单日限额、写 deposits。
- `GET /deposits`：分页、仅当前用户。
- `POST /withdrawal`：开关/维护、余额/资金密码/单日次数与金额、扣款+写 withdrawals+ledger。
- `GET /withdrawals`：当前用户列表。

### 3. 管理 - 财务审批 (admin.js)

- `GET /withdrawals`、`GET /deposits`：分页、pending_count、JOIN users 返回 username。
- **已修复**：`POST /withdrawals/:id/review` 在「通过」时不再检查「当前余额 ≥ 提现金额」（提交时已扣款，此处仅更新状态与记流水），避免误报「用户余额不足」。

### 4. 任务 (task.js)

- match：pending 订单检查、allow_grab/余额/每日上限、派单与随机金额、vip_levels（task_limit/daily_orders 已由 admin 迁移兼容）、match_token 缓存。
- confirm：token 校验、扣款与返还、订单与流水、连环单逻辑。
- submit：兼容 match/start/legacy 等 source。

### 5. 代理 (agent.js)

- `GET /stats`：按 agent_path 统计团队人数、今日充值/提现、总余额，使用 `req.db`。
- `GET /team`：团队成员列表，LIMIT 500。

### 6. 数据库 (db.js)

- 表结构：users、orders、deposits、withdrawals、ledger、products、vip_levels、login_logs 等与路由使用一致。
- ledger：含 order_no（可选），admin 审批写入 reason/created_by 无问题。
- 迁移：deposits/withdrawals 的 channel_id、login_logs.action、vip_levels 的 level/task_limit 已兼容。

### 7. 配置与安全

- `config.js`：port、env、jwt、database、admin 初始账号。
- `app.js`：生产环境 JWT_SECRET 警告、404/全局错误处理。
- 管理端：`checkAdmin` 校验 ADMIN_ROLES，401 返回 JSON。

---

## 三、已修复问题

1. **提现审批通过误判「用户余额不足」**  
   - 原因：提交提现时已扣款，审批通过时不应再要求「当前余额 ≥ 提现金额」。  
   - 处理：在 `POST /withdrawals/:id/review` 的 approve 分支中移除余额检查，仅更新状态并记流水。

---

## 四、建议与注意事项

1. **生产环境**：务必设置 `JWT_SECRET`、`NODE_ENV=production`，必要时配置 `DB_PATH`。
2. **管理员 401**：前端已通过 `fetchAPI` 解析 `data.message || data.error` 展示，审批失败会显示后端返回的文案。
3. **上传目录**：`public/uploads/deposits/` 需可写；若使用 Nginx 反向代理，需能访问 `/public` 静态资源。
4. **限流**：仅 auth 的 login/register/agent/login 使用 rateLimit；其余接口未做限流，可按需在 app 或路由层增加。
5. **日志**：关键错误已 `console.error`，可按需接入日志文件或监控。

---

## 五、接口清单（便于联调/测试）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/config | 公开配置 |
| GET | /api/health | 健康检查 |
| POST | /api/auth/register | 用户注册 |
| POST | /api/auth/login | 用户登录 |
| POST | /api/auth/admin/login | 管理员登录 |
| POST | /api/auth/agent/login | 代理登录 |
| POST | /api/auth/logout | 登出（需 Token） |
| POST | /api/finance/upload-screenshot | 上传充值截图（需 Token） |
| POST | /api/finance/deposit | 提交充值（需 Token） |
| GET | /api/finance/deposits | 我的充值记录（需 Token） |
| POST | /api/finance/withdrawal | 提交提现（需 Token） |
| GET | /api/finance/withdrawals | 我的提现记录（需 Token） |
| GET | /api/admin/withdrawals | 管理-提现列表（需 Admin Token） |
| POST | /api/admin/withdrawals/:id/review | 管理-提现审批（需 Admin Token） |
| GET | /api/admin/deposits | 管理-充值列表（需 Admin Token） |
| POST | /api/admin/deposits/:id/review | 管理-充值审批（需 Admin Token） |

其余 user、task、admin 其它接口见对应路由文件。

---

**结论**：全站后端逻辑与数据流已检查；提现审批通过时的余额校验已修正，其余模块未发现阻塞性错误。建议在测试环境跑一遍登录→充值/提现→审批流程做回归验证。
