const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db');
const { verifyToken } = require('../utils/jwt');
const { error } = require('../utils/response');
const multer = require('multer');
const XLSX = require('xlsx');
const JSZip = require('jszip');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

const bannerUploadDir = path.join(__dirname, '../../public/uploads/banners');
const productUploadDir = path.join(__dirname, '../../public/uploads/products');
try { fs.mkdirSync(bannerUploadDir, { recursive: true }); } catch (e) {}
try { fs.mkdirSync(productUploadDir, { recursive: true }); } catch (e) {}
const bannerUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, bannerUploadDir),
        filename: (req, file, cb) => cb(null, 'banner_' + Date.now() + path.extname(file.originalname || '.jpg').toLowerCase())
    }),
    limits: { fileSize: 2 * 1024 * 1024 } // 2MB
});

const productImageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 } // 2MB
});

const ADMIN_ROLES = ['SuperAdmin', 'Admin', 'Finance', 'Support'];

const checkAdmin = (req, res, next) => {
    const auth = req.headers['authorization'];
    if (!auth) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
    const decoded = verifyToken(token);
    if (!decoded || !ADMIN_ROLES.includes(decoded.role)) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    req.user = decoded;
    next();
};

// ==========================================
// 数据库初始化：VIP等级表 & 系统参数
// ==========================================
try {
    const db = getDb();
    
    // 1. 创建 vip_levels 表
    db.prepare(`
        CREATE TABLE IF NOT EXISTS vip_levels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            level_order INTEGER NOT NULL UNIQUE,
            commission_rate REAL NOT NULL,
            daily_orders INTEGER NOT NULL,
            min_balance REAL NOT NULL DEFAULT 0,
            description TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();
    console.log("✅ vip_levels 表已就绪");
    
    // 2. 初始化默认 VIP 等级数据（如果为空）
    const vipCount = db.prepare('SELECT COUNT(*) as count FROM vip_levels').get();
    if (vipCount.count === 0) {
        const defaultLevels = [
            { name: 'VIP 1', level_order: 1, commission_rate: 0.005, daily_orders: 40, min_balance: 0, description: '新手会员' },
            { name: 'VIP 2', level_order: 2, commission_rate: 0.010, daily_orders: 45, min_balance: 100, description: '进阶会员' },
            { name: 'VIP 3', level_order: 3, commission_rate: 0.015, daily_orders: 50, min_balance: 500, description: '高级会员' },
            { name: 'VIP 4', level_order: 4, commission_rate: 0.020, daily_orders: 55, min_balance: 2000, description: '白金会员' },
            { name: 'VIP 5', level_order: 5, commission_rate: 0.025, daily_orders: 60, min_balance: 10000, description: '钻石会员' }
        ];
        
        const insertStmt = db.prepare(`
            INSERT INTO vip_levels (name, level_order, commission_rate, daily_orders, min_balance, description)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        
        defaultLevels.forEach(level => {
            insertStmt.run(level.name, level.level_order, level.commission_rate, level.daily_orders, level.min_balance, level.description);
        });
        console.log("✅ 已初始化默认 VIP 等级 (5个等级)");
    }
    // 2.5 vip_levels 兼容：确保 level、task_limit 存在（供 task.js 使用）
    const vipCols = db.prepare("PRAGMA table_info(vip_levels)").all().map(c => c.name);
    if (!vipCols.includes('level')) {
        db.prepare("ALTER TABLE vip_levels ADD COLUMN level INTEGER").run();
        db.prepare("UPDATE vip_levels SET level = level_order WHERE level IS NULL").run();
        console.log("✅ vip_levels 已添加 level 列");
    }
    if (!vipCols.includes('task_limit')) {
        db.prepare("ALTER TABLE vip_levels ADD COLUMN task_limit INTEGER").run();
        db.prepare("UPDATE vip_levels SET task_limit = daily_orders WHERE task_limit IS NULL").run();
        console.log("✅ vip_levels 已添加 task_limit 列");
    }
    
    // 3. 初始化系统参数：匹配比例
    const matchMinExists = db.prepare("SELECT value FROM settings WHERE key = 'match_min_ratio'").get();
    if (!matchMinExists) {
        db.prepare("INSERT INTO settings (key, value, description) VALUES (?, ?, ?)").run(
            'match_min_ratio',
            '0.1',
            '订单匹配最小比例'
        );
        console.log("✅ 初始化 match_min_ratio = 0.1");
    }
    
    const matchMaxExists = db.prepare("SELECT value FROM settings WHERE key = 'match_max_ratio'").get();
    if (!matchMaxExists) {
        db.prepare("INSERT INTO settings (key, value, description) VALUES (?, ?, ?)").run(
            'match_max_ratio',
            '0.7',
            '订单匹配最大比例'
        );
        console.log("✅ 初始化 match_max_ratio = 0.7");
    }
    
    // 4. 初始化系统基础配置
    const systemConfigs = [
        { key: 'service_url', value: '#', description: '客服链接' },
        { key: 'announcement', value: 'Welcome to TaskMall! Your trusted platform for task management.', description: '系统公告' },
        { key: 'withdraw_open', value: '1', description: '提现开关 (1=开启, 0=关闭)' },
        { key: 'withdraw_fee', value: '2', description: '提现手续费 (百分比)' },
        { key: 'withdraw_min', value: '10', description: '最低提现金额 (USDT)' }
    ];
    
    systemConfigs.forEach(config => {
        const exists = db.prepare("SELECT value FROM settings WHERE key = ?").get(config.key);
        if (!exists) {
            db.prepare("INSERT INTO settings (key, value, description) VALUES (?, ?, ?)").run(
                config.key, config.value, config.description
            );
            console.log(`✅ 初始化 ${config.key} = ${config.value}`);
        }
    });
} catch (e) {
    console.error("❌ VIP等级表初始化失败:", e);
}

