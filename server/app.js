/**
 * TaskMall 平台 - Express 主入口
 * 采用标准 MVC 架构，物理隔离前后端
 */
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const { getDb } = require('./db');

// 创建 Express 应用
const app = express();

// 信任代理（保证 req.ip / X-Forwarded-For 正确）
app.set('trust proxy', 1);

// ==================== 中间件配置 ====================
// 安全头
app.use(helmet({
  contentSecurityPolicy: false // PWA 需要
}));

// CORS（允许前端跨域）
app.use(cors({
  origin: true,
  credentials: true
}));

// JSON 解析
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 静态文件服务（public 目录）
app.use('/public', express.static(path.join(__dirname, '../public')));

// 请求日志（开发环境）
if (config.env === 'development') {
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });
}

// 注入数据库连接到请求对象
app.use((req, res, next) => {
  req.db = getDb();
  next();
});

// ==========================================
// 公共配置接口 (Public Config)
// ==========================================
app.get('/api/config', (req, res) => {
    const db = require('./db').getDb();
    try {
        // 只读取必要的公开字段，不暴露敏感信息
        const keys = ['announcement', 'service_url', 'withdraw_open', 'withdraw_fee', 'withdraw_min', 'withdraw_max', 'withdraw_fee_type', 'withdraw_fee_value', 'about_us', 'invitation_rule', 'vip_rule', 'faq', 'deposit_address', 'deposit_channels', 'deposit_min_amount', 'deposit_require_hash_or_screenshot', 'deposit_tips', 'deposit_maintenance', 'deposit_daily_limit', 'withdraw_channels', 'withdraw_tips', 'withdraw_maintenance', 'withdraw_daily_count_limit', 'withdraw_daily_amount_limit', 'home_banner_1', 'home_banner_2', 'home_banner_3'];
        const settings = db.prepare(`SELECT key, value FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`).all(...keys);
        
        const config = {};
        settings.forEach(s => config[s.key] = s.value);
        
        // 兜底默认值
        if (!config.service_url) config.service_url = '#';
        if (!config.announcement) config.announcement = 'Welcome!';
        if (!config.deposit_address) config.deposit_address = 'T9yD14Nj9j7xAB4dbGeiX9h8UpjqGXX7Az';
        
        res.setHeader('Cache-Control', 'public, max-age=60');
        res.json({ success: true, data: config });
    } catch (err) {
        console.error('Config Error:', err);
        res.json({ success: true, data: { announcement: 'System Error', service_url: '#' } });
    }
});

// ==================== API 路由 ====================
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');
const agentRoutes = require('./routes/agent');
const taskRoutes = require('./routes/task');
const financeRoutes = require('./routes/finance');

app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/task', taskRoutes);
app.use('/api/finance', financeRoutes);

// === 任务大厅路由 ===
app.get('/grab', (req, res) => {
  // 渲染新的 grab.html
  res.sendFile(path.join(__dirname, '../views/user/grab.html'));
});

// Download App (PWA 引导页)
app.get('/download.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/user/download.html'));
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
      env: config.env
    }
  });
});

// ==================== 错误处理 ====================
// 404 处理
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'API endpoint not found'
  });
});

// 全局错误处理
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err);
  
  res.status(err.status || 500).json({
    success: false,
    error: config.env === 'production' 
      ? 'Internal Server Error' 
      : err.message
  });
});

