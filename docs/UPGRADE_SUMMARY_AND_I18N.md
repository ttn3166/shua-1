# TaskMall 用户端升级总结与多语言待处理清单

本文档汇总本次所有功能/体验升级，并列出**需要交给语言（多语言/翻译）负责人**处理的页面与文案，便于统一翻译与语感贯通。

---

## 一、升级总览（未新增独立页面，均为既有页面增强）

本次**没有新增独立页面**，仅在以下既有页面上做了增加与修改。

### 1. 后端

| 文件 | 变更说明 |
|------|----------|
| `server/routes/task.js` | match 接口返回增加 `product_title`、`product_image`（与现有字段并存） |
| `server/routes/user.js` | GET `/api/user/me` 返回增加 `pending_orders_count`（待处理订单数） |

### 2. 用户端页面（按功能模块）

#### 抢单与订单流程
| 页面 | 路径 | 变更摘要 |
|------|------|----------|
| **抢单页** | `views/user/grab.html` | 有未完成订单时 Toast 带「Go to History」链接；确认弹窗：当前余额/本单需扣、商品图、订单号复制、余额不足禁用 Confirm；Cancel 时 Toast「Order saved. You can complete it under History → Pending.»；confirm 失败且余额不足时专用提示；防重复抢单；点击遮罩/Esc 关闭弹窗；未登录时主内容不闪显（auth-pending） |
| **订单历史** | `views/user/history.html` | 支持 URL `?tab=pending` 等自动切 Tab；待处理订单角标（History 导航）；未登录时列表区不闪显（auth-pending） |

#### 首页与导航
| 页面 | 路径 | 变更摘要 |
|------|------|----------|
| **首页** | `views/user/dashboard.html` | 登录/注册后欢迎 Toast（Welcome back! / Account created! Welcome to TaskMall.）；公告无内容或加载失败时清空文案；History 导航待处理订单角标 |
| **个人中心** | `views/user/profile.html` | History 导航待处理订单角标 |

#### 登录与注册
| 页面 | 路径 | 变更摘要 |
|------|------|----------|
| **登录** | `views/user/index.html` | 标签/占位符统一为「Username」；已登录访问时直接跳首页；登录成功跳转带 `?welcome=1` |
| **注册** | `views/user/register.html` | 仅「用户名+密码」文案，增加「Username & password only. No personal info required.»；邀请码可选；已登录访问时直接跳首页；语言入口 🌐 Language；注册成功跳转带 `?registered=1` |

#### 充值/提现与记录
| 页面 | 路径 | 变更摘要 |
|------|------|----------|
| **充值** | `views/user/deposit.html` | 未登录时用 `replace` 跳转登录页 |
| **充值记录** | `views/user/deposit_record.html` | 同上 |
| **提现记录** | `views/user/withdrawal_record.html` | 同上 |
| **邀请** | `views/user/invite.html` | 未登录时 `replace` 跳转登录页；仅在有 token 时执行后续逻辑 |

---

## 二、需要语言贯通的页面与文案清单（发给翻译/多语言负责人）

以下为**本次新增或修改过的、面向用户的英文文案**，建议统一做多语言或翻译，保证语感一致。  
（未改动的页面若已有翻译流程，可继续按原流程处理。）

### 2.1 抢单页 `grab.html`

| 类型 | 位置/场景 | 英文原文（需翻译/多语言） |
|------|-----------|---------------------------|
| 页面标题/副标题 | 顶部 | TaskMall Task Hall — Grab & Earn |
| 标签 | VIP 卡 | Current Level |
| 标签 | 统计区 | Balance / Completed Today |
| 按钮 | 主按钮 | START GRABBING |
| 提示 | 主按钮下 | System Automatic Dispatch |
| 提示 | 须知框 | Important Notice / If you have any questions, please contact online customer service. |
| 导航 | 底部 | Home / History / Start / Service / Profile |
| Toast | 未完成订单 | You have an uncompleted order. Please complete it first. |
| Toast 链接 | 同上 | Go to History |
| Toast | 取消弹窗 | Order saved. You can complete it under History → Pending. |
| Toast | 确认失败-余额不足 | Insufficient balance. Please deposit then complete this order under History → Pending. |
| Toast | 任务完成 | ✅ Task completed! +X.XX USDT commission |
| Toast | 每日完成 | Daily tasks completed! Grab is paused. Admin must re-enable to continue. |
| Toast | 订单号复制 | Order No. copied / Copy failed |
| 弹窗 | 标题/副标题 | 📦 Task Details / Confirm task info before starting |
| 弹窗 | 占位 | No image |
| 弹窗 | 说明 | Task Amount (to deduct) / Current Balance / This order deducts |
| 弹窗 | 余额不足提示 | Insufficient balance. Please deposit first, then complete this order under History → Pending. |
| 弹窗 | 订单号 | Order No. / Copy（按钮） / Copied!（按钮反馈） |
| 弹窗 | 其他 | Product / Unit Price / Quantity / Commission Rate / Estimated Commission / Total Return |
| 弹窗 | 按钮 | Cancel / Confirm |
| 弹窗 | 说明条 | 💡 Complete the order as specified; after confirmation, principal + commission will be returned automatically. |
| 按钮状态 | 确认中 | Processing... |
| 提示 | 关闭/禁用抢单 | Grab is closed. Please contact admin to enable it. / Daily tasks completed. Grab is paused. Contact admin to re-enable. |
| 通用 | 网络/加载 | Network error / Failed to load data |