// ==========================================
// 1. 仪表盘统计（增强容错）
// ==========================================
router.get('/stats', checkAdmin, (req, res) => {
    const db = getDb();
    
    try {
        let userCount = 0;
        let systemBalance = 0;
        let pendingWithdrawals = 0;
        let todayProfit = 0;

        // 1. 获取用户总数（安全查询）
        try {
            const result = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'User'").get();
            userCount = result ? result.count : 0;
        } catch (err) {
            console.error('查询用户总数失败:', err.message);
        }

        // 2. 获取系统总余额（安全查询）
        try {
            const result = db.prepare("SELECT SUM(balance) as total FROM users WHERE role = 'User'").get();
            systemBalance = result && result.total ? result.total : 0;
        } catch (err) {
            console.error('查询系统余额失败:', err.message);
        }

        // 3. 获取待审核提现数（安全查询，兼容表名）
        try {
            const result = db.prepare("SELECT COUNT(*) as count FROM withdrawals WHERE status = 'pending'").get();
            pendingWithdrawals = result ? result.count : 0;
        } catch (err) {
            console.error('查询待审核提现失败:', err.message);
            // 如果 withdrawals 表不存在，尝试 transactions 表
            try {
                const result2 = db.prepare("SELECT COUNT(*) as count FROM transactions WHERE type = 'withdraw' AND status = 'pending'").get();
                pendingWithdrawals = result2 ? result2.count : 0;
            } catch (err2) {
                console.error('查询 transactions 表也失败:', err2.message);
            }
        }

        // 4. 获取今日收益（优先用 orders.commission 准确统计）
        try {
            const result = db.prepare(`
                SELECT SUM(COALESCE(commission, amount * 0.02)) as total 
                FROM orders 
                WHERE status = 'completed' 
                AND date(created_at) = date('now')
            `).get();
            todayProfit = result && result.total ? result.total : 0;
        } catch (err) {
            console.error('从 orders 表查询今日收益失败:', err.message);
            
            // 方式2：尝试从 user_tasks 表查询（如果有 profit 字段）
            try {
                const result2 = db.prepare(`
                    SELECT SUM(profit) as total 
                    FROM user_tasks 
                    WHERE status = 'completed' 
                    AND date(created_at) = date('now')
                `).get();
                todayProfit = result2 && result2.total ? result2.total : 0;
            } catch (err2) {
                console.error('从 user_tasks 表查询也失败:', err2.message);
                
                // 方式3：尝试从 ledger 表统计（如果存在）
                try {
                    const result3 = db.prepare(`
                        SELECT SUM(amount) as total 
                        FROM ledger 
                        WHERE type = 'task_commission' 
                        AND date(created_at) = date('now')
                    `).get();
                    todayProfit = result3 && result3.total ? result3.total : 0;
                } catch (err3) {
                    console.error('从 ledger 表查询也失败:', err3.message);
                    todayProfit = 0; // 最终兜底：返回 0
                }
            }
        }

        // 5. 邀请统计数据
        let totalInvites = 0;
        let activeReferrers = 0;
        try {
            const inviteResult = db.prepare("SELECT COUNT(*) as count FROM users WHERE referred_by IS NOT NULL AND role = 'User'").get();
            totalInvites = inviteResult ? inviteResult.count : 0;
            const referrerResult = db.prepare(`
                SELECT COUNT(DISTINCT invite_code) as count FROM users 
                WHERE invite_code IN (SELECT DISTINCT referred_by FROM users WHERE referred_by IS NOT NULL) AND role = 'User'
            `).get();
            activeReferrers = referrerResult ? referrerResult.count : 0;
        } catch (err) {
            console.error('查询邀请统计失败:', err.message);
        }

        // 6. 扩展统计：注册、充值、提现、盈利（按日/月）
        let todayReg = 0, yesterdayReg = 0;
        let totalDeposit = 0, todayDeposit = 0, yesterdayDeposit = 0;
        let totalWithdraw = 0, todayWithdraw = 0, yesterdayWithdraw = 0;
        let monthDeposit = 0, lastMonthDeposit = 0;
        let monthWithdraw = 0, lastMonthWithdraw = 0;
        let yesterdayProfit = 0;
        try {
            todayReg = db.prepare("SELECT COUNT(*) as c FROM users WHERE role='User' AND date(created_at)=date('now')").get().c || 0;
            yesterdayReg = db.prepare("SELECT COUNT(*) as c FROM users WHERE role='User' AND date(created_at)=date('now','-1 day')").get().c || 0;
        } catch (e) {}
        try {
            totalDeposit = db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM deposits WHERE status='approved'").get().t || 0;
            todayDeposit = db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM deposits WHERE status='approved' AND date(created_at)=date('now')").get().t || 0;
            yesterdayDeposit = db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM deposits WHERE status='approved' AND date(created_at)=date('now','-1 day')").get().t || 0;
            monthDeposit = db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM deposits WHERE status='approved' AND strftime('%Y-%m',created_at)=strftime('%Y-%m','now')").get().t || 0;
            lastMonthDeposit = db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM deposits WHERE status='approved' AND strftime('%Y-%m',created_at)=strftime('%Y-%m','now','-1 month')").get().t || 0;
        } catch (e) {}
        try {
            totalWithdraw = db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM withdrawals WHERE status IN ('approved','paid')").get().t || 0;
            todayWithdraw = db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM withdrawals WHERE status IN ('approved','paid') AND date(created_at)=date('now')").get().t || 0;
            yesterdayWithdraw = db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM withdrawals WHERE status IN ('approved','paid') AND date(created_at)=date('now','-1 day')").get().t || 0;
            monthWithdraw = db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM withdrawals WHERE status IN ('approved','paid') AND strftime('%Y-%m',created_at)=strftime('%Y-%m','now')").get().t || 0;
            lastMonthWithdraw = db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM withdrawals WHERE status IN ('approved','paid') AND strftime('%Y-%m',created_at)=strftime('%Y-%m','now','-1 month')").get().t || 0;
        } catch (e) {}
        try {
            yesterdayProfit = db.prepare("SELECT SUM(COALESCE(commission, amount*0.02)) as t FROM orders WHERE status='completed' AND date(created_at)=date('now','-1 day')").get().t || 0;
        } catch (e) {}

        // 7. 在线用户（last_active_at 在最近 10 分钟内视为在线，仅统计 User 角色）
        let online_count = 0;
        let online_users = [];
        try {
            const onlineRows = db.prepare(`
                SELECT id, username, last_active_at 
                FROM users 
                WHERE role = 'User' AND last_active_at IS NOT NULL 
                AND datetime(last_active_at) >= datetime('now', '-10 minutes')
                ORDER BY last_active_at DESC
                LIMIT 50
            `).all();
            const countRow = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'User' AND last_active_at IS NOT NULL AND datetime(last_active_at) >= datetime('now', '-10 minutes')").get();
            online_count = countRow ? countRow.c : 0;
            online_users = onlineRows.map(r => ({ id: r.id, username: r.username, last_active_at: r.last_active_at }));
        } catch (e) {}

        // 8. 近十天趋势
        let members10d = [], deposit10d = [];
        const gen10Days = () => {
            const arr = [];
            for (let i = 9; i >= 0; i--) {
                const r = db.prepare("SELECT date('now','-" + i + " days') as d").get();
                arr.push(r.d);
            }
            return arr;
        };
        try {
            const days = gen10Days();
            const rows = db.prepare(`
                SELECT date(created_at) as d, COUNT(*) as c FROM users 
                WHERE role='User' AND date(created_at) >= date('now','-9 days')
                GROUP BY date(created_at)
            `).all();
            const m = {};
            days.forEach(d => m[d] = 0);
            rows.forEach(r => { if (m[r.d] !== undefined) m[r.d] = r.c; });
            members10d = days.map(d => ({ date: d, count: m[d] || 0 }));
        } catch (e) {}
        try {
            const days = gen10Days();
            const rows = db.prepare(`
                SELECT date(created_at) as d, COALESCE(SUM(amount),0) as a FROM deposits 
                WHERE status='approved' AND date(created_at) >= date('now','-9 days')
                GROUP BY date(created_at)
            `).all();
            const m = {};
            days.forEach(d => m[d] = 0);
            rows.forEach(r => { if (m[r.d] !== undefined) m[r.d] = r.a; });
            deposit10d = days.map(d => ({ date: d, amount: m[d] || 0 }));
        } catch (e) {}

        res.json({ 
            success: true, 
            data: { 
                total_users: userCount, 
                system_balance: systemBalance, 
                pending_withdrawals: pendingWithdrawals, 
                today_profit: todayProfit,
                total_invites: totalInvites,
                active_referrers: activeReferrers,
                online_count: online_count,
                online_users: online_users,
                today_reg: todayReg, yesterday_reg: yesterdayReg,
                total_deposit: totalDeposit, today_deposit: todayDeposit, yesterday_deposit: yesterdayDeposit,
                total_withdraw: totalWithdraw, today_withdraw: todayWithdraw, yesterday_withdraw: yesterdayWithdraw,
                month_deposit: monthDeposit, last_month_deposit: lastMonthDeposit,
                month_withdraw: monthWithdraw, last_month_withdraw: lastMonthWithdraw,
                total_profit: (function(){ try { return db.prepare("SELECT COALESCE(SUM(COALESCE(commission, amount*0.02)),0) as t FROM orders WHERE status='completed'").get().t || 0; } catch(e){ return 0; } })(),
                yesterday_profit: yesterdayProfit,
                members_10d: members10d,
                deposit_10d: deposit10d
            } 
        });
        
    } catch (err) {
        console.error('Stats 接口致命错误:', err);
        // 即使发生错误，也返回默认值，防止前端卡死
        res.json({ 
            success: true, 
            data: { 
                total_users: 0, 
                system_balance: 0, 
                pending_withdrawals: 0, 
                today_profit: 0 
            },
            warning: '部分统计数据加载失败'
        });
    }
});