// ==================== 初始化默认规则文案 ====================
function initDefaultRules() {
  const db = require('./db').getDb();
  
  // 1. 定义专业文案 (支持 HTML 换行)
  const defaults = {
    // 邀请规则 (三级分销模型)
    invitation_rule: `
        <div style="line-height:1.6; color:#4a5568;">
            <h4 style="color:#2d3748; margin-bottom:10px;">🤝 Share & Earn Program</h4>
            <p>Invite friends to join TaskMall and earn passive income daily! We offer a generous 3-tier referral reward system:</p>
            <ul style="margin:15px 0; padding-left:20px;">
                <li><strong>Level 1 (Direct):</strong> Earn <span style="color:#e53e3e;">16%</span> of their daily income.</li>
                <li><strong>Level 2 (Indirect):</strong> Earn <span style="color:#e53e3e;">8%</span> of their daily income.</li>
                <li><strong>Level 3 (Team):</strong> Earn <span style="color:#e53e3e;">4%</span> of their daily income.</li>
            </ul>
            <p style="font-size:12px; color:#718096;">*Rewards are calculated and settled automatically at 00:00 system time every day.</p>
        </div>`,

    // VIP 规则 (等级体系)
    vip_rule: `
        <div style="line-height:1.6; color:#4a5568;">
            <h4 style="color:#2d3748; margin-bottom:10px;">👑 VIP Membership Levels</h4>
            <p>Upgrade your VIP level to unlock higher commission rates and more daily orders.</p>
            <div style="overflow-x:auto; margin-top:15px;">
                <table style="width:100%; border-collapse:collapse; font-size:13px; text-align:center;">
                    <tr style="background:#edf2f7; color:#2d3748;">
                        <th style="padding:8px;">Level</th>
                        <th style="padding:8px;">Balance</th>
                        <th style="padding:8px;">Rate</th>
                        <th style="padding:8px;">Orders</th>
                    </tr>
                    <tr style="border-bottom:1px solid #eee;"><td>VIP 1</td><td>0+ U</td><td>0.5%</td><td>40</td></tr>
                    <tr style="border-bottom:1px solid #eee;"><td>VIP 2</td><td>100+ U</td><td>1.0%</td><td>45</td></tr>
                    <tr style="border-bottom:1px solid #eee;"><td>VIP 3</td><td>500+ U</td><td>1.5%</td><td>50</td></tr>
                    <tr style="border-bottom:1px solid #eee;"><td>VIP 4</td><td>2000+ U</td><td>2.0%</td><td>55</td></tr>
                    <tr style="border-bottom:1px solid #eee;"><td>VIP 5</td><td>10000+ U</td><td>2.5%</td><td>60</td></tr>
                </table>
            </div>
            <p style="margin-top:15px; font-size:12px;"><strong>Auto Upgrade:</strong> The system will automatically upgrade your level when your account balance meets the requirements.</p>
        </div>`,

    // FAQ (常见问题)
    faq: `
        <div style="line-height:1.6; color:#4a5568;">
            <h4 style="color:#2d3748; margin-bottom:15px;">❓ Frequently Asked Questions</h4>
            
            <div style="margin-bottom:15px;">
                <strong style="color:#3182ce;">Q: How do I deposit?</strong>
                <p style="margin-top:5px; font-size:13px;">A: Go to the "Deposit" page, copy the official TRC20 address, and transfer USDT from your crypto wallet. It usually arrives within 5-10 minutes.</p>
            </div>

            <div style="margin-bottom:15px;">
                <strong style="color:#3182ce;">Q: What is the minimum withdrawal?</strong>
                <p style="margin-top:5px; font-size:13px;">A: The minimum withdrawal amount is <strong>10 USDT</strong>. Transfers are processed 24/7.</p>
            </div>

            <div style="margin-bottom:15px;">
                <strong style="color:#3182ce;">Q: Why is my order frozen?</strong>
                <p style="margin-top:5px; font-size:13px;">A: This may happen if you trigger a "Combo Order" or have network issues. Please contact our 24/7 Online Support to resolve it immediately.</p>
            </div>
        </div>`
  };

  // 2. 写入数据库 (如果不存在才写入)
  try {
    const check = db.prepare('SELECT value FROM settings WHERE key = ?');
    const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    const update = db.prepare('UPDATE settings SET value = ? WHERE key = ? AND (value IS NULL OR value = "")');

    for (const [key, content] of Object.entries(defaults)) {
      // 尝试插入（如果key不存在）
      insert.run(key, content);
      // 尝试更新（如果key存在但内容为空）
      update.run(content, key);
    }
    console.log("✅ Default rules populated successfully.");
  } catch (e) {
    console.error("Failed to init rules:", e);
  }
}

// 执行初始化
initDefaultRules();