### 2.2 订单历史 `history.html`

| 类型 | 位置/场景 | 英文原文（需翻译/多语言） |
|------|-----------|---------------------------|
| Tab | 筛选 | All Orders / Pending / Completed / Frozen |
| 空状态 | 无订单 | No Orders Yet / Complete your first task to build your order history |
| 空状态 | 无结果 | No Results / No Pending/Completed/Frozen orders found |
| 空状态按钮 | 引导 | 🚀 Start First Task |
| 订单卡 | 标签 | Order Amount / Commission / Complete Task |
| 加载 | 骨架屏期间 | （若存在 Loading 文案则需统一） |

### 2.3 首页 `dashboard.html`

| 类型 | 位置/场景 | 英文原文（需翻译/多语言） |
|------|-----------|---------------------------|
| 欢迎 | 头部 | Hi! Welcome |
| 公告 | 无内容时 | （已清空，若默认占位有文案需统一） |
| Toast | 登录后 | Welcome back! |
| Toast | 注册后 | Account created! Welcome to TaskMall. |
| 其他 | 提现/商品/邀请等 | （若本次未改可沿用现有翻译） |

### 2.4 登录 `index.html`

| 类型 | 位置/场景 | 英文原文（需翻译/多语言） |
|------|-----------|---------------------------|
| 标题 | 头部 | Welcome Back / Login to your TaskMall account |
| 表单 | 标签/占位 | Username / Enter your username / Enter Password |
| 按钮 | 提交 | Login |
| 底部 | 链接 | No account? Register |
| 语言 | 右上角 | 🌐 Language |

### 2.5 注册 `register.html`

| 类型 | 位置/场景 | 英文原文（需翻译/多语言） |
|------|-----------|---------------------------|
| 标题 | 头部 | Create Account / Join TaskMall, Start Earning Today |
| 隐私说明 | 新增 | Username & password only. No personal info required. |
| 表单 | 标签/占位 | Username / Choose a username / Password / Enter Password / Confirm Password / Invitation Code (Optional) / Enter Invitation Code |
| 邀请提示 | URL 带邀请码时 | ✨ Registering with invite code XXX / Referral will be auto-linked after registration |
| 按钮 | 提交 | Register |
| 底部 | 链接 | Have account? Login |
| 语言 | 右上角 | 🌐 Language |
| 错误/成功 | 校验/接口 | Please enter username and password / Password must be at least 6 characters / Passwords do not match / Registration successful! Redirecting... / (接口返回 error 文案) |

### 2.6 充值/提现/记录/邀请等（本次仅改逻辑，文案多为原有）

若贵方对 **deposit / withdrawal_record / deposit_record / invite** 等页已有翻译规范，可只核对以下**本次可能涉及或常见的**短句是否已纳入多语言：

- Loading... / Failed to load... / No ... records yet. / Network error. Please try again.
- Copy / Copied! / Copy failed
- Address copied! / Invite link copied!

（具体每句所在文件与位置可让开发按「页面 + 控件/Toast」对照上述列表或代码。）

---

## 三、建议给语言负责人的说明（可直接转发）

1. **范围**：本次升级未新增独立页面，只在这些既有页面上增加了功能与文案；上述表格中的「英文原文」均为需要**统一翻译或多语言处理**的字符串，以保证与现有语种、产品用语一致。
2. **优先级**：  
   - 高：登录、注册、抢单弹窗与 Toast、订单历史 Tab 与空状态、首页欢迎 Toast。  
   - 中：抢单页整页标签与提示、History 角标相关（若角标旁有文案）。  
   - 低：通用错误/网络提示、Copy/Copied 等通用操作反馈。