// ==========================================
// 2. 用户管理（支持多条件搜索、分页、N+1 优化）
// ==========================================
router.get('/users', checkAdmin, (req, res) => {
    const db = getDb();
    const {
        search, type,
        user_id, phone, username, login_ip, invite_code, vip_level, status,
        created_from, created_to, balance_min, balance_max, wallet_address,
        limit = 50, offset = 0
    } = req.query;
    try {
        let sql = "SELECT id, username, balance, frozen_balance, wallet_address, security_password, invite_code, referred_by, allow_grab, task_progress, is_worker, vip_level, credit_score, allow_withdraw, status, created_at, phone FROM users WHERE role = 'User'";
        const params = [];

        if (type === 'worker') {
            sql += " AND is_worker = 1";
        } else if (type === 'real') {
            sql += " AND (is_worker = 0 OR is_worker IS NULL)";
        }
        if (search) {
            sql += " AND (username LIKE ? OR CAST(id AS TEXT) LIKE ? OR invite_code LIKE ? OR COALESCE(phone,'') LIKE ?)";
            params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
        }
        if (user_id) {
            sql += " AND id = ?";
            params.push(user_id);
        }
        if (phone) {
            sql += " AND (phone LIKE ? OR phone = ?)";
            params.push(`%${phone}%`, phone);
        }
        if (username) {
            sql += " AND username LIKE ?";
            params.push(`%${username}%`);
        }
        if (invite_code) {
            sql += " AND invite_code LIKE ?";
            params.push(`%${invite_code}%`);
        }
        if (vip_level !== undefined && vip_level !== '') {
            sql += " AND vip_level = ?";
            params.push(vip_level);
        }
        if (status) {
            sql += " AND status = ?";
            params.push(status);
        }
        if (created_from) {
            sql += " AND date(created_at) >= date(?)";
            params.push(created_from);
        }
        if (created_to) {
            sql += " AND date(created_at) <= date(?)";
            params.push(created_to);
        }
        if (balance_min !== undefined && balance_min !== '') {
            sql += " AND balance >= ?";
            params.push(parseFloat(balance_min));
        }
        if (balance_max !== undefined && balance_max !== '') {
            sql += " AND balance <= ?";
            params.push(parseFloat(balance_max));
        }
        if (wallet_address) {
            sql += " AND wallet_address LIKE ?";
            params.push(`%${wallet_address}%`);
        }
        // login_ip: 通过 login_logs 过滤
        if (login_ip) {
            const idsByIp = db.prepare("SELECT DISTINCT user_id FROM login_logs WHERE ip LIKE ?").all(`%${login_ip}%`);
            const ids = idsByIp.map(r => r.user_id);
            if (ids.length === 0) {
                sql += " AND 1=0"; // 无匹配
            } else {
                sql += " AND id IN (" + ids.map(() => '?').join(',') + ")";
                params.push(...ids);
            }
        }

        let total = 0;
        try {
            const countSql = sql.replace(/SELECT[\s\S]+?FROM\s+users/i, 'SELECT COUNT(*) as total FROM users');
            const countRow = db.prepare(countSql).get(...params);
            total = countRow ? countRow.total : 0;
        } catch (e) { total = 0; }

        const limitNum = Math.min(parseInt(limit, 10) || 20, 500);
        const offsetNum = Math.max(0, parseInt(offset, 10) || 0);
        sql += " ORDER BY id DESC LIMIT ? OFFSET ?";
        params.push(limitNum, offsetNum);
        const users = db.prepare(sql).all(...params);

        // 批量查询推荐人、团队数、最近登录 IP（避免 N+1）
        const referredBySet = [...new Set(users.map(u => u.referred_by).filter(Boolean))];
        const inviteCodeSet = [...new Set(users.map(u => u.invite_code).filter(Boolean))];
        const referrerMap = {};
        if (referredBySet.length > 0) {
            const ph = referredBySet.map(() => '?').join(',');
            db.prepare(`SELECT invite_code, username FROM users WHERE invite_code IN (${ph})`).all(...referredBySet).forEach(r => { referrerMap[r.invite_code] = r.username; });
        }
        const teamMap = {};
        if (inviteCodeSet.length > 0) {
            const ph = inviteCodeSet.map(() => '?').join(',');
            db.prepare(`SELECT referred_by, COUNT(*) as count FROM users WHERE referred_by IN (${ph}) GROUP BY referred_by`).all(...inviteCodeSet).forEach(r => { teamMap[r.referred_by] = r.count; });
        }
        const userIds = users.map(u => u.id);
        const lastIpMap = {};
        if (userIds.length > 0) {
            const ph = userIds.map(() => '?').join(',');
            const latestLogs = db.prepare(`
                SELECT l.user_id, l.ip FROM login_logs l
                INNER JOIN (SELECT user_id, MAX(created_at) as max_at FROM login_logs WHERE user_id IN (${ph}) GROUP BY user_id) t
                ON l.user_id = t.user_id AND l.created_at = t.max_at
            `).all(...userIds);
            latestLogs.forEach(r => { lastIpMap[r.user_id] = r.ip; });
        }

        const safeUsers = users.map(u => ({
            ...u,
            has_security_password: !!u.security_password,
            security_password: undefined,
            referrer_name: u.referred_by ? (referrerMap[u.referred_by] || null) : null,
            team_count: u.invite_code ? (teamMap[u.invite_code] || 0) : 0,
            last_login_ip: lastIpMap[u.id] || null
        }));

        res.json({ success: true, data: { users: safeUsers, pagination: { page: Math.floor(offsetNum / limitNum) + 1, limit: limitNum, total, offset: offsetNum } } });
    } catch (err) {
        console.error('Load users error:', err);
        res.status(500).json({ success: false, message: '加载用户失败: ' + err.message });
    }
});

// === 资金调节（统一使用此接口，无 PATCH /users/:id/balance）===
router.post('/adjust-balance', checkAdmin, (req, res) => {
    try {
        const { user_id, type, amount, remark } = req.body || {};
        const val = parseFloat(amount);

        if (!user_id || isNaN(val) || val <= 0) {
            return res.json({ success: false, message: 'Invalid amount.' });
        }
        if (!['add', 'deduct'].includes(type)) {
            return res.json({ success: false, message: 'Invalid operation type.' });
        }

        const db = req.db || getDb();
        const user = db.prepare('SELECT id, balance FROM users WHERE id = ?').get(user_id);
        if (!user) {
            return res.json({ success: false, message: 'User not found.' });
        }

        let newBalance = parseFloat(user.balance) || 0;
        if (type === 'add') {
            newBalance += val;
        } else {
            if (newBalance < val) {
                return res.json({ success: false, message: 'Insufficient balance.' });
            }
            newBalance -= val;
        }

        const transAmount = type === 'add' ? val : -val;
        const transType = type === 'add' ? 'system_add' : 'system_deduct';
        const reason = (remark || 'Admin Adjustment').toString();

        db.transaction(() => {
            db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(newBalance, user_id);
            db.prepare(`
                INSERT INTO transactions (user_id, type, amount, description, created_at)
                VALUES (?, ?, ?, ?, datetime('now'))
            `).run(user_id, transType, transAmount, reason);
            try {
                db.prepare(`
                    INSERT INTO ledger (user_id, type, amount, reason, created_by, created_at)
                    VALUES (?, ?, ?, ?, ?, datetime('now'))
                `).run(user_id, 'admin_adjust', transAmount, reason, 1);
            } catch (ledgerErr) {
                console.warn('Ledger insert skip:', ledgerErr.message);
            }
        })();

        res.json({ success: true, message: 'Balance adjusted successfully.' });
    } catch (e) {
        console.error('Adjust balance error:', e);
        res.status(500).json({ success: false, message: e.message || 'Database error.' });
    }
});