// === 强制更新规则文案 (Force Update English Content) ===
function forceUpdateContent() {
    const db = require('./db').getDb();
    
    // 1. 邀请规则 (Invitation Rules)
    const inviteContent = `
        <div style="padding:10px;">
            <h3 style="color:#2563eb; font-weight:bold; margin-bottom:10px;">🤝 Global Partner Program</h3>
            <p style="color:#4b5563; font-size:13px; margin-bottom:15px;">Invite friends to join and earn passive income. We offer a 3-tier commission structure:</p>
            <div style="background:#eff6ff; padding:15px; border-radius:8px; margin-bottom:15px;">
                <p style="margin:5px 0;"><strong>Tier 1 (Direct):</strong> <span style="color:#2563eb;">16%</span> Commission</p>
                <p style="margin:5px 0;"><strong>Tier 2 (Indirect):</strong> <span style="color:#2563eb;">8%</span> Commission</p>
                <p style="margin:5px 0;"><strong>Tier 3 (Team):</strong> <span style="color:#2563eb;">4%</span> Commission</p>
            </div>
            <p style="font-size:12px; color:#9ca3af;">* Rewards are settled daily at 00:00.</p>
        </div>`;

    // 2. VIP 规则 (VIP Rules)
    const vipContent = `
        <div style="padding:10px;">
            <h3 style="color:#d97706; font-weight:bold; margin-bottom:10px;">👑 VIP Levels</h3>
            <p style="color:#4b5563; font-size:13px; margin-bottom:15px;">Higher levels unlock higher income rates.</p>
            <table style="width:100%; font-size:13px; text-align:center; border-collapse:collapse;">
                <tr style="background:#f3f4f6; color:#374151;">
                    <th style="padding:8px; border:1px solid #e5e7eb;">Level</th>
                    <th style="padding:8px; border:1px solid #e5e7eb;">Balance</th>
                    <th style="padding:8px; border:1px solid #e5e7eb;">Rate</th>
                </tr>
                <tr><td style="padding:8px; border:1px solid #e5e7eb;">VIP 1</td><td>0+</td><td>0.5%</td></tr>
                <tr><td style="padding:8px; border:1px solid #e5e7eb;">VIP 2</td><td>100+</td><td>1.0%</td></tr>
                <tr><td style="padding:8px; border:1px solid #e5e7eb;">VIP 3</td><td>500+</td><td>1.5%</td></tr>
                <tr><td style="padding:8px; border:1px solid #e5e7eb;">VIP 4</td><td>2000+</td><td>2.0%</td></tr>
                <tr><td style="padding:8px; border:1px solid #e5e7eb;">VIP 5</td><td>10000+</td><td>2.5%</td></tr>
            </table>
        </div>`;

    // 3. FAQ
    const faqContent = `
        <div style="padding:10px;">
            <div style="margin-bottom:20px;">
                <h4 style="font-weight:bold; color:#1f2937;">Q: How do I deposit?</h4>
                <p style="color:#6b7280; font-size:13px; margin-top:5px;">A: Click "Deposit", copy the TRC20 address, and transfer USDT. Arrives in 5-10 mins.</p>
            </div>
            <div style="margin-bottom:20px;">
                <h4 style="font-weight:bold; color:#1f2937;">Q: Minimum withdrawal?</h4>
                <p style="color:#6b7280; font-size:13px; margin-top:5px;">A: The minimum amount is <strong>10 USDT</strong>.</p>
            </div>
            <div>
                <h4 style="font-weight:bold; color:#1f2937;">Q: Is it safe?</h4>
                <p style="color:#6b7280; font-size:13px; margin-top:5px;">A: Yes, principal and commission are returned immediately after order submission.</p>
            </div>
        </div>`;

    try {
        const stmt = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
        stmt.run('invitation_rule', inviteContent);
        stmt.run('vip_rule', vipContent);
        stmt.run('faq', faqContent);
        console.log("✅ PERFECT ENGLISH CONTENT INJECTED!");
    } catch (e) {
        console.error("Injection failed:", e);
    }
}

forceUpdateContent();

// ==================== 启动服务器 ====================
// 生产环境检查 JWT_SECRET
if (config.env === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'default-secret-change-in-production')) {
  console.warn('⚠️  WARNING: JWT_SECRET 未设置或使用默认值，生产环境请设置环境变量 JWT_SECRET');
}

const server = app.listen(config.port, () => {
  console.log('');
  console.log('🚀 TaskMall Platform Server Started');
  console.log('━'.repeat(50));
  console.log(`📡 Server: http://localhost:${config.port}`);
  console.log(`🌍 Environment: ${config.env}`);
  console.log(`💾 Database: ${config.database.path}`);
  console.log('━'.repeat(50));
  console.log('');
});

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('SIGTERM 信号接收，正在关闭服务器...');
  server.close(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
});

module.exports = app;
