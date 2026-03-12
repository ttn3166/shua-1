# 代理后台 · 操作手册

**更新日期**：2026-03-12  
**适用对象**：管理员、代理（业务员）  
**说明**：代理与管理员使用同一套后台界面，代理仅能查看/操作自己团队范围内的数据。

---

## 一、登录链接（请将域名替换为实际访问地址）

假设站点访问地址为：**`https://您的域名`**（或 `http://185.39.31.27` 等实际地址）。

### 1. 管理员登录

| 项目 | 链接/接口 |
|------|-----------|
| **登录页面** | `https://您的域名/views/admin/login.html` |
| **登录接口** | `POST https://您的域名/api/auth/admin/login` |
| **登录后跳转** | `https://您的域名/views/admin/dashboard.html` |

**适用角色**：SuperAdmin、Admin、Finance、Support。

---

### 2. 代理（业务员）登录

| 项目 | 链接/接口 |
|------|-----------|
| **登录页面** | `https://您的域名/views/agent/login.html` |
| **登录接口** | `POST https://您的域名/api/auth/agent/login` |
| **登录后跳转** | 先到代理入口页，再自动跳转到：`https://您的域名/views/admin/dashboard.html?mode=agent` |

**适用角色**：Agent（业务员）。代理进入后看到的是与管理员同款的 dashboard，但菜单与数据会根据权限和“数据范围”做限制。

---

### 3. 链接速查

```
管理员登录页：  /views/admin/login.html
管理员工作台：  /views/admin/dashboard.html

代理登录页：    /views/agent/login.html
代理工作台：    /views/admin/dashboard.html?mode=agent
（代理也可直接收藏上述带 ?mode=agent 的地址，若本地已有 agent_token 会直接进入）
```

---

## 二、登录与访问流程

### 管理员

1. 打开 **管理员登录页**：`/views/admin/login.html`
2. 输入用户名、密码，提交。
3. 请求 `POST /api/auth/admin/login`，成功后前端将 token 存为 `admin_token`（或 `token`），并跳转到 `/views/admin/dashboard.html`。
4. 后续访问 `/api/admin/*` 时请求头带 `Authorization: Bearer <admin_token>`。

### 代理

1. 打开 **代理登录页**：`/views/agent/login.html`
2. 输入用户名、密码，提交。
3. 请求 `POST /api/auth/agent/login`，成功后前端将 token 存为 `agent_token`，并跳转到 `/views/agent/dashboard.html`。
4. 代理入口页会检查本地是否有 `agent_token`（或 `token`）：
   - **有**：自动跳转到 `/views/admin/dashboard.html?mode=agent`
   - **无**：跳回 `/views/agent/login.html`
5. 代理模式下，前端请求 `/api/admin/*` 时使用 `agent_token`，后端按“权限 + 数据范围”返回数据。

---

## 三、代理端能力说明（数据范围 + 权限）

### 数据范围（只看自己团队）

- 所有列表、导出、统计均限制在**该代理的团队/渠道**内。
- 范围判定依据：
  - 主：用户表 `agent_path` 与代理的 `agent_path` 前缀一致；
  - 兜底：用户 `referred_by` = 该代理的邀请码 `invite_code`。
- 代理**不能**查看或操作范围外的用户、订单、提现、充值、流水等。

### 权限（默认无权限，由管理员下放）

- 权限 key 格式：`admin.<模块>.<动作>`  
  - 动作：`view`（查看）、`edit`（新增/修改）、`delete`（删除）。
- 未配置任何权限时，代理访问后台接口会得到 **403 无此权限**。
- 管理员在“业务员管理”中为代理配置 `agent_permissions`（JSON 数组），例如：

```json
[
  "admin.users.view",
  "admin.user-detail.view",
  "admin.orders.view",
  "admin.transactions.view",
  "admin.withdrawals.view",
  "admin.deposits.view",
  "admin.reports.view",
  "admin.dataScreen.view"
]
```

- 若需允许代理对**自己团队内**用户进行派单、编辑、重置密码、调账等，需额外授予对应 `admin.*.edit` 等权限（具体见权限字典）。

### 代理不能做的事（无论是否给权限）

- 访问管理员列表、业务员管理、做单账户创建、批量审批（提现/充值）、操作审计日志等接口会直接返回 **403**。
- 不能查看或操作自己数据范围以外的用户/订单/财务数据。

---

## 四、常见操作步骤（代理视角）

### 1. 登录并进入工作台