router.patch('/users/:id/status', checkAdmin, (req, res) => {
    const db = getDb();
    const { status } = req.body;
    try {
        db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, req.params.id);
        res.json({ success: true, message: '状态更新成功' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 修改用户推荐关系
router.patch('/users/:id/referrer', checkAdmin, (req, res) => {
    const db = getDb();
    const userId = req.params.id;
    const { referrer_code } = req.body; // 新推荐人的邀请码
    
    try {
        // 获取当前用户信息
        const user = db.prepare('SELECT id, username, invite_code FROM users WHERE id = ?').get(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: '用户不存在' });
        }
        
        // 如果提供了新推荐人邀请码，验证其有效性
        if (referrer_code) {
            // 查找新推荐人
            const newReferrer = db.prepare('SELECT id, username, invite_code FROM users WHERE invite_code = ?').get(referrer_code);
            if (!newReferrer) {
                return res.status(400).json({ success: false, message: '推荐人邀请码无效' });
            }
            
            // 防止循环引用：不能将用户设置为自己的推荐人
            if (newReferrer.id === userId) {
                return res.status(400).json({ success: false, message: '不能将用户设置为自己的推荐人' });
            }
            
            // 防止循环引用：不能将自己的下级设置为推荐人
            const isDownline = db.prepare('SELECT id FROM users WHERE referred_by = ?').get(user.invite_code);
            if (isDownline && isDownline.id === newReferrer.id) {
                return res.status(400).json({ success: false, message: '不能将自己的下级设置为推荐人（会形成循环）' });
            }
            
            // 更新推荐关系
            db.prepare('UPDATE users SET referred_by = ? WHERE id = ?').run(referrer_code, userId);
            res.json({ 
                success: true, 
                message: `已将 ${user.username} 调整到 ${newReferrer.username} 的团队下` 
            });
        } else {
            // 清空推荐关系
            db.prepare('UPDATE users SET referred_by = NULL WHERE id = ?').run(userId);
            res.json({ 
                success: true, 
                message: `已清除 ${user.username} 的推荐关系` 
            });
        }
    } catch (err) {
        console.error('修改推荐关系失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 切换用户抢单状态
router.post('/users/:id/toggle-grab', checkAdmin, (req, res) => {
    const db = getDb();
    const userId = req.params.id;
    
    try {
        // 获取当前用户信息
        const user = db.prepare('SELECT id, username, allow_grab FROM users WHERE id = ?').get(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: '用户不存在' });
        }
        
        // 切换抢单状态 (0 -> 1, 1 -> 0)
        const newStatus = user.allow_grab === 1 ? 0 : 1;
        db.prepare('UPDATE users SET allow_grab = ? WHERE id = ?').run(newStatus, userId);
        
        res.json({ 
            success: true, 
            message: `已${newStatus === 1 ? '开启' : '关闭'} ${user.username} 的抢单功能`,
            data: { allow_grab: newStatus }
        });
    } catch (err) {
        console.error('切换抢单状态失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 重置用户任务进度（同时取消未完成订单并退还冻结金额）
router.post('/users/:id/reset-progress', checkAdmin, (req, res) => {
    const db = getDb();
    const userId = req.params.id;

    try {
        const user = db.prepare('SELECT id, username, task_progress, frozen_balance FROM users WHERE id = ?').get(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: '用户不存在' });
        }

        let cancelledCount = 0;
        db.transaction(() => {
            const pendingOrders = db.prepare('SELECT id, order_no, amount, source FROM orders WHERE user_id = ? AND status = ?').all(userId, 'pending');
            cancelledCount = pendingOrders.length;
            let totalRefund = 0;
            for (const o of pendingOrders) {
                db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(o.id);
                // 仅 start 流程的订单创建时扣了款进 frozen_balance，才退到 balance；match 流程从未扣款，不能加钱
                if (o.source !== 'match') totalRefund += o.amount || 0;
            }
            if (totalRefund > 0) {
                db.prepare('UPDATE users SET balance = balance + ?, frozen_balance = frozen_balance - ? WHERE id = ?').run(totalRefund, totalRefund, userId);
            }
            db.prepare('UPDATE users SET task_progress = 0 WHERE id = ?').run(userId);
        })();

        res.json({
            success: true,
            message: cancelledCount > 0 ? `已重置 ${user.username} 的任务进度，并已取消 ${cancelledCount} 个未完成订单` : `已重置 ${user.username} 的任务进度（原进度: ${user.task_progress}）`,
            data: { old_progress: user.task_progress, new_progress: 0 }
        });
    } catch (err) {
        console.error('重置任务进度失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 创建派送订单（预设插队订单）
router.post('/users/:id/dispatch-order', checkAdmin, (req, res) => {
    const db = getDb();
    const userId = req.params.id;
    const { task_index, min_amount, max_amount } = req.body;
    
    try {
        // 验证参数
        if (!task_index || !min_amount || !max_amount) {
            return res.status(400).json({ success: false, message: '参数不完整' });
        }
        
        if (task_index < 1) {
            return res.status(400).json({ success: false, message: '任务编号必须大于0' });
        }
        
        if (min_amount < 0 || max_amount < 0 || max_amount < min_amount) {
            return res.status(400).json({ success: false, message: '金额范围无效' });
        }
        
        // 获取用户信息
        const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: '用户不存在' });
        }
        
        // 检查是否已存在相同任务编号的派送订单
        const existing = db.prepare(
            'SELECT id FROM dispatched_orders WHERE user_id = ? AND task_index = ?'
        ).get(userId, task_index);
        
        if (existing) {
            // 更新现有订单
            db.prepare(`
                UPDATE dispatched_orders 
                SET min_amount = ?, max_amount = ?, status = 'pending', created_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(min_amount, max_amount, existing.id);
            
            res.json({ 
                success: true, 
                message: `已更新 ${user.username} 第${task_index}单的派送订单 (${min_amount}-${max_amount} USDT)`
            });
        } else {
            // 创建新订单
            db.prepare(`
                INSERT INTO dispatched_orders (user_id, task_index, min_amount, max_amount, status)
                VALUES (?, ?, ?, ?, 'pending')
            `).run(userId, task_index, min_amount, max_amount);
            
            res.json({ 
                success: true, 
                message: `已为 ${user.username} 设置第${task_index}单的派送订单 (${min_amount}-${max_amount} USDT)`
            });
        }
    } catch (err) {
        console.error('创建派送订单失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 获取用户的派送订单列表
router.get('/users/:id/dispatch-orders', checkAdmin, (req, res) => {
    const db = getDb();
    const userId = req.params.id;
    
    try {
        const orders = db.prepare(`
            SELECT * FROM dispatched_orders 
            WHERE user_id = ? 
            ORDER BY task_index ASC
        `).all(userId);
        
        res.json({ success: true, data: orders });
    } catch (err) {
        console.error('获取派送订单失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 删除派送订单
router.delete('/dispatch-orders/:id', checkAdmin, (req, res) => {
    const db = getDb();
    const orderId = req.params.id;
    
    try {
        db.prepare('DELETE FROM dispatched_orders WHERE id = ?').run(orderId);
        res.json({ success: true, message: '派送订单已删除' });
    } catch (err) {
        console.error('删除派送订单失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 做单账户管理
// ==========================================

// 创建做单账户
router.post('/worker/create', checkAdmin, (req, res) => {
    const db = getDb();
    const { username, password, balance } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password are required' });
    }

    try {
        // 检查用户名是否已存在
        const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
        if (existing) {
            return res.status(409).json({ success: false, message: 'Username already exists' });
        }

        // 创建做单账户 (is_worker = 1, role = User)
        const bcrypt = require('bcryptjs');
        const passwordHash = bcrypt.hashSync(password, 10);
        const initBalance = parseFloat(balance) || 0;
        
        // 生成邀请码
        const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        
        const result = db.prepare(`
            INSERT INTO users (username, password_hash, balance, is_worker, role, vip_level, invite_code, status, created_at)
            VALUES (?, ?, ?, 1, 'User', 1, ?, 'active', CURRENT_TIMESTAMP)
        `).run(username, passwordHash, initBalance, inviteCode);

        console.log(`🤖 创建做单账户: ${username} (ID:${result.lastInsertRowid}), 初始余额: ${initBalance} USDT`);
        
        res.json({ 
            success: true, 
            message: `做单账户 ${username} 创建成功`,
            data: { id: result.lastInsertRowid, username, balance: initBalance }
        });
    } catch (err) {
        console.error('创建做单账户失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 重置用户登录密码
router.post('/users/:id/reset-password', checkAdmin, (req, res) => {
    const db = getDb();
    const bcrypt = require('bcryptjs');
    const { new_password } = req.body;
    
    if (!new_password || new_password.length < 6) {
        return res.json({ success: false, message: '新密码至少6位' });
    }
    
    try {
        const hashedPassword = bcrypt.hashSync(new_password, 10);
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashedPassword, req.params.id);
        res.json({ success: true, message: '密码重置成功' });
    } catch (err) {
        console.error('重置密码失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 重置用户资金密码
router.post('/users/:id/reset-security-password', checkAdmin, (req, res) => {
    const db = getDb();
    try {
        db.prepare('UPDATE users SET security_password = NULL WHERE id = ?').run(req.params.id);
        res.json({ success: true, message: '资金密码已清除，用户需重新设置' });
    } catch (err) {
        console.error('重置资金密码失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 3. 财务审批
// ==========================================
router.get('/withdrawals', checkAdmin, (req, res) => {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 500);
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    try {
        const total = db.prepare('SELECT COUNT(*) as c FROM withdrawals').get().c;
        const pendingCount = db.prepare("SELECT COUNT(*) as c FROM withdrawals WHERE status = 'pending'").get().c;
        const withdrawals = db.prepare(`
            SELECT w.id, w.user_id, w.amount, w.wallet_address, w.status, w.created_at, u.username
            FROM withdrawals w
            JOIN users u ON w.user_id = u.id
            ORDER BY w.created_at DESC LIMIT ? OFFSET ?
        `).all(limit, offset);
        res.json({ success: true, data: { withdrawals, pagination: { limit, offset, total }, pending_count: pendingCount } });
    } catch (err) {
        console.error('Load withdrawals error:', err);
        res.status(500).json({ success: false, message: '加载提现失败: ' + err.message });
    }
});

router.post('/withdrawals/:id/review', checkAdmin, (req, res) => {
    const db = getDb();
    const { action, reason } = req.body;
    const withdrawalId = req.params.id;
    
    try {
        const tx = db.transaction(() => {
            const withdrawal = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(withdrawalId);
            if (!withdrawal) throw new Error('提现记录不存在');
            if (withdrawal.status !== 'pending') throw new Error('该提现申请已处理');
            
            if (action === 'approve') {
                // 提交提现时已扣款，此处仅更新状态并记流水，不再检查余额
                db.prepare("UPDATE withdrawals SET status = 'approved', reviewed_by = 1, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?").run(withdrawalId);
                db.prepare('INSERT INTO ledger (user_id, type, amount, reason, created_by) VALUES (?, ?, ?, ?, ?)').run(withdrawal.user_id, 'withdrawal', -withdrawal.amount, '提现审批通过', 1);
            } else {
                db.prepare("UPDATE withdrawals SET status = 'rejected', note = ?, reviewed_by = 1, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?").run(reason || '管理员驳回', withdrawalId);
                db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(withdrawal.amount, withdrawal.user_id);
            }
        });
        tx();
        res.json({ success: true, message: action === 'approve' ? '提现审批通过' : '提现申请已驳回' });
    } catch (err) {
        console.error('Review withdrawal error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 充值审批
router.get('/deposits', checkAdmin, (req, res) => {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 500);
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    try {
        const total = db.prepare('SELECT COUNT(*) as c FROM deposits').get().c;
        const pendingCount = db.prepare("SELECT COUNT(*) as c FROM deposits WHERE status = 'pending'").get().c;
        const deposits = db.prepare(`
            SELECT d.id, d.user_id, d.amount, d.hash, d.screenshot_url, d.status, d.created_at, u.username
            FROM deposits d
            JOIN users u ON d.user_id = u.id
            ORDER BY d.created_at DESC LIMIT ? OFFSET ?
        `).all(limit, offset);
        res.json({ success: true, data: { deposits, pagination: { limit, offset, total }, pending_count: pendingCount } });
    } catch (err) {
        console.error('Load deposits error:', err);
        res.status(500).json({ success: false, message: '加载充值失败: ' + err.message });
    }
});

router.post('/deposits/:id/review', checkAdmin, (req, res) => {
    const db = getDb();
    const { action, reason } = req.body;
    const depositId = req.params.id;
    
    try {
        const tx = db.transaction(() => {
            const deposit = db.prepare('SELECT * FROM deposits WHERE id = ?').get(depositId);
            if (!deposit) throw new Error('充值记录不存在');
            if (deposit.status !== 'pending') throw new Error('该充值申请已处理');
            
            if (action === 'approve') {
                db.prepare("UPDATE deposits SET status = 'approved', reviewed_by = 1, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?").run(depositId);
                db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(deposit.amount, deposit.user_id);
                db.prepare('INSERT INTO ledger (user_id, type, amount, reason, created_by) VALUES (?, ?, ?, ?, ?)').run(deposit.user_id, 'deposit', deposit.amount, '充值审批通过', 1);
            } else {
                db.prepare("UPDATE deposits SET status = 'rejected', note = ?, reviewed_by = 1, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?").run(reason || '管理员驳回', depositId);
            }
        });
        tx();
        res.json({ success: true, message: action === 'approve' ? '充值审批通过' : '充值申请已驳回' });
    } catch (err) {
        console.error('Review deposit error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 4. 商品与任务管理
// ==========================================
router.get('/products', checkAdmin, (req, res) => {
    const db = getDb();
    try {
        db.prepare(`CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            price REAL,
            image TEXT,
            vip_level INTEGER DEFAULT 0
        )`).run();
        const limit = Math.min(parseInt(req.query.limit, 10) || 20, 500);
        const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
        const total = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
        const products = db.prepare('SELECT * FROM products ORDER BY id DESC LIMIT ? OFFSET ?').all(limit, offset);
        res.json({ success: true, data: { products, total, limit, offset } });
    } catch (err) {
        console.error('Load products error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post('/products', checkAdmin, (req, res) => {
    const db = getDb();
    const { title, price, image, vip_level } = req.body;
    try {
        const effectiveVip = (vip_level === 0 || vip_level === '0' || vip_level == null || vip_level === '') ? 0 : Number(vip_level);
        db.prepare('INSERT INTO products (title, price, image, vip_level) VALUES (?, ?, ?, ?)').run(title, price, image, effectiveVip);
        res.json({ success: true, message: '商品添加成功' });
    } catch (err) {
        console.error('Add product error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * 从 xlsx 提取内嵌图片，映射到行号（0-based，首行为表头，rowIndex=0 表示第 2 行）
 * 返回 { rowImages: { rowIndex: Buffer } }
 */
async function extractImagesFromXlsx(buffer) {
  const rowImages = {};
  try {
    const zip = await JSZip.loadAsync(buffer);
    const mediaFiles = [];
    zip.folder('xl/media').forEach((relativePath, file) => { mediaFiles.push(relativePath); });
    if (mediaFiles.length === 0) return rowImages;

    const sheetRels = await zip.file('xl/worksheets/_rels/sheet1.xml.rels')?.async('string');
    if (!sheetRels) return rowImages;
    const drawingRId = sheetRels.match(/Relationship[^>]*Type="[^"]*drawing[^"]*"[^>]*Id="([^"]+)"/i)?.[1];
    if (!drawingRId) return rowImages;

    const drawingPath = 'xl/drawings/drawing1.xml';
    const drawingRelsPath = 'xl/drawings/_rels/drawing1.xml.rels';
    const drawingRels = await zip.file(drawingRelsPath)?.async('string');
    const drawingXml = await zip.file(drawingPath)?.async('string');
    if (!drawingRels || !drawingXml) return rowImages;

    const rIdToMedia = {};
    drawingRels.replace(/<Relationship[^>]*>/g, (match) => {
      const idM = match.match(/Id="([^"]+)"/);
      const targetM = match.match(/Target="([^"]+)"/);
      if (idM && targetM && targetM[1].indexOf('media') !== -1) {
        rIdToMedia[idM[1]] = targetM[1].replace(/^\.\.\//, 'xl/');
      }
    });

    const anchorRegex = /<xdr:(?:twoCellAnchor|oneCellAnchor)[\s\S]*?<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>[\s\S]*?<xdr:pic[\s\S]*?<a:blip[^>]*r:embed="([^"]+)"/gi;
    let m;
    while ((m = anchorRegex.exec(drawingXml)) !== null) {
      const row = parseInt(m[1], 10);
      const rId = m[2];
      const mediaPath = rIdToMedia[rId];
      if (!mediaPath) continue;
      const imgFile = zip.file(mediaPath);
      if (!imgFile) continue;
      const buf = await imgFile.async('nodebuffer');
      rowImages[row - 1] = buf;
    }
  } catch (e) {
    console.warn('extractImagesFromXlsx:', e.message);
  }
  return rowImages;
}

// 批量导入商品（Excel .xlsx）
// 字段：Name(名称), Price(价格), Image(图片URL 可选)；Image 列可输入 URL 或在单元格内嵌入图片
// 导入后 vip_level=0（全员通用）
router.post('/products/import', checkAdmin, upload.single('file'), async (req, res) => {
    const db = getDb();
    try {
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({ success: false, message: '未检测到上传文件' });
        }
        const original = (req.file.originalname || '').toLowerCase();
        if (!original.endsWith('.xlsx')) {
            return res.status(400).json({ success: false, message: '仅支持 .xlsx 文件' });
        }

        // 确保表存在
        db.prepare(`CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            price REAL,
            image TEXT,
            vip_level INTEGER DEFAULT 0
        )`).run();

        const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = wb.SheetNames && wb.SheetNames[0];
        if (!sheetName) return res.status(400).json({ success: false, message: 'Excel 中没有工作表' });
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

        if (!rows || !rows.length) {
            return res.status(400).json({ success: false, message: 'Excel 内容为空' });
        }

        // 兼容列名：Name/名称, Price/价格, Image/图片
        const pick = (obj, keys) => {
            for (const k of keys) {
                if (obj[k] != null && String(obj[k]).trim() !== '') return obj[k];
            }
            // 尝试大小写不敏感匹配
            const lowerMap = {};
            Object.keys(obj || {}).forEach(k => lowerMap[k.toLowerCase()] = obj[k]);
            for (const k of keys) {
                const v = lowerMap[String(k).toLowerCase()];
                if (v != null && String(v).trim() !== '') return v;
            }
            return '';
        };

        const rowImages = await extractImagesFromXlsx(req.file.buffer);

        const insert = db.prepare('INSERT INTO products (title, price, image, vip_level) VALUES (?, ?, ?, 0)');
        let inserted = 0;
        let skipped = 0;
        const errors = [];

        const getExt = (buf) => {
            if (!buf || buf.length < 4) return '.png';
            if (buf[0] === 0xFF && buf[1] === 0xD8) return '.jpg';
            if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E) return '.png';
            if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return '.gif';
            return '.png';
        };

        db.transaction(() => {
            rows.forEach((r, idx) => {
                const name = String(pick(r, ['Name', '名称', 'Title', '商品名称'])).trim();
                const priceRaw = pick(r, ['Price', '价格', 'UnitPrice', '单价']);
                let imageUrl = String(pick(r, ['Image', '图片', 'Img', '图片URL', 'ImageURL'])).trim();

                const price = Number(priceRaw);
                if (!name) { skipped++; errors.push({ row: idx + 2, error: 'Name 不能为空' }); return; }
                if (!isFinite(price) || price <= 0) { skipped++; errors.push({ row: idx + 2, error: 'Price 必须为正数' }); return; }

                const embImg = rowImages[idx];
                if (embImg && embImg.length > 0) {
                    const ext = getExt(embImg);
                    const filename = 'prod_' + Date.now() + '_' + idx + ext;
                    const filepath = path.join(productUploadDir, filename);
                    try {
                        fs.writeFileSync(filepath, embImg);
                        imageUrl = '/public/uploads/products/' + filename;
                    } catch (e) {
                        imageUrl = imageUrl || 'https://placehold.co/100';
                    }
                }
                if (!imageUrl) imageUrl = 'https://placehold.co/100';

                insert.run(name, price, imageUrl);
                inserted++;
            });
        })();

        return res.json({
            success: true,
            data: { inserted, skipped, errors: errors.slice(0, 50) },
            message: `导入完成：成功 ${inserted} 条，跳过 ${skipped} 条`
        });
    } catch (err) {
        console.error('Import products error:', err);
        return res.status(500).json({ success: false, message: err.message || '导入失败' });
    }
});

router.delete('/products/:id', checkAdmin, (req, res) => {
    const db = getDb();
    try {
        db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
        res.json({ success: true, message: '删除成功' });
    } catch (err) {
        console.error('Delete product error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 商品批量删除：按 ID 列表 / 按价格区间 / 全部删除
router.post('/products/batch-delete', checkAdmin, (req, res) => {
    const db = getDb();
    const { ids, by_price, price_min, price_max, delete_all } = req.body || {};
    try {
        if (delete_all) {
            const info = db.prepare('DELETE FROM products').run();
            return res.json({ success: true, message: '已全部删除，共 ' + info.changes + ' 条', deleted: info.changes });
        }
        if (ids && Array.isArray(ids) && ids.length > 0) {
            const placeholders = ids.map(() => '?').join(',');
            const stmt = db.prepare('DELETE FROM products WHERE id IN (' + placeholders + ')');
            const info = stmt.run(...ids);
            return res.json({ success: true, message: '已删除 ' + info.changes + ' 条', deleted: info.changes });
        }
        if (by_price) {
            const min = price_min != null && price_min !== '' ? parseFloat(price_min) : null;
            const max = price_max != null && price_max !== '' ? parseFloat(price_max) : null;
            if (min == null && max == null) {
                return res.status(400).json({ success: false, message: '请填写最低价或最高价' });
            }
            let sql = 'DELETE FROM products WHERE 1=1';
            const params = [];
            if (min != null && isFinite(min)) { sql += ' AND price >= ?'; params.push(min); }
            if (max != null && isFinite(max)) { sql += ' AND price <= ?'; params.push(max); }
            const info = db.prepare(sql).run(...params);
            return res.json({ success: true, message: '按价格已删除 ' + info.changes + ' 条', deleted: info.changes });
        }
        return res.status(400).json({ success: false, message: '请提供 ids、by_price+价格区间 或 delete_all' });
    } catch (err) {
        console.error('Batch delete products error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 商品图片上传（粘贴/拖拽用，返回可访问的 URL）
router.post('/upload-product-image', checkAdmin, (req, res, next) => {
    productImageUpload.single('image')(req, res, (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ success: false, message: '图片大小不能超过 2MB' });
            console.error('upload-product-image:', err);
            return res.status(500).json({ success: false, message: err.message || '图片上传失败' });
        }
        next();
    });
}, (req, res) => {
    if (!req.file || !req.file.buffer) {
        return res.status(400).json({ success: false, message: '请选择或粘贴图片' });
    }
    let ext = (req.file.originalname && path.extname(req.file.originalname).toLowerCase()) || '';
    if (!ext || !/^\.(png|jpg|jpeg|gif|webp)$/i.test(ext)) ext = (req.file.mimetype && req.file.mimetype.includes('png')) ? '.png' : '.jpg';
    const filename = 'prod_' + Date.now() + ext;
    const filepath = path.join(productUploadDir, filename);
    try {
        fs.writeFileSync(filepath, req.file.buffer);
    } catch (e) {
        console.error('upload-product-image write:', e);
        return res.status(500).json({ success: false, message: '保存图片失败：' + (e.message || '') });
    }
    const url = '/public/uploads/products/' + filename;
    res.json({ success: true, data: { url } });
});

// 首页 Banner 图上传（返回可访问的 URL）
router.post('/upload-banner', checkAdmin, bannerUpload.single('image'), (req, res) => {
    if (!req.file || !req.file.filename) {
        return res.status(400).json({ success: false, message: '请选择图片文件' });
    }
    const url = '/public/uploads/banners/' + req.file.filename;
    res.json({ success: true, data: { url } });
});

// ==========================================
// 5. VIP 等级管理
// ==========================================
router.get('/vip', checkAdmin, (req, res) => {
    const db = getDb();
    try {
        db.prepare(`CREATE TABLE IF NOT EXISTS vip_levels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            level INTEGER UNIQUE,
            name TEXT,
            price REAL,
            commission_rate REAL,
            task_limit INTEGER,
            icon TEXT
        )`).run();

        const count = db.prepare('SELECT COUNT(*) as count FROM vip_levels').get().count;
        if (count === 0) {
            const insert = db.prepare('INSERT INTO vip_levels (level, name, price, commission_rate, task_limit) VALUES (?, ?, ?, ?, ?)');
            insert.run(1, 'Amazon Hall', 0, 0.02, 20);
            insert.run(2, 'Shopee Hall', 500, 0.03, 25);
            insert.run(3, 'Alibaba Hall', 2000, 0.04, 30);
            insert.run(4, 'Walmart VIP', 5000, 0.05, 35);
        }

        const vips = db.prepare('SELECT * FROM vip_levels ORDER BY level ASC').all();
        res.json({ success: true, data: { vips } });
    } catch (err) {
        console.error('Load VIP error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post('/vip', checkAdmin, (req, res) => {
    const db = getDb();
    const { id, level, name, price, commission_rate, task_limit } = req.body;
    
    try {
        if (id) {
            db.prepare(`
                UPDATE vip_levels 
                SET level = ?, name = ?, price = ?, commission_rate = ?, task_limit = ?
                WHERE id = ?
            `).run(level, name, price, commission_rate, task_limit, id);
            res.json({ success: true, message: 'VIP 更新成功' });
        } else {
            db.prepare(`
                INSERT INTO vip_levels (level, name, price, commission_rate, task_limit)
                VALUES (?, ?, ?, ?, ?)
            `).run(level, name, price, commission_rate, task_limit);
            res.json({ success: true, message: 'VIP 添加成功' });
        }
    } catch (err) {
        console.error('Submit VIP error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

router.delete('/vip/:id', checkAdmin, (req, res) => {
    const db = getDb();
    try {
        db.prepare('DELETE FROM vip_levels WHERE id = ?').run(req.params.id);
        res.json({ success: true, message: '删除成功' });
    } catch (err) {
        console.error('Delete VIP error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 6. 系统设置管理 (System Settings)
// ==========================================

// 获取所有设置
router.get('/settings', checkAdmin, (req, res) => {
    const db = getDb();
    try {
        // 自动建表
        db.prepare(`CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            description TEXT
        )`).run();

        // 初始化默认设置 (如果不存在则插入)
        const initSetting = (key, val, desc) => {
            db.prepare('INSERT OR IGNORE INTO settings (key, value, description) VALUES (?, ?, ?)').run(key, val, desc);
        };
        
        initSetting('service_url', 'https://t.me/your_service', '客服链接');
        initSetting('announcement', 'Welcome to TaskMall!', '首页公告');
        initSetting('withdraw_fee', '0', '提现手续费(%)');
        initSetting('withdraw_open', '1', '提现开关 (1开 0关)');
        initSetting('withdraw_min', '10', '最低提现金额(USDT)');
        initSetting('deposit_address', '', '充值收款地址(TRC20)');
        initSetting('deposit_channels', '[]', '充值方式列表JSON');
        initSetting('deposit_min_amount', '10', '最低充值金额(USDT)');
        initSetting('deposit_require_hash_or_screenshot', '1', '必填哈希或截图(1/0)');
        initSetting('deposit_tips', 'Only TRC20 supported; Min 10 USDT; Arrival approx. 1-30 min; Wait for approval after submission.', 'deposit page tips');
        initSetting('deposit_maintenance', '0', '充值维护(1=关闭)');
        initSetting('deposit_daily_limit', '0', '单用户单日充值上限(0=不限制)');
        initSetting('withdraw_max', '5000', '单笔最高提现(USDT)');
        initSetting('withdraw_fee_type', 'percent', '手续费类型percent|fixed');
        initSetting('withdraw_fee_value', '0', '手续费值');
        initSetting('withdraw_channels', '[]', '提现方式列表JSON');
        initSetting('withdraw_tips', 'Arrival approx. 1-24 hours. Please check approval status.', 'withdraw tips');
        initSetting('withdraw_maintenance', '0', '提现维护(1=关闭)');
        initSetting('withdraw_daily_count_limit', '0', '单日提现次数(0=不限制)');
        initSetting('withdraw_daily_amount_limit', '0', '单日提现总额(0=不限制)');
        initSetting('about_us', '', '关于我们');
        initSetting('home_banner_1', 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=800', '首页Banner图1（URL或上传）');
        initSetting('home_banner_2', 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=800', '首页Banner图2（URL或上传）');
        initSetting('home_banner_3', 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=800', '首页Banner图3（URL或上传）');

        const settings = db.prepare('SELECT * FROM settings').all();
        // 转换为对象格式方便前端使用
        const settingsMap = {};
        settings.forEach(s => settingsMap[s.key] = s.value);
        
        res.json({ success: true, data: settingsMap });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 保存设置
router.post('/settings', checkAdmin, (req, res) => {
    const db = getDb();
    const settings = req.body; 
    
    try {
        const updateStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value, description) VALUES (?, ?, (SELECT description FROM settings WHERE key = ?))');
        
        const tx = db.transaction(() => {
            for (const [key, value] of Object.entries(settings)) {
                updateStmt.run(key, String(value), key);
            }
        });
        tx();
        
        res.json({ success: true, message: '设置保存成功' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 邀请推荐高级功能
// ==========================================

// 获取用户的团队成员列表
router.get('/users/:id/team', checkAdmin, (req, res) => {
    const db = getDb();
    const userId = req.params.id;
    
    try {
        // 获取用户邀请码
        const user = db.prepare('SELECT invite_code, username FROM users WHERE id = ?').get(userId);
        
        if (!user || !user.invite_code) {
            return res.json({ success: true, data: { team: [], parent: user } });
        }
        
        // 查询团队成员（直接下级）
        const team = db.prepare(`
            SELECT id, username, balance, invite_code, status, created_at,
                   (SELECT COUNT(*) FROM users WHERE referred_by = u.invite_code) as sub_team_count
            FROM users u
            WHERE referred_by = ?
            ORDER BY created_at DESC
        `).all(user.invite_code);
        
        res.json({ 
            success: true, 
            data: { 
                team: team,
                parent: user,
                total: team.length 
            } 
        });
    } catch (err) {
        console.error('获取团队成员失败:', err);
        res.status(500).json({ success: false, message: '获取团队成员失败: ' + err.message });
    }
});

// 获取邀请趋势数据（最近30天）
router.get('/invite-trends', checkAdmin, (req, res) => {
    const db = getDb();
    
    try {
        const trends = db.prepare(`
            SELECT DATE(created_at) as date, COUNT(*) as count
            FROM users
            WHERE referred_by IS NOT NULL 
            AND role = 'User'
            AND created_at >= DATE('now', '-30 days')
            GROUP BY DATE(created_at)
            ORDER BY date ASC
        `).all();
        
        res.json({ success: true, data: trends });
    } catch (err) {
        console.error('获取邀请趋势失败:', err);
        res.status(500).json({ success: false, message: '获取邀请趋势失败: ' + err.message });
    }
});

// 导出用户推荐关系数据（CSV格式）
router.get('/export-invites', checkAdmin, (req, res) => {
    const db = getDb();
    
    try {
        const users = db.prepare(`
            SELECT u.id, u.username, u.invite_code, u.referred_by, u.balance, u.created_at,
                   r.username as referrer_name,
                   (SELECT COUNT(*) FROM users WHERE referred_by = u.invite_code) as team_count
            FROM users u
            LEFT JOIN users r ON u.referred_by = r.invite_code
            WHERE u.role = 'User'
            ORDER BY u.id ASC
        `).all();
        
        // 构建CSV内容
        let csv = 'ID,用户名,邀请码,推荐人,推荐人用户名,余额,团队人数,注册时间\n';
        users.forEach(u => {
            csv += `${u.id},"${u.username}","${u.invite_code || ''}","${u.referred_by || ''}","${u.referrer_name || ''}",${u.balance},${u.team_count},"${u.created_at}"\n`;
        });
        
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="invite_data_' + Date.now() + '.csv"');
        res.send('\ufeff' + csv); // 添加 BOM 以支持 Excel 正确显示中文
    } catch (err) {
        console.error('导出数据失败:', err);
        res.status(500).json({ success: false, message: '导出数据失败: ' + err.message });
    }
});

// 获取推荐奖励记录
router.get('/referral-rewards', checkAdmin, (req, res) => {
    const db = getDb();
    const { page = 1, limit = 50 } = req.query;
    
    try {
        const offset = (page - 1) * limit;
        const rewards = db.prepare(`
            SELECT * FROM referral_rewards
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `).all(limit, offset);
        
        const total = db.prepare('SELECT COUNT(*) as count FROM referral_rewards').get();
        
        res.json({ 
            success: true, 
            data: { 
                rewards: rewards,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: total.count
                }
            } 
        });
    } catch (err) {
        console.error('获取奖励记录失败:', err);
        res.status(500).json({ success: false, message: '获取奖励记录失败: ' + err.message });
    }
});

// 切换用户状态 (冻结/解冻)
router.post('/users/:id/toggle-status', checkAdmin, (req, res) => {
    const db = getDb();
    const userId = req.params.id;
    
    try {
        const user = db.prepare('SELECT id, username, status FROM users WHERE id = ?').get(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: '用户不存在' });
        }
        
        const newStatus = user.status === 'active' ? 'banned' : 'active';
        db.prepare('UPDATE users SET status = ? WHERE id = ?').run(newStatus, userId);
        
        console.log(`🔒 管理员${newStatus === 'banned' ? '冻结' : '解冻'}用户: ${user.username} (ID:${userId})`);
        
        res.json({ 
            success: true, 
            message: `用户已${newStatus === 'banned' ? '冻结' : '解冻'}`,
            data: { newStatus }
        });
    } catch (err) {
        console.error('切换用户状态失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 编辑用户信息
router.post('/users/:id/edit', checkAdmin, (req, res) => {
    const db = getDb();
    const userId = req.params.id;
    const { password, security_password, vip_level, credit_score, allow_withdraw, remark } = req.body;
    
    try {
        const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: '用户不存在' });
        }
        
        const updates = [];
        const params = [];
        
        // 登录密码 (如果提供且不为空，需要加密)
        if (password && password.trim() !== '') {
            const bcrypt = require('bcryptjs');
            const passwordHash = bcrypt.hashSync(password.trim(), 10);
            updates.push('password_hash = ?');
            params.push(passwordHash);
        }
        
        // 资金密码 (如果提供且不为空，需要加密)
        if (security_password && security_password.trim() !== '') {
            const bcrypt = require('bcryptjs');
            const securityHash = bcrypt.hashSync(security_password.trim(), 10);
            updates.push('security_password = ?');
            params.push(securityHash);
        }
        
        // VIP等级
        if (vip_level !== undefined && vip_level !== null) {
            const level = parseInt(vip_level);
            if (level >= 1 && level <= 5) {
                updates.push('vip_level = ?');
                params.push(level);
            }
        }
        
        // 信用分
        if (credit_score !== undefined && credit_score !== null) {
            updates.push('credit_score = ?');
            params.push(parseInt(credit_score));
        }
        
        // 提现权限
        if (allow_withdraw !== undefined && allow_withdraw !== null) {
            updates.push('allow_withdraw = ?');
            params.push(allow_withdraw ? 1 : 0);
        }
        
        if (updates.length === 0) {
            return res.json({ success: false, message: '没有需要更新的字段' });
        }
        
        // 执行更新
        params.push(userId);
        const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
        db.prepare(sql).run(...params);
        
        console.log(`✏️ 管理员编辑用户: ${user.username} (ID:${userId}), 更新字段: ${updates.join(', ')}`);
        if (remark) {
            console.log(`   备注: ${remark}`);
        }
        
        res.json({ 
            success: true, 
            message: '用户信息更新成功'
        });
    } catch (err) {
        console.error('编辑用户失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// VIP 等级管理
// ==========================================

// 获取所有 VIP 等级
router.get('/vip-levels', checkAdmin, (req, res) => {
    const db = getDb();
    try {
        const levels = db.prepare('SELECT * FROM vip_levels ORDER BY level_order ASC').all();
        res.json({ success: true, data: levels });
    } catch (err) {
        console.error('获取VIP等级失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 创建或更新 VIP 等级
router.post('/vip-levels', checkAdmin, (req, res) => {
    const db = getDb();
    const { id, name, level, level_order, price, commission_rate, task_limit, daily_orders, min_balance, description } = req.body;
    const effectiveLevelOrder = Number.isFinite(+level_order) ? +level_order : (Number.isFinite(+level) ? +level : null);
    const effectiveLevel = Number.isFinite(+level) ? +level : (effectiveLevelOrder != null ? effectiveLevelOrder : null);
    const effectiveDailyOrders = Number.isFinite(+daily_orders) ? +daily_orders : (Number.isFinite(+task_limit) ? +task_limit : 0);
    const effectiveTaskLimit = Number.isFinite(+task_limit) ? +task_limit : effectiveDailyOrders;
    const effectiveMinBalance = Number.isFinite(+min_balance) ? +min_balance : (Number.isFinite(+price) ? +price : 0);
    const effectivePrice = Number.isFinite(+price) ? +price : effectiveMinBalance;
    
    try {
        if (id) {
            // 更新现有等级（同步 level/task_limit 供 task.js 使用）
            try {
                db.prepare(`UPDATE vip_levels SET name = ?, level_order = ?, level = ?, price = ?, commission_rate = ?, daily_orders = ?, task_limit = ?, min_balance = ?, description = ? WHERE id = ?`)
                    .run(name, effectiveLevelOrder, effectiveLevel, effectivePrice, commission_rate, effectiveDailyOrders, effectiveTaskLimit, effectiveMinBalance, description, id);
            } catch (e) {
                db.prepare(`UPDATE vip_levels SET name = ?, level_order = ?, commission_rate = ?, daily_orders = ?, min_balance = ?, description = ? WHERE id = ?`)
                    .run(name, effectiveLevelOrder, commission_rate, effectiveDailyOrders, effectiveMinBalance, description, id);
            }
            
            console.log(`✏️ 更新 VIP 等级: ${name} (ID:${id})`);
            res.json({ success: true, message: 'VIP等级更新成功' });
        } else {
            // 创建新等级（level=level_order, task_limit=daily_orders 供 task.js 使用）
            let result;
            try {
                result = db.prepare(`INSERT INTO vip_levels (name, level_order, level, price, commission_rate, daily_orders, task_limit, min_balance, description)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(name, effectiveLevelOrder, effectiveLevel, effectivePrice, commission_rate, effectiveDailyOrders, effectiveTaskLimit, effectiveMinBalance, description);
            } catch (e) {
                result = db.prepare(`INSERT INTO vip_levels (name, level_order, commission_rate, daily_orders, min_balance, description)
                    VALUES (?, ?, ?, ?, ?, ?)`).run(name, effectiveLevelOrder, commission_rate, effectiveDailyOrders, effectiveMinBalance, description);
            }
            console.log(`➕ 创建 VIP 等级: ${name} (Level:${effectiveLevelOrder})`);
            res.json({ success: true, message: 'VIP等级创建成功', data: { id: result.lastInsertRowid } });
        }
    } catch (err) {
        console.error('VIP等级操作失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 删除 VIP 等级
router.delete('/vip-levels/:id', checkAdmin, (req, res) => {
    const db = getDb();
    const levelId = req.params.id;
    
    try {
        // 检查是否有用户正在使用此等级
        const usersCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE vip_level = ?').get(levelId);
        if (usersCount && usersCount.count > 0) {
            return res.json({ 
                success: false, 
                message: `无法删除：有 ${usersCount.count} 个用户正在使用此等级` 
            });
        }
        
        db.prepare('DELETE FROM vip_levels WHERE id = ?').run(levelId);
        console.log(`🗑️ 删除 VIP 等级 (ID:${levelId})`);
        res.json({ success: true, message: 'VIP等级已删除' });
    } catch (err) {
        console.error('删除VIP等级失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 系统参数管理
// ==========================================

// 获取系统参数
router.get('/system-params', checkAdmin, (req, res) => {
    const db = getDb();
    try {
        const minRatio = db.prepare("SELECT value FROM settings WHERE key = 'match_min_ratio'").get();
        const maxRatio = db.prepare("SELECT value FROM settings WHERE key = 'match_max_ratio'").get();
        
        res.json({ 
            success: true, 
            data: {
                match_min_ratio: minRatio ? parseFloat(minRatio.value) : 0.1,
                match_max_ratio: maxRatio ? parseFloat(maxRatio.value) : 0.7
            }
        });
    } catch (err) {
        console.error('获取系统参数失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 更新系统参数
router.post('/system-params', checkAdmin, (req, res) => {
    const db = getDb();
    const { match_min_ratio, match_max_ratio } = req.body;
    
    try {
        if (match_min_ratio !== undefined) {
            db.prepare("UPDATE settings SET value = ? WHERE key = 'match_min_ratio'").run(match_min_ratio.toString());
        }
        if (match_max_ratio !== undefined) {
            db.prepare("UPDATE settings SET value = ? WHERE key = 'match_max_ratio'").run(match_max_ratio.toString());
        }
        
        console.log(`⚙️ 更新系统参数: Min=${match_min_ratio}, Max=${match_max_ratio}`);
        res.json({ success: true, message: '系统参数更新成功' });
    } catch (err) {
        console.error('更新系统参数失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 业务员（代理）管理
// ==========================================

// 获取业务员列表
router.get('/agents', checkAdmin, (req, res) => {
    const db = getDb();
    try {
        const sql = `
            SELECT 
                u.id, u.username, u.invite_code, u.created_at, u.status,
                (SELECT COUNT(*) FROM users WHERE referred_by = u.invite_code) as member_count,
                (SELECT IFNULL(SUM(balance), 0) FROM users WHERE referred_by = u.invite_code) as total_team_balance
            FROM users u 
            WHERE u.role = 'agent'
            ORDER BY u.created_at DESC
        `;
        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
        const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
        const total = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'agent'").get().c;
        const agentsPaginated = db.prepare(sql.trim() + ' LIMIT ? OFFSET ?').all(limit, offset);
        res.json({ success: true, data: { agents: agentsPaginated, pagination: { limit, offset, total } } });
    } catch (err) {
        console.error('获取业务员列表失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 创建业务员
router.post('/agent/create', checkAdmin, (req, res) => {
    const { username, password, remark } = req.body;
    
    if (!username || !password) {
        return res.json({ success: false, message: '用户名和密码不能为空' });
    }

    const db = getDb();
    try {
        // 检查用户名是否已存在
        const exist = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
        if (exist) {
            return res.json({ success: false, message: '用户名已存在' });
        }

        // 生成 6 位大写邀请码
        let inviteCode;
        let isUnique = false;
        while (!isUnique) {
            inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
            const codeCheck = db.prepare('SELECT id FROM users WHERE invite_code = ?').get(inviteCode);
            if (!codeCheck) isUnique = true;
        }

        // 加密密码
        const bcrypt = require('bcryptjs');
        const passwordHash = bcrypt.hashSync(password, 10);

        // 创建 agent 账户 (role='agent', vip_level=1, balance=0)
        const result = db.prepare(`
            INSERT INTO users (username, password_hash, invite_code, role, vip_level, balance, status, created_at)
            VALUES (?, ?, ?, 'agent', 1, 0, 'active', datetime('now'))
        `).run(username, passwordHash, inviteCode);

        console.log(`🤵 创建业务员: ${username} (ID:${result.lastInsertRowid}, 邀请码:${inviteCode})`);
        if (remark) {
            console.log(`   备注: ${remark}`);
        }

        res.json({ 
            success: true, 
            message: '业务员创建成功',
            data: { id: result.lastInsertRowid, username, invite_code: inviteCode }
        });
    } catch (err) {
        console.error('创建业务员失败:', err);
        res.status(500).json({ success: false, message: '数据库错误: ' + err.message });
    }
});

// 删除业务员
router.delete('/agents/:id', checkAdmin, (req, res) => {
    const db = getDb();
    const agentId = req.params.id;
    
    try {
        // 检查是否是业务员
        const agent = db.prepare('SELECT username, invite_code FROM users WHERE id = ? AND role = ?').get(agentId, 'agent');
        if (!agent) {
            return res.json({ success: false, message: '业务员不存在' });
        }
        
        // 检查是否有下级用户
        const memberCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE referred_by = ?').get(agent.invite_code);
        if (memberCount && memberCount.count > 0) {
            return res.json({ 
                success: false, 
                message: `无法删除：该业务员有 ${memberCount.count} 个下级用户` 
            });
        }
        
        // 删除业务员
        db.prepare('DELETE FROM users WHERE id = ?').run(agentId);
        console.log(`🗑️ 删除业务员: ${agent.username} (ID:${agentId})`);
        
        res.json({ success: true, message: '业务员已删除' });
    } catch (err) {
        console.error('删除业务员失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 切换业务员状态
router.post('/agents/:id/toggle-status', checkAdmin, (req, res) => {
    const db = getDb();
    const agentId = req.params.id;
    
    try {
        const agent = db.prepare('SELECT id, username, status FROM users WHERE id = ? AND role = ?').get(agentId, 'agent');
        if (!agent) {
            return res.status(404).json({ success: false, message: '业务员不存在' });
        }
        
        const newStatus = agent.status === 'active' ? 'banned' : 'active';
        db.prepare('UPDATE users SET status = ? WHERE id = ?').run(newStatus, agentId);
        
        console.log(`🔒 ${newStatus === 'banned' ? '冻结' : '解冻'}业务员: ${agent.username} (ID:${agentId})`);
        
        res.json({ 
            success: true, 
            message: `业务员已${newStatus === 'banned' ? '冻结' : '解冻'}`,
            data: { newStatus }
        });
    } catch (err) {
        console.error('切换业务员状态失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// IP 查看（登录日志）
// ==========================================
router.get('/login-logs', checkAdmin, (req, res) => {
    const db = getDb();
    const { limit = 100, offset = 0, user_id } = req.query;
    try {
        let sql = 'SELECT id, user_id, username, ip, user_agent, created_at FROM login_logs WHERE 1=1';
        const params = [];
        if (user_id) {
            sql += ' AND user_id = ?';
            params.push(user_id);
        }
        sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        const logs = db.prepare(sql).all(...params);
        const totalStmt = user_id
            ? db.prepare('SELECT COUNT(*) as count FROM login_logs WHERE user_id = ?')
            : db.prepare('SELECT COUNT(*) as count FROM login_logs');
        const total = user_id ? totalStmt.get(user_id) : totalStmt.get();
        res.json({
            success: true,
            data: {
                logs,
                pagination: { limit: parseInt(limit), offset: parseInt(offset), total: total.count }
            }
        });
    } catch (err) {
        console.error('获取登录日志失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 报表统计系统
// ==========================================

// 每日经营报表（过去30天）
router.get('/reports/daily', checkAdmin, (req, res) => {
    const db = getDb();
    
    try {
        // 生成过去30天的日期列表
        const dailyReports = [];
        for (let i = 29; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            
            // 统计新增用户
            const newUsers = db.prepare(`
                SELECT COUNT(*) as count 
                FROM users 
                WHERE date(created_at) = ? AND role = 'User'
            `).get(dateStr);
            
            // 统计充值总额（需要 deposits 表或从 transactions 表统计）
            let totalDeposit = 0;
            try {
                const depositResult = db.prepare(`
                    SELECT IFNULL(SUM(amount), 0) as total 
                    FROM transactions 
                    WHERE date(created_at) = ? AND type = 'deposit'
                `).get(dateStr);
                totalDeposit = depositResult ? depositResult.total : 0;
            } catch (e) {}
            
            // 统计提现总额
            let totalWithdraw = 0;
            try {
                const withdrawResult = db.prepare(`
                    SELECT IFNULL(SUM(amount), 0) as total 
                    FROM transactions 
                    WHERE date(created_at) = ? AND type = 'withdraw'
                `).get(dateStr);
                totalWithdraw = withdrawResult ? withdrawResult.total : 0;
            } catch (e) {}
            
            dailyReports.push({
                date: dateStr,
                new_users: newUsers.count,
                total_deposit: totalDeposit,
                total_withdraw: totalWithdraw,
                net_inflow: totalDeposit - totalWithdraw
            });
        }
        
        res.json({ success: true, data: dailyReports });
    } catch (err) {
        console.error('获取每日报表失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 全局账变流水记录
router.get('/transactions/all', checkAdmin, (req, res) => {
    const db = getDb();
    const { limit = 100, offset = 0 } = req.query;
    
    try {
        const transactions = db.prepare(`
            SELECT 
                t.id, 
                t.user_id, 
                t.type, 
                t.amount, 
                t.description, 
                t.created_at,
                u.username
            FROM transactions t
            LEFT JOIN users u ON t.user_id = u.id
            ORDER BY t.created_at DESC
            LIMIT ? OFFSET ?
        `).all(parseInt(limit), parseInt(offset));
        
        const total = db.prepare('SELECT COUNT(*) as count FROM transactions').get();
        
        res.json({ 
            success: true, 
            data: {
                transactions: transactions,
                pagination: {
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    total: total.count
                }
            }
        });
    } catch (err) {
        console.error('获取账变记录失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
