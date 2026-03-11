# 用户端多语言说明

## 当前状态（谷歌挂件已移除）

- **谷歌翻译挂件已完全移除**，不再加载任何 Google 翻译脚本或使用 `googtrans` cookie。
- 各页面仍保留「Language」入口按钮/链接，点击时调用 `window.showLanguage`（当前为空函数占位）。
- **后续可接入**：i18next / Vue-i18n 等，接入后只需实现 `showLanguage` 及语言切换逻辑即可。

---

## 页面清单

| 页面 | common.js | 语言入口（选语言按钮/链接） |
|------|-----------|----------------------------|
| index.html（登录） | ✅ | ✅ 右上角「🌐 Language」 |
| register.html（注册） | ✅ | ✅ 右上角「🌐 Language」 |
| dashboard.html（首页） | ✅ | ✅ 顶部右侧地球图标 |
| profile.html（个人中心） | ✅ | ✅ 侧边菜单「Language」 |
| deposit.html（充值） | ✅ | ✅ 头部右侧地球图标 |
| grab.html（任务大厅） | ✅ | 底部导航进入，语言沿用 cookie |
| invite.html（邀请） | ✅ | 有返回按钮，语言沿用 cookie |
| history.html（订单历史） | ✅ | 有底部导航，语言沿用 cookie |
| bind_wallet.html（绑定钱包） | ✅ | 有头部返回，语言沿用 cookie |
| invitation_rules.html（邀请规则） | ✅ | 语言沿用 cookie |
| set_security_password.html（安全密码） | ✅ | 语言沿用 cookie |
| change_password.html（修改密码） | ✅ | 语言沿用 cookie |
| faq.html（常见问题） | ✅ | 语言沿用 cookie |
| about.html（关于） | ✅ | 语言沿用 cookie |
| vip_rule.html（VIP 规则） | ✅ | 语言沿用 cookie |
| download.html（下载） | ✅ | 语言沿用 cookie |
| deposit_record.html（充值记录） | ✅ | ✅ 头部右侧地球图标 |
| withdrawal_record.html（提现记录） | ✅ | ✅ 头部右侧地球图标 |
| terms.html（用户协议） | ✅ | ✅ 顶部右侧地球图标 |
| privacy.html（隐私政策） | ✅ | ✅ 顶部右侧地球图标 |
| risk_disclaimer.html（风险提示） | ✅ | ✅ 顶部右侧地球图标 |

---

## 说明

- **有语言入口的页面**：index、register、dashboard、profile、deposit、deposit_record、withdrawal_record、terms、privacy、risk_disclaimer，用户可在该页直接点击切换语言。
- **无单独语言按钮的页面**：从首页/个人中心/登录页选好语言后，再进入这些页面会保持已选语言并整页翻译。
- **提款**：在 dashboard / profile 内为弹窗，弹窗 HTML 已预置在页面中，会随整页一起被翻译。

---

## 新增页面检查清单（翻译相关）

新增用户端页面时，按下面做即可与现有页面一致（自动参与整站翻译、隐藏谷歌栏、返回不丢语言）：

1. **引入 common.js**（放在 `<head>` 或 `</body>` 前均可）  
   ```html
   <script src="/public/js/common.js"></script>
   ```
2. **若有顶部栏（返回 + 标题）**，建议加语言入口，二选一即可：  
   - 头部右侧地球图标（与 deposit / deposit_record 一致）：  
     - HTML：在 header 里标题后加一个 `id="headerLangBtn"` 的 div，内放地球 SVG，样式用 `margin-left:auto` 靠右。  
     - JS：在页面脚本末尾加：  
       `var lb = document.getElementById('headerLangBtn'); if (lb && typeof window.showLanguage === 'function') lb.addEventListener('click', function () { window.showLanguage(); });`  
   - 或文字链接（与 index / register 一致）：  
     `<a href="javascript:void(0)" onclick="typeof showLanguage==='function'&&showLanguage();return false;">🌐 Language</a>`

做完以上，新页面会自动：跟随 `googtrans` cookie 翻译、隐藏谷歌顶部栏、返回时通过 pageshow 刷新保持语言。

结论：**谷歌挂件已去除干净；多语言待接入 i18next / Vue-i18n 后由新逻辑接管。**
