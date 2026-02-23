# 用户端谷歌翻译应用情况

## 检查结果：全部已应用

所有 **16 个** 用户端页面均已引入 `/public/js/common.js`，因此：
- 页面加载时会根据 `googtrans` cookie 自动应用已选语言（越南语、英语等）
- 语言选择在整站生效（cookie path=/），从任意页跳转到其他页都会保持当前语言

---

## 页面清单

| 页面 | common.js | 语言入口（选语言按钮/链接） |
|------|-----------|----------------------------|
| index.html（登录） | ✅ | ✅ 右上角「🌐 Language」 |
| register.html（注册） | ✅ | 无（从登录页选语言后进入即可） |
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

---

## 说明

- **有语言入口的页面**：index、dashboard、profile、deposit，用户可在该页直接点击切换语言。
- **无单独语言按钮的页面**：从首页/个人中心/登录页选好语言后，再进入这些页面会保持已选语言并整页翻译。
- **提款**：在 dashboard / profile 内为弹窗，弹窗 HTML 已预置在页面中，会随整页一起被翻译。

结论：**所有用户端页面都已应用谷歌翻译逻辑，无需再改。**