3. **技术说明**：  
   - 当前多为前端硬编码英文；若后续要做多语言，建议将这些字符串抽成 key（或集中到语言文件），由翻译提供各语种文案，开发再接入。  
   - 部分文案来自接口（如 `result.message`），若需多语言，需后端支持按语言返回或由前端按 code 映射到已翻译文案。
4. **语感贯通**：  
   - 「History」「Pending」「Complete Task」「Order saved」「Insufficient balance」等会在抢单、历史、Toast 中重复出现，建议同一概念在各处用同一译法。  
   - 注册/登录的「Username」「Password」及错误提示建议与现有登录/注册翻译风格统一。

---

## 四、涉及文件速查（便于开发与语言对接）

- **后端**：`server/routes/task.js`，`server/routes/user.js`
- **用户端**：  
  `views/user/grab.html`，`views/user/history.html`，`views/user/dashboard.html`，  
  `views/user/profile.html`，`views/user/index.html`，`views/user/register.html`，  
  `views/user/deposit.html`，`views/user/deposit_record.html`，  
  `views/user/withdrawal_record.html`，`views/user/invite.html`

以上为本次升级的完整总结与需要语言贯通的页面/文案清单。如需按「按页面 + 行号」或「按 key」再列一版给翻译的 Excel/表格，可在本清单基础上由开发补充具体位置或 key 名。

---

## 五、用户协议 / 隐私政策 / 风险提示 — 翻译清单（给翻译负责人）

以下三个页面需纳入多语言/翻译。**后台已支持**：运营/法务在「系统 · 规则与内容」中维护 `terms_content`、`privacy_content`、`risk_disclaimer_content`（支持 HTML）。未配置时用户端显示默认英文；翻译后可将各语种 HTML 粘贴到后台对应框保存，或由开发接入多语言 key。

| 页面 | 用户端路径 | 后台配置 key |
|------|------------|---------------|
| Terms of Service（用户协议） | `views/user/terms.html` | `terms_content` |
| Privacy Policy（隐私政策） | `views/user/privacy.html` | `privacy_content` |
| Risk Disclaimer（风险提示） | `views/user/risk_disclaimer.html` | `risk_disclaimer_content` |

### 5.1 每页固定 UI 文案（在 HTML 里，若做多语言需改前端或语言包）

| 页面 | 位置 | 英文原文 |
|------|------|----------|
| 用户协议 | 顶部导航标题 | Terms of Service |
| 用户协议 | 卡片副标题 | User Agreement |
| 隐私政策 | 顶部导航标题 | Privacy Policy |
| 隐私政策 | 卡片副标题 | How we handle your information |
| 风险提示 | 顶部导航标题 | Risk Disclaimer |
| 风险提示 | 卡片副标题 | Please read carefully |

### 5.2 入口处相关文案（与三页一起交给翻译）

| 页面 | 文案 | 英文原文 |
|------|------|----------|
| 注册页 | 同意说明 | By registering you agree to our Terms of Service and Privacy Policy. |
| 登录页 | 页脚链接 | Terms · Privacy |
| 首页页脚 | 链接 | Terms · Privacy · Risk |
| Help Center | 菜单项 | Terms of Service / Privacy Policy / Risk Disclaimer |

### 5.3 正文默认英文（供翻译用）

- **用户协议**：Acceptance / Account / Use of Service / Changes / Contact 等段落（完整英文见 `views/user/terms.html` 内 `DEFAULT_CONTENT`）。
- **隐私政策**：Information We Collect / How We Use It / Security / Your Rights / Updates / Contact 等段落（见 `views/user/privacy.html` 内 `DEFAULT_CONTENT`）。
- **风险提示**：Important 黄框、Task & Balance / Withdrawals / No Guarantee / Compliance / Contact 等段落（见 `views/user/risk_disclaimer.html` 内 `DEFAULT_CONTENT`）。

翻译可：  
(1) 提供各语种 HTML 正文（保留标签），由运营粘贴到后台；或  
(2) 提供纯文案/带 key 的表格，由开发接入多语言并仍从后台读当前语言的 HTML。  
固定文案（如 "Terms of Service"）若要做多语言，需在前端或语言包中增加 key，与正文一起交给翻译。