1. 在浏览器打开：`https://您的域名/views/agent/login.html`
2. 输入代理账号、密码，点击登录。
3. 登录成功后会自动打开与管理员同款的工作台（带 `?mode=agent`），左侧为菜单。

### 2. 查看会员列表

- 需具备权限：`admin.users.view`
- 入口：工作台左侧菜单“会员管理”等（名称以实际前端为准）。
- 列表中仅显示**自己团队内**的会员；搜索、筛选、导出（若开放）也仅限范围内数据。

### 3. 查看会员详情 / 订单 / 流水

- 需具备权限：`admin.user-detail.view`、`admin.orders.view`、`admin.transactions.view` 等。
- 仅能点击进入**自己团队内**用户的详情、订单、流水；若尝试访问范围外用户会得到 403。

### 4. 派单、编辑用户、调账等（若已授权）

- 需管理员为代理配置相应 `admin.users.edit` 等权限。
- 仅能对自己**数据范围内**的用户进行派单、编辑、重置密码、调账等；范围外操作会返回 403。

### 5. 查看财务（提现/充值）列表

- 需具备权限：`admin.withdrawals.view`、`admin.deposits.view`
- 列表与导出仅包含**自己团队内**用户的提现/充值记录。
- 若具备 `admin.withdrawals.edit` / `admin.deposits.edit`，可对范围内单条记录进行审核；**批量审批**对代理不开放（接口 403）。

### 6. 退出 / 重新登录

- 退出后本地 `agent_token` 会被清除，再次访问工作台会跳回代理登录页。
- 重新登录仍使用：`https://您的域名/views/agent/login.html`。

---

## 五、管理员侧：为代理配置权限与范围

### 1. 创建/管理代理账号

- 使用**管理员**账号登录：`/views/admin/login.html`
- 在“业务员管理”（或“代理管理”）中创建代理账号，并设置其 **agent_permissions**（JSON 数组），例如上文第三节中的示例。

### 3. 数据范围（agent_path / 邀请码）

- 代理的“数据范围”由后端根据其 `agent_path` 与 `invite_code` 自动计算。
- 新建代理时系统会为其生成邀请码并维护 `agent_path`；其团队用户通常通过“推荐关系”或后台指定 `agent_path` 归属到该代理。
- 无需在操作手册中单独配置范围，只要保证用户数据（`agent_path` / `referred_by`）正确归属即可。

### 4. 建议给的权限（仅查看）

- 仅查看团队数据时，建议勾选或写入：  
  `admin.users.view`、`admin.user-detail.view`、`admin.orders.view`、`admin.transactions.view`、`admin.withdrawals.view`、`admin.deposits.view`、`admin.reports.view`、`admin.dataScreen.view`  
- 若需代理在团队内进行派单、编辑、调账等，再按需增加对应 `admin.*.edit`（注意风险，仅限团队内）。

---

## 六、异常与排查

| 现象 | 可能原因 | 建议 |
|------|----------|------|
| 登录后一直跳回登录页 | token 未写入或已失效 | 清除站点该域名下 localStorage 后重新登录；确认登录接口返回了 token |
| 打开工作台提示 403 或无权限 | 该代理未配置对应权限 | 管理员在业务员管理中为其添加相应 `admin.<模块>.view` 等权限 |
| 列表为空但应有数据 | 数据不在该代理范围内 | 确认用户的 `agent_path` / `referred_by` 是否归属该代理 |
| 点击某用户/订单提示 403 | 该用户/订单不在代理范围内 | 仅能查看和操作自己团队内数据，属正常限制 |
| 批量审批/管理员列表等点不了或 403 | 代理不允许访问这些功能 | 属设计如此，仅管理员可用 |

---

## 七、接口与链接汇总表

| 用途 | 方法 | 路径/链接 |
|------|------|-----------|
| 管理员登录 | POST | `/api/auth/admin/login` |
| 代理登录 | POST | `/api/auth/agent/login` |
| 管理员登录页 | - | `/views/admin/login.html` |
| 管理员工作台 | - | `/views/admin/dashboard.html` |
| 代理登录页 | - | `/views/agent/login.html` |
| 代理工作台（同款 UI） | - | `/views/admin/dashboard.html?mode=agent` |
| 后台 API 基础路径 | - | `/api/admin/*`（请求头需带 `Authorization: Bearer <token>`） |

---

**说明**：实际部署时请将文档中“您的域名”替换为真实访问地址（如 `https://admin.example.com` 或 `http://185.39.31.27`），再下发或打印给使用人员。
