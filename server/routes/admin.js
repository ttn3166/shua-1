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
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
    fileFilter: (req, file, cb) => {
        const ok = /^image\/(jpeg|png|gif|webp|jpg)$/i.test(file.mimetype);
        cb(ok ? null : new Error('仅支持图片格式 (JPEG/PNG/GIF/WebP)'), ok);
    }
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

function writeAuditLog(db, actorId, action, entityType, entityId, reason, metadata) {
    try {
        db.prepare(
            'INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, reason, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime(\'now\'))'
        ).run(actorId, action, entityType || null, entityId != null ? entityId : null, reason || null, metadata ? JSON.stringify(metadata) : null);
    } catch (e) { console.warn('audit_log write skip:', e.message); }
}

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

    // 5. 帮助中心菜单默认项（用户端 Help Center 列表，可增删改）
    const defaultHelpCenterItems = JSON.stringify([
        { title: 'Invitation Rules', url: '/views/user/invitation_rules.html', icon: 'user-plus' },
        { title: 'VIP Rules', url: '/views/user/vip_rule.html', icon: 'star' },
        { title: 'FAQ', url: '/views/user/faq.html', icon: 'help' }
    ]);
    const helpCenterExists = db.prepare("SELECT value FROM settings WHERE key = 'help_center_items'").get();
    if (!helpCenterExists) {
        db.prepare("INSERT INTO settings (key, value, description) VALUES (?, ?, ?)").run(
            'help_center_items', defaultHelpCenterItems, '帮助中心菜单项 JSON 数组：[{title,url,icon}]，icon 可选: user-plus, star, help, info'
        );
        console.log('✅ 初始化 help_center_items（帮助中心菜单）');
    }
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

        // 近7日汇总（供首页快捷查看使用）
        let reg_7d = 0, deposit_7d = 0, withdraw_7d = 0, profit_7d = 0;
        try {
            reg_7d = db.prepare("SELECT COUNT(*) as c FROM users WHERE role='User' AND date(created_at) >= date('now','-7 days')").get().c || 0;
            deposit_7d = db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM deposits WHERE status='approved' AND date(created_at) >= date('now','-7 days')").get().t || 0;
            withdraw_7d = db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM withdrawals WHERE status IN ('approved','paid') AND date(created_at) >= date('now','-7 days')").get().t || 0;
            profit_7d = db.prepare("SELECT COALESCE(SUM(COALESCE(commission, amount*0.02)),0) as t FROM orders WHERE status='completed' AND date(created_at) >= date('now','-7 days')").get().t || 0;
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
function getUsersHandler(req, res) {
    const db = getDb();
    const {
        search, type,
        user_id, phone, username, login_ip, invite_code, vip_level, status,
        created_from, created_to, balance_min, balance_max, wallet_address,
        limit = 50, offset = 0,
        sort = 'id', order = 'desc',
        include_all_roles
    } = req.query;
    const allowedSort = { id: 'id', username: 'username', balance: 'balance', created_at: 'created_at', status: 'status' };
    const sortCol = allowedSort[String(sort).toLowerCase()] || 'id';
    const orderDir = (String(order).toLowerCase() === 'asc') ? 'ASC' : 'DESC';
    // 默认显示全部角色；仅当明确传 include_all_roles=0 或 false 时只显示普通用户
    const onlyUserRole = include_all_roles === '0' || include_all_roles === 'false';
    const userCols = db.prepare("PRAGMA table_info(users)").all().map(r => r.name);
    const hasRoleCol = userCols.includes('role');
    try {
        const baseCols = "id, username, balance, frozen_balance, wallet_address, security_password, invite_code, referred_by, allow_grab, task_progress, is_worker, vip_level, credit_score, allow_withdraw, status, created_at, phone, admin_remark";
        const selectCols = hasRoleCol ? baseCols.replace("username, ", "username, role, ") : baseCols;
        let sql = "SELECT " + selectCols + " FROM users WHERE 1=1";
        const params = [];
        if (hasRoleCol && onlyUserRole) {
            sql += " AND role = 'User'";
        }

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
        sql += " ORDER BY " + sortCol + " " + orderDir + " LIMIT ? OFFSET ?";
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
            role: hasRoleCol ? u.role : (u.role || 'User'),
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
}
router.get('/users', checkAdmin, getUsersHandler);

// 用户详情（单一路由，避免 /users/:id/detail 与 /users/export 等路径冲突；按 ID 查任意用户以支持管理员账户查看）
router.get('/user-detail/:id', checkAdmin, (req, res) => {
    const db = getDb();
    const userId = req.params.id;
    const orderLimit = Math.min(parseInt(req.query.order_limit, 10) || 20, 100);
    const txLimit = Math.min(parseInt(req.query.tx_limit, 10) || 20, 100);
    try {
        const user = db.prepare(
            'SELECT id, username, phone, balance, frozen_balance, invite_code, referred_by, status, allow_grab, task_progress, created_at, admin_remark FROM users WHERE id = ?'
        ).get(userId);
        if (!user) return res.status(404).json({ success: false, message: '用户不存在' });
        const orders = db.prepare(
            'SELECT id, order_no, amount, commission, status, source, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
        ).all(userId, orderLimit);
        let transactions = [];
        try {
            transactions = db.prepare(
                'SELECT id, type, amount, description, created_at FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
            ).all(userId, txLimit);
        } catch (txErr) { /* transactions 表可能不存在 */ }
        const pendingDeposits = db.prepare('SELECT COUNT(*) as c FROM deposits WHERE user_id = ? AND status = ?').get(userId, 'pending');
        const pendingWithdrawals = db.prepare('SELECT COUNT(*) as c FROM withdrawals WHERE user_id = ? AND status = ?').get(userId, 'pending');
        res.json({
            success: true,
            data: {
                user,
                orders,
                transactions,
                pending_deposits_count: pendingDeposits ? pendingDeposits.c : 0,
                pending_withdrawals_count: pendingWithdrawals ? pendingWithdrawals.c : 0
            }
        });
    } catch (err) {
        console.error('获取用户详情失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 单个用户的订单列表（分页，用于整页查询）
router.get('/users/:id/orders', checkAdmin, (req, res) => {
    const db = getDb();
    const userId = req.params.id;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    try {
        const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
        if (!user) return res.status(404).json({ success: false, message: '用户不存在' });
        const total = db.prepare('SELECT COUNT(*) as c FROM orders WHERE user_id = ?').get(userId).c;
        const orders = db.prepare(
            'SELECT id, order_no, amount, commission, status, source, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
        ).all(userId, limit, offset);
        res.json({ success: true, data: { user: { id: user.id, username: user.username }, orders, pagination: { limit, offset, total } } });
    } catch (err) {
        console.error('获取用户订单失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 用户详情（兼容旧路径；逻辑与 /user-detail/:id 一致）
router.get('/users/:id/detail', checkAdmin, (req, res) => {
    const db = getDb();
    const userId = req.params.id;
    const orderLimit = Math.min(parseInt(req.query.order_limit, 10) || 20, 100);
    const txLimit = Math.min(parseInt(req.query.tx_limit, 10) || 20, 100);
    try {
        const user = db.prepare(
            'SELECT id, username, phone, balance, frozen_balance, invite_code, referred_by, status, allow_grab, task_progress, created_at, admin_remark FROM users WHERE id = ?'
        ).get(userId);
        if (!user) return res.status(404).json({ success: false, message: '用户不存在' });
        const orders = db.prepare(
            'SELECT id, order_no, amount, commission, status, source, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
        ).all(userId, orderLimit);
        let transactions = [];
        try {
            transactions = db.prepare(
                'SELECT id, type, amount, description, created_at FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
            ).all(userId, txLimit);
        } catch (txErr) { /* transactions 表可能不存在 */ }
        const pendingDeposits = db.prepare('SELECT COUNT(*) as c FROM deposits WHERE user_id = ? AND status = ?').get(userId, 'pending');
        const pendingWithdrawals = db.prepare('SELECT COUNT(*) as c FROM withdrawals WHERE user_id = ? AND status = ?').get(userId, 'pending');
        res.json({
            success: true,
            data: {
                user,
                orders,
                transactions,
                pending_deposits_count: pendingDeposits ? pendingDeposits.c : 0,
                pending_withdrawals_count: pendingWithdrawals ? pendingWithdrawals.c : 0
            }
        });
    } catch (err) {
        console.error('获取用户详情失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 会员列表导出 CSV（与 GET /users 同筛选条件，不含密码等敏感字段）
router.get('/users/export', checkAdmin, (req, res) => {
    const db = getDb();
    const q = req.query;
    let sql = "SELECT id, username, phone, balance, frozen_balance, invite_code, referred_by, allow_grab, task_progress, status, created_at FROM users WHERE role = 'User'";
    const params = [];
    if (q.type === 'worker') { sql += " AND is_worker = 1"; } else if (q.type === 'real') { sql += " AND (is_worker = 0 OR is_worker IS NULL)"; }
    if (q.search) { sql += " AND (username LIKE ? OR CAST(id AS TEXT) LIKE ? OR invite_code LIKE ? OR COALESCE(phone,'') LIKE ?)"; params.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`, `%${q.search}%`); }
    if (q.user_id) { sql += " AND id = ?"; params.push(q.user_id); }
    if (q.phone) { sql += " AND (phone LIKE ? OR phone = ?)"; params.push(`%${q.phone}%`, q.phone); }
    if (q.username) { sql += " AND username LIKE ?"; params.push(`%${q.username}%`); }
    if (q.invite_code) { sql += " AND invite_code LIKE ?"; params.push(`%${q.invite_code}%`); }
    if (q.vip_level !== undefined && q.vip_level !== '') { sql += " AND vip_level = ?"; params.push(q.vip_level); }
    if (q.status) { sql += " AND status = ?"; params.push(q.status); }
    if (q.created_from) { sql += " AND date(created_at) >= date(?)"; params.push(q.created_from); }
    if (q.created_to) { sql += " AND date(created_at) <= date(?)"; params.push(q.created_to); }
    if (q.balance_min !== undefined && q.balance_min !== '') { sql += " AND balance >= ?"; params.push(parseFloat(q.balance_min)); }
    if (q.balance_max !== undefined && q.balance_max !== '') { sql += " AND balance <= ?"; params.push(parseFloat(q.balance_max)); }
    if (q.wallet_address) { sql += " AND wallet_address LIKE ?"; params.push(`%${q.wallet_address}%`); }
    if (q.login_ip) {
        const idsByIp = db.prepare("SELECT DISTINCT user_id FROM login_logs WHERE ip LIKE ?").all(`%${q.login_ip}%`);
        const ids = idsByIp.map(r => r.user_id);
        if (ids.length === 0) sql += " AND 1=0"; else { sql += " AND id IN (" + ids.map(() => '?').join(',') + ")"; params.push(...ids); }
    }
    sql += " ORDER BY id DESC LIMIT 10000";
    try {
        const users = db.prepare(sql).all(...params);
        const inviteCodeSet = [...new Set(users.map(u => u.invite_code).filter(Boolean))];
        let referrerMap = {};
        if (inviteCodeSet.length > 0) {
            const ph = inviteCodeSet.map(() => '?').join(',');
            db.prepare(`SELECT invite_code, username FROM users WHERE invite_code IN (${ph})`).all(...inviteCodeSet).forEach(r => { referrerMap[r.invite_code] = r.username; });
        }
        let teamMap = {};
        if (inviteCodeSet.length > 0) {
            const ph = inviteCodeSet.map(() => '?').join(',');
            db.prepare(`SELECT referred_by, COUNT(*) as count FROM users WHERE referred_by IN (${ph}) GROUP BY referred_by`).all(...inviteCodeSet).forEach(r => { teamMap[r.referred_by] = r.count; });
        }
        const header = 'ID,用户名,手机,余额,冻结,邀请码,推荐人,团队数,抢单,进度,状态,注册时间';
        const row = (u) => [
            u.id, u.username || '', u.phone || '', u.balance != null ? u.balance : '', u.frozen_balance != null ? u.frozen_balance : '',
            u.invite_code || '', (u.referred_by ? (referrerMap[u.referred_by] || u.referred_by) : ''), u.invite_code ? (teamMap[u.invite_code] || 0) : 0,
            u.allow_grab === 1 ? '开' : '关', u.task_progress != null ? u.task_progress : 0, u.status || '', u.created_at || ''
        ].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',');
        const csv = '\uFEFF' + header + '\n' + users.map(row).join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
        res.send(csv);
    } catch (err) {
        console.error('Export users error:', err);
        res.status(500).json({ success: false, message: '导出失败: ' + err.message });
    }
});

// 用户分层统计（数据分析 · 用户分析）
router.get('/users/segments', checkAdmin, (req, res) => {
    const db = getDb();
    try {
        const balanceRanges = [
            { label: '0', min: 0, max: 0 },
            { label: '0.01-10', min: 0.01, max: 10 },
            { label: '10-100', min: 10, max: 100 },
            { label: '100-500', min: 100, max: 500 },
            { label: '500+', min: 500, max: 1e9 }
        ];
        const segments = balanceRanges.map(r => {
            const row = db.prepare(
                "SELECT COUNT(*) as count FROM users WHERE role = 'User' AND balance >= ? AND balance < ?"
            ).get(r.min, r.max);
            return { range: r.label, count: row ? row.count : 0 };
        });
        const vipRows = db.prepare(
            "SELECT vip_level, COUNT(*) as count FROM users WHERE role = 'User' GROUP BY vip_level ORDER BY vip_level"
        ).all();
        const vipSegments = vipRows.map(r => ({ vip_level: r.vip_level, count: r.count }));
        const totalUsers = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'User'").get().c;
        res.json({ success: true, data: { balance_segments: segments, vip_segments: vipSegments, total_users: totalUsers } });
    } catch (err) {
        console.error('users/segments error:', err);
        res.status(500).json({ success: false, message: err.message || '获取分层失败' });
    }
});

// 高价值用户列表（数据分析 · 用户分析）
router.get('/users/top-value', checkAdmin, (req, res) => {
    const db = getDb();
    const limit = Math.min(100, Math.max(10, parseInt(req.query.limit, 10) || 20));
    const sort = String(req.query.sort || 'balance').toLowerCase();
    const days = parseInt(req.query.days, 10) || 0;
    const orderCol = { balance: 'u.balance', deposit: 'total_deposit', withdraw: 'total_withdraw', commission: 'total_commission' }[sort] || 'u.balance';
    try {
        let sql = `
            SELECT u.id, u.username, u.balance, u.vip_level, u.created_at,
                (SELECT IFNULL(SUM(amount),0) FROM deposits WHERE user_id = u.id AND status = 'approved') as total_deposit,
                (SELECT IFNULL(SUM(amount),0) FROM withdrawals WHERE user_id = u.id AND status IN ('approved','paid')) as total_withdraw,
                (SELECT IFNULL(SUM(amount),0) FROM transactions WHERE user_id = u.id AND type = 'task_commission') as total_commission
            FROM users u
            WHERE u.role = 'User'
        `;
        const params = [];
        if (days > 0) {
            sql += " AND u.created_at >= date('now', ?)";
            params.push('-' + days + ' days');
        }
        sql += ' ORDER BY ' + orderCol + ' DESC LIMIT ?';
        params.push(limit);
        try {
            const rows = db.prepare(sql).all(...params);
            res.json({ success: true, data: rows || [] });
        } catch (e) {
            // transactions 表可能不存在：降级返回（无 total_commission）
            let sql2 = `
                SELECT u.id, u.username, u.balance, u.vip_level, u.created_at,
                    (SELECT IFNULL(SUM(amount),0) FROM deposits WHERE user_id = u.id AND status = 'approved') as total_deposit,
                    (SELECT IFNULL(SUM(amount),0) FROM withdrawals WHERE user_id = u.id AND status IN ('approved','paid')) as total_withdraw,
                    0 as total_commission
                FROM users u
                WHERE u.role = 'User'
            `;
            const params2 = [];
            if (days > 0) {
                sql2 += " AND u.created_at >= date('now', ?)";
                params2.push('-' + days + ' days');
            }
            const safeOrder = (sort === 'deposit' ? 'total_deposit' : (sort === 'withdraw' ? 'total_withdraw' : 'u.balance'));
            sql2 += ' ORDER BY ' + safeOrder + ' DESC LIMIT ?';
            params2.push(limit);
            const rows2 = db.prepare(sql2).all(...params2);
            res.json({ success: true, data: rows2 || [] });
        }
    } catch (err) {
        console.error('users/top-value error:', err);
        res.status(500).json({ success: false, message: err.message || '获取列表失败' });
    }
});

// 修改当前管理员登录密码（需验证旧密码）
router.post('/change-password', checkAdmin, (req, res) => {
    const db = getDb();
    const bcrypt = require('bcryptjs');
    const { old_password, new_password } = req.body || {};
    if (!old_password || !new_password) return res.status(400).json({ success: false, message: '请填写旧密码和新密码' });
    if (String(new_password).length < 6) return res.status(400).json({ success: false, message: '新密码至少 6 位' });
    try {
        const row = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(req.user.id);
        if (!row) return res.status(401).json({ success: false, message: '用户不存在' });
        if (!bcrypt.compareSync(String(old_password), row.password_hash)) return res.status(400).json({ success: false, message: '旧密码错误' });
        const hash = bcrypt.hashSync(String(new_password), 10);
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
        writeAuditLog(db, req.user.id, 'change_password', 'user', req.user.id, null, {});
        res.json({ success: true, message: '密码已修改，请重新登录' });
    } catch (err) {
        console.error('Change password error:', err);
        res.status(500).json({ success: false, message: err.message || '修改失败' });
    }
});

// === 资金调节（统一使用此接口，无 PATCH /users/:id/balance）===
router.post('/adjust-balance', checkAdmin, (req, res) => {
    try {
        const { user_id, type, amount, remark } = req.body || {};
        const val = parseFloat(amount);

        if (!user_id || isNaN(val) || val <= 0) {
            return res.json({ success: false, message: '金额无效或未填写' });
        }
        if (!['add', 'deduct'].includes(type)) {
            return res.json({ success: false, message: '操作类型无效' });
        }

        const db = req.db || getDb();
        const user = db.prepare('SELECT id, balance, is_worker FROM users WHERE id = ?').get(user_id);
        if (!user) {
            return res.json({ success: false, message: '用户不存在' });
        }

        let newBalance = parseFloat(user.balance) || 0;
        if (type === 'add') {
            newBalance += val;
        } else {
            if (newBalance < val) {
                return res.json({ success: false, message: '用户余额不足' });
            }
            newBalance -= val;
        }

        const transAmount = type === 'add' ? val : -val;
        const transType = type === 'add' ? 'system_add' : 'system_deduct';
        const reason = (remark || 'Admin Adjustment').toString();
        const accountType = (user && Number(user.is_worker) === 1) ? 'worker' : 'formal';

        db.transaction(() => {
            db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(newBalance, user_id);
            db.prepare(`
                INSERT INTO transactions (user_id, type, amount, description, account_type, created_at)
                VALUES (?, ?, ?, ?, ?, datetime('now'))
            `).run(user_id, transType, transAmount, reason, accountType);
            try {
                db.prepare(`
                    INSERT INTO ledger (user_id, type, amount, reason, account_type, created_by, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
                `).run(user_id, 'admin_adjust', transAmount, reason, accountType, req.user.id);
            } catch (ledgerErr) {
                console.warn('Ledger insert skip:', ledgerErr.message);
            }
        })();
        writeAuditLog(db, req.user.id, 'adjust_balance', 'user', user_id, reason || null, { type, amount: val });
        res.json({ success: true, message: '调账成功' });
    } catch (e) {
        console.error('Adjust balance error:', e);
        res.status(500).json({ success: false, message: e.message || '数据库错误' });
    }
});

// 管理员账号列表（仅角色为 SuperAdmin/Admin/Finance/Support）
router.get('/admins', checkAdmin, (req, res) => {
    const db = getDb();
    try {
        const list = db.prepare(
            "SELECT id, username, role, status, created_at FROM users WHERE role IN ('SuperAdmin','Admin','Finance','Support') ORDER BY id ASC"
        ).all();
        res.json({ success: true, data: list });
    } catch (err) {
        console.error('Get admins error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

const ALLOWED_USER_STATUS = ['active', 'frozen', 'banned'];
router.patch('/users/:id/status', checkAdmin, (req, res) => {
    const db = getDb();
    const { status } = req.body;
    if (!status || !ALLOWED_USER_STATUS.includes(String(status))) {
        return res.status(400).json({ success: false, message: '状态值无效，仅允许: active, frozen, banned' });
    }
    try {
        db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, req.params.id);
        res.json({ success: true, message: '状态更新成功' });
    } catch (err) {
        const config = require('../config');
        res.status(500).json({ success: false, message: config.env === 'production' ? '操作失败' : err.message });
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

// 切换用户抢单状态（仅对 role=User 的会员生效；C 端抢单页 / 任务 match 会读取 allow_grab）
router.post('/users/:id/toggle-grab', checkAdmin, (req, res) => {
    const db = getDb();
    const userId = req.params.id;

    try {
        const user = db.prepare('SELECT id, username, role, allow_grab FROM users WHERE id = ?').get(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: '用户不存在' });
        }
        if (user.role !== 'User') {
            return res.status(400).json({ success: false, message: '仅可对会员开启/关闭抢单，当前用户不是会员' });
        }

        const newStatus = user.allow_grab === 1 ? 0 : 1;
        db.prepare('UPDATE users SET allow_grab = ? WHERE id = ?').run(newStatus, userId);
        writeAuditLog(db, req.user.id, 'user_toggle_grab', 'user', userId, null, { allow_grab: newStatus });
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

// 切换账户类型：正式 ⇄ 做单（仅 SuperAdmin，且仅对 role=User 的会员生效；改类型须记 audit_log）
router.post('/users/:id/toggle-account-type', checkAdmin, (req, res) => {
    if (req.user.role !== 'SuperAdmin') {
        return res.status(403).json({ success: false, message: '仅最高管理员可修改账户类型' });
    }
    const db = getDb();
    const userId = req.params.id;
    try {
        const user = db.prepare('SELECT id, username, role, is_worker FROM users WHERE id = ?').get(userId);
        if (!user) return res.status(404).json({ success: false, message: '用户不存在' });
        if (user.role !== 'User') return res.status(400).json({ success: false, message: '仅可对会员切换正式/做单类型' });
        const fromWorker = Number(user.is_worker) === 1;
        const toWorker = !fromWorker;
        const fromType = fromWorker ? 'worker' : 'formal';
        const toType = toWorker ? 'worker' : 'formal';
        db.prepare('UPDATE users SET is_worker = ? WHERE id = ?').run(toWorker ? 1 : 0, userId);
        writeAuditLog(db, req.user.id, 'toggle_account_type', 'user', userId, null, { from: fromType, to: toType });
        res.json({
            success: true,
            message: `已将 ${user.username} 设为${toWorker ? '做单' : '正式'}账户`,
            data: { is_worker: toWorker ? 1 : 0, account_type: toType }
        });
    } catch (err) {
        console.error('切换账户类型失败:', err);
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

        writeAuditLog(db, req.user.id, 'user_reset_progress', 'user', userId, null, { cancelled_orders: cancelledCount });
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
            return res.status(409).json({ success: false, message: '该用户名已存在' });
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
    const { user_id, id, username, status, date_from, date_to, amount_min, amount_max, account_type: accountTypeFilter, sort = 'created_at', order = 'desc' } = req.query;
    const allowedSort = { created_at: 'w.created_at', amount: 'w.amount', id: 'w.id' };
    const sortCol = allowedSort[String(sort).toLowerCase()] || 'w.created_at';
    const orderDir = (String(order).toLowerCase() === 'asc') ? 'ASC' : 'DESC';
    try {
        const conditions = [];
        const params = [];
        if (accountTypeFilter === 'formal' || accountTypeFilter === 'worker') {
            conditions.push('(COALESCE(w.account_type, (CASE WHEN u.is_worker = 1 THEN \'worker\' ELSE \'formal\' END)) = ?)');
            params.push(accountTypeFilter);
        }
        if (user_id != null && String(user_id).trim() !== '') {
            conditions.push('w.user_id = ?');
            params.push(parseInt(user_id, 10));
        }
        if (id != null && String(id).trim() !== '') {
            conditions.push('w.id = ?');
            params.push(parseInt(id, 10));
        }
        if (username != null && String(username).trim() !== '') {
            conditions.push('u.username LIKE ?');
            params.push('%' + String(username).trim() + '%');
        }
        if (status != null && String(status).trim() !== '' && ['pending', 'approved', 'paid', 'rejected'].includes(String(status).toLowerCase())) {
            conditions.push('w.status = ?');
            params.push(String(status).toLowerCase());
        }
        if (date_from != null && String(date_from).trim() !== '') {
            conditions.push("date(w.created_at) >= ?");
            params.push(String(date_from).trim());
        }
        if (date_to != null && String(date_to).trim() !== '') {
            conditions.push("date(w.created_at) <= ?");
            params.push(String(date_to).trim());
        }
        if (amount_min != null && String(amount_min).trim() !== '' && !isNaN(parseFloat(amount_min))) {
            conditions.push('w.amount >= ?');
            params.push(parseFloat(amount_min));
        }
        if (amount_max != null && String(amount_max).trim() !== '' && !isNaN(parseFloat(amount_max))) {
            conditions.push('w.amount <= ?');
            params.push(parseFloat(amount_max));
        }
        const whereClause = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
        const baseSql = 'FROM withdrawals w JOIN users u ON w.user_id = u.id' + whereClause;
        const total = db.prepare('SELECT COUNT(*) as c ' + baseSql).get(...params).c;
        const pendingCount = db.prepare("SELECT COUNT(*) as c FROM withdrawals WHERE status = 'pending'").get().c;
        const summary = db.prepare(
            'SELECT COUNT(*) as count_approved, IFNULL(SUM(amount), 0) as amount_approved FROM withdrawals w JOIN users u ON w.user_id = u.id' + whereClause + " AND w.status IN ('approved', 'paid')"
        ).get(...params);
        const withdrawals = db.prepare(`
            SELECT w.id, w.user_id, w.amount, w.wallet_address, w.status, w.account_type, w.created_at, u.username
            ${baseSql}
            ORDER BY ${sortCol} ${orderDir} LIMIT ? OFFSET ?
        `).all(...params, limit, offset);
        res.json({
            success: true,
            data: {
                withdrawals,
                pagination: { limit, offset, total },
                pending_count: pendingCount,
                summary: { total_count: total, approved_count: summary.count_approved, approved_amount: summary.amount_approved }
            }
        });
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
            let accountType = withdrawal.account_type;
            if (!accountType) {
                const u = db.prepare('SELECT is_worker FROM users WHERE id = ?').get(withdrawal.user_id);
                accountType = (u && Number(u.is_worker) === 1) ? 'worker' : 'formal';
            }
            
            if (action === 'approve') {
                // 提交提现时已扣款，此处仅更新状态并记流水，不再检查余额
                db.prepare("UPDATE withdrawals SET status = 'approved', reviewed_by = 1, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?").run(withdrawalId);
                db.prepare('INSERT INTO ledger (user_id, type, amount, reason, account_type, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(withdrawal.user_id, 'withdrawal', -withdrawal.amount, '提现审批通过', accountType, req.user.id);
                try {
                    db.prepare('INSERT INTO transactions (user_id, type, amount, description, account_type, created_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\'))').run(withdrawal.user_id, 'withdraw', -withdrawal.amount, '提现审批通过', accountType);
                } catch (txErr) { /* transactions 表可能不存在，忽略 */ }
            } else {
                db.prepare("UPDATE withdrawals SET status = 'rejected', note = ?, reviewed_by = 1, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?").run(reason || '管理员驳回', withdrawalId);
                db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(withdrawal.amount, withdrawal.user_id);
            }
        });
        tx();
        writeAuditLog(db, req.user.id, 'withdrawal_review', 'withdrawal', parseInt(req.params.id, 10), null, { action });
        res.json({ success: true, message: action === 'approve' ? '提现审批通过' : '提现申请已驳回' });
    } catch (err) {
        console.error('Review withdrawal error:', err);
        const config = require('../config');
        res.status(500).json({ success: false, message: config.env === 'production' ? '操作失败' : err.message });
    }
});

// 提现批量审批（仅总端）
router.post('/withdrawals/batch-review', checkAdmin, (req, res) => {
    const db = getDb();
    const { ids, action, reason } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ success: false, message: '请选择要处理的记录' });
    if (action !== 'approve' && action !== 'reject') return res.status(400).json({ success: false, message: 'action 为 approve 或 reject' });
    try {
        let done = 0, failed = 0;
        for (const id of ids.slice(0, 50)) {
            try {
                const withdrawal = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(id);
                if (!withdrawal || withdrawal.status !== 'pending') { failed++; continue; }
                let accountType = withdrawal.account_type;
                if (!accountType) {
                    const u = db.prepare('SELECT is_worker FROM users WHERE id = ?').get(withdrawal.user_id);
                    accountType = (u && Number(u.is_worker) === 1) ? 'worker' : 'formal';
                }
                if (action === 'approve') {
                    db.prepare("UPDATE withdrawals SET status = 'approved', reviewed_by = 1, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
                    db.prepare('INSERT INTO ledger (user_id, type, amount, reason, account_type, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(withdrawal.user_id, 'withdrawal', -withdrawal.amount, '提现审批通过', accountType, req.user.id);
                    try { db.prepare('INSERT INTO transactions (user_id, type, amount, description, account_type, created_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\'))').run(withdrawal.user_id, 'withdraw', -withdrawal.amount, '提现审批通过', accountType); } catch (e) {}
                } else {
                    db.prepare("UPDATE withdrawals SET status = 'rejected', note = ?, reviewed_by = 1, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?").run(reason || '管理员驳回', id);
                    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(withdrawal.amount, withdrawal.user_id);
                }
                writeAuditLog(db, req.user.id, 'withdrawal_review', 'withdrawal', id, null, { action });
                done++;
            } catch (e) { failed++; }
        }
        res.json({ success: true, message: `已处理 ${done} 条${failed ? `，跳过 ${failed} 条` : ''}` });
    } catch (err) {
        console.error('Batch withdrawal review error:', err);
        res.status(500).json({ success: false, message: err.message || '操作失败' });
    }
});

// 充值审批
router.get('/deposits', checkAdmin, (req, res) => {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 500);
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const { user_id, id, username, status, date_from, date_to, amount_min, amount_max, hash, account_type: accountTypeFilter, sort = 'created_at', order = 'desc' } = req.query;
    const allowedSort = { created_at: 'd.created_at', amount: 'd.amount', id: 'd.id' };
    const sortCol = allowedSort[String(sort).toLowerCase()] || 'd.created_at';
    const orderDir = (String(order).toLowerCase() === 'asc') ? 'ASC' : 'DESC';
    try {
        const conditions = [];
        const params = [];
        if (accountTypeFilter === 'formal' || accountTypeFilter === 'worker') {
            conditions.push('(COALESCE(d.account_type, (CASE WHEN u.is_worker = 1 THEN \'worker\' ELSE \'formal\' END)) = ?)');
            params.push(accountTypeFilter);
        }
        if (user_id != null && String(user_id).trim() !== '') {
            conditions.push('d.user_id = ?');
            params.push(parseInt(user_id, 10));
        }
        if (id != null && String(id).trim() !== '') {
            conditions.push('d.id = ?');
            params.push(parseInt(id, 10));
        }
        if (username != null && String(username).trim() !== '') {
            conditions.push('u.username LIKE ?');
            params.push('%' + String(username).trim() + '%');
        }
        if (status != null && String(status).trim() !== '' && ['pending', 'approved', 'rejected'].includes(String(status).toLowerCase())) {
            conditions.push('d.status = ?');
            params.push(String(status).toLowerCase());
        }
        if (date_from != null && String(date_from).trim() !== '') {
            conditions.push("date(d.created_at) >= ?");
            params.push(String(date_from).trim());
        }
        if (date_to != null && String(date_to).trim() !== '') {
            conditions.push("date(d.created_at) <= ?");
            params.push(String(date_to).trim());
        }
        if (amount_min != null && String(amount_min).trim() !== '' && !isNaN(parseFloat(amount_min))) {
            conditions.push('d.amount >= ?');
            params.push(parseFloat(amount_min));
        }
        if (amount_max != null && String(amount_max).trim() !== '' && !isNaN(parseFloat(amount_max))) {
            conditions.push('d.amount <= ?');
            params.push(parseFloat(amount_max));
        }
        if (hash != null && String(hash).trim() !== '') {
            conditions.push('(d.hash LIKE ? OR d.hash = ?)');
            const h = String(hash).trim();
            params.push('%' + h + '%', h);
        }
        const whereClause = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
        const baseSql = 'FROM deposits d JOIN users u ON d.user_id = u.id' + whereClause;
        const total = db.prepare('SELECT COUNT(*) as c ' + baseSql).get(...params).c;
        const pendingCount = db.prepare("SELECT COUNT(*) as c FROM deposits WHERE status = 'pending'").get().c;
        const summary = db.prepare(
            'SELECT COUNT(*) as count_approved, IFNULL(SUM(amount), 0) as amount_approved FROM deposits d JOIN users u ON d.user_id = u.id' + whereClause + " AND d.status = 'approved'"
        ).get(...params);
        const deposits = db.prepare(`
            SELECT d.id, d.user_id, d.amount, d.hash, d.screenshot_url, d.status, d.account_type, d.created_at, u.username
            ${baseSql}
            ORDER BY ${sortCol} ${orderDir} LIMIT ? OFFSET ?
        `).all(...params, limit, offset);
        res.json({
            success: true,
            data: {
                deposits,
                pagination: { limit, offset, total },
                pending_count: pendingCount,
                summary: { total_count: total, approved_count: summary.count_approved, approved_amount: summary.amount_approved }
            }
        });
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
            let accountType = deposit.account_type;
            if (!accountType) {
                const u = db.prepare('SELECT is_worker FROM users WHERE id = ?').get(deposit.user_id);
                accountType = (u && Number(u.is_worker) === 1) ? 'worker' : 'formal';
            }
            if (action === 'approve') {
                db.prepare("UPDATE deposits SET status = 'approved', reviewed_by = 1, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?").run(depositId);
                db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(deposit.amount, deposit.user_id);
                db.prepare('INSERT INTO ledger (user_id, type, amount, reason, account_type, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(deposit.user_id, 'deposit', deposit.amount, '充值审批通过', accountType, req.user.id);
                try {
                    db.prepare('INSERT INTO transactions (user_id, type, amount, description, account_type, created_at) VALUES (?, ?, ?, ?, ?, datetime("now"))').run(deposit.user_id, 'deposit', deposit.amount, '充值审批通过', accountType);
                } catch (txErr) { /* transactions 表可能不存在，忽略 */ }
            } else {
                db.prepare("UPDATE deposits SET status = 'rejected', note = ?, reviewed_by = 1, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?").run(reason || '管理员驳回', depositId);
            }
        });
        tx();
        writeAuditLog(db, req.user.id, 'deposit_review', 'deposit', parseInt(req.params.id, 10), null, { action });
        res.json({ success: true, message: action === 'approve' ? '充值审批通过' : '充值申请已驳回' });
    } catch (err) {
        console.error('Review deposit error:', err);
        const config = require('../config');
        res.status(500).json({ success: false, message: config.env === 'production' ? '操作失败' : err.message });
    }
});

// 充值批量审批（仅总端）
router.post('/deposits/batch-review', checkAdmin, (req, res) => {
    const db = getDb();
    const { ids, action, reason } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ success: false, message: '请选择要处理的记录' });
    if (action !== 'approve' && action !== 'reject') return res.status(400).json({ success: false, message: 'action 为 approve 或 reject' });
    try {
        let done = 0, failed = 0;
        for (const id of ids.slice(0, 50)) {
            try {
                const deposit = db.prepare('SELECT * FROM deposits WHERE id = ?').get(id);
                if (!deposit || deposit.status !== 'pending') { failed++; continue; }
                let accountType = deposit.account_type;
                if (!accountType) {
                    const u = db.prepare('SELECT is_worker FROM users WHERE id = ?').get(deposit.user_id);
                    accountType = (u && Number(u.is_worker) === 1) ? 'worker' : 'formal';
                }
                if (action === 'approve') {
                    db.prepare("UPDATE deposits SET status = 'approved', reviewed_by = 1, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
                    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(deposit.amount, deposit.user_id);
                    db.prepare('INSERT INTO ledger (user_id, type, amount, reason, account_type, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(deposit.user_id, 'deposit', deposit.amount, '充值审批通过', accountType, req.user.id);
                    try { db.prepare('INSERT INTO transactions (user_id, type, amount, description, account_type, created_at) VALUES (?, ?, ?, ?, ?, datetime("now"))').run(deposit.user_id, 'deposit', deposit.amount, '充值审批通过', accountType); } catch (e) {}
                } else {
                    db.prepare("UPDATE deposits SET status = 'rejected', note = ?, reviewed_by = 1, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?").run(reason || '管理员驳回', id);
                }
                writeAuditLog(db, req.user.id, 'deposit_review', 'deposit', id, null, { action });
                done++;
            } catch (e) { failed++; }
        }
        res.json({ success: true, message: `已处理 ${done} 条${failed ? `，跳过 ${failed} 条` : ''}` });
    } catch (err) {
        console.error('Batch deposit review error:', err);
        res.status(500).json({ success: false, message: err.message || '操作失败' });
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
        const q = req.query;
        const where = []; const params = [];
        if (q.keyword && String(q.keyword).trim()) { where.push('title LIKE ?'); params.push('%' + String(q.keyword).trim() + '%'); }
        if (q.price_min != null && String(q.price_min).trim() !== '' && !isNaN(parseFloat(q.price_min))) { where.push('price >= ?'); params.push(parseFloat(q.price_min)); }
        if (q.price_max != null && String(q.price_max).trim() !== '' && !isNaN(parseFloat(q.price_max))) { where.push('price <= ?'); params.push(parseFloat(q.price_max)); }
        if (q.vip_level != null && String(q.vip_level).trim() !== '') { where.push('vip_level = ?'); params.push(parseInt(q.vip_level, 10)); }
        const whereStr = where.length ? ' WHERE ' + where.join(' AND ') : '';
        const limit = Math.min(parseInt(q.limit, 10) || 20, 500);
        const offset = Math.max(0, parseInt(q.offset, 10) || 0);
        const sortCol = (q.sort === 'price' || q.sort === 'title' || q.sort === 'vip_level') ? q.sort : 'id';
        const sortOrder = (q.order === 'asc') ? 'ASC' : 'DESC';
        const orderBy = sortCol === 'id' ? 'id' : (sortCol === 'price' ? 'price' : (sortCol === 'title' ? 'title' : 'vip_level'));
        const total = db.prepare('SELECT COUNT(*) as c FROM products' + whereStr).get(...params).c;
        const products = db.prepare('SELECT * FROM products' + whereStr + ' ORDER BY ' + orderBy + ' ' + sortOrder + ' LIMIT ? OFFSET ?').all(...params, limit, offset);
        res.json({ success: true, data: { products, total, limit, offset } });
    } catch (err) {
        console.error('Load products error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 商品列表导出 CSV（仅总端，与列表同筛选条件，最多 10000 条）
router.get('/products/export', checkAdmin, (req, res) => {
    const db = getDb();
    const q = req.query;
    const where = []; const params = [];
    if (q.keyword && String(q.keyword).trim()) { where.push('title LIKE ?'); params.push('%' + String(q.keyword).trim() + '%'); }
    if (q.price_min != null && String(q.price_min).trim() !== '' && !isNaN(parseFloat(q.price_min))) { where.push('price >= ?'); params.push(parseFloat(q.price_min)); }
    if (q.price_max != null && String(q.price_max).trim() !== '' && !isNaN(parseFloat(q.price_max))) { where.push('price <= ?'); params.push(parseFloat(q.price_max)); }
    if (q.vip_level != null && String(q.vip_level).trim() !== '') { where.push('vip_level = ?'); params.push(parseInt(q.vip_level, 10)); }
    const whereStr = where.length ? ' WHERE ' + where.join(' AND ') : '';
    const limitNum = Math.min(parseInt(q.limit, 10) || 10000, 10000);
    try {
        const products = db.prepare('SELECT id, title, price, image, vip_level FROM products' + whereStr + ' ORDER BY id DESC LIMIT ?').all(...params, limitNum);
        const escapeCsv = (v) => (v == null ? '' : String(v).replace(/"/g, '""'));
        const header = 'ID,名称,价格,图片,VIP等级';
        const rows = products.map(p => [p.id, escapeCsv(p.title), p.price, escapeCsv(p.image), p.vip_level].join(','));
        const csv = '\uFEFF' + header + '\n' + rows.join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=products.csv');
        res.send(csv);
    } catch (err) {
        console.error('导出商品失败:', err);
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

// 下载商品批量导入模板（.xlsx，与导入接口要求一致）
router.get('/products/import-template', checkAdmin, (req, res) => {
    try {
        const ws = XLSX.utils.aoa_to_sheet([
            ['Name', 'Price', 'Image'],
            ['Sample Product', 50, 'https://placehold.co/100']
        ]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Disposition', 'attachment; filename="products-import-template.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buf);
    } catch (err) {
        console.error('Import template error:', err);
        res.status(500).json({ success: false, message: err.message || '生成模板失败' });
    }
});

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

// 商品批量改价/VIP
router.post('/products/batch-update', checkAdmin, (req, res) => {
    const db = getDb();
    const { ids, price, vip_level } = req.body || {};
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ success: false, message: '请选择要修改的商品' });
    }
    const updates = [];
    const params = [];
    if (price !== undefined && price !== null && price !== '' && !isNaN(parseFloat(price))) {
        updates.push('price = ?');
        params.push(parseFloat(price));
    }
    if (vip_level !== undefined && vip_level !== null && vip_level !== '' && !isNaN(parseInt(vip_level, 10))) {
        updates.push('vip_level = ?');
        params.push(parseInt(vip_level, 10));
    }
    if (updates.length === 0) {
        return res.status(400).json({ success: false, message: '请填写要修改的价格或VIP等级' });
    }
    try {
        const placeholders = ids.map(() => '?').join(',');
        const sql = `UPDATE products SET ${updates.join(', ')} WHERE id IN (${placeholders})`;
        const info = db.prepare(sql).run(...params, ...ids);
        return res.json({ success: true, message: '已更新 ' + info.changes + ' 件商品', updated: info.changes });
    } catch (err) {
        console.error('Batch update products error:', err);
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
// 5. VIP 等级管理（统一使用 /vip-levels；/vip 仅兼容只读。字段同步：level⇄level_order、price⇄min_balance、task_limit⇄daily_orders）
// ==========================================
router.get('/vip', checkAdmin, (req, res) => {
    const db = getDb();
    try {
        const cols = db.prepare("PRAGMA table_info(vip_levels)").all().map(c => c.name);
        const orderBy = cols.includes('level_order') ? 'level_order' : (cols.includes('level') ? 'level' : 'id');
        const levels = db.prepare('SELECT * FROM vip_levels ORDER BY ' + orderBy + ' ASC').all();
        return res.json({ success: true, data: { vips: levels } });
    } catch (err) {
        console.error('Load VIP (legacy):', err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

router.post('/vip', checkAdmin, (req, res) => {
    return res.status(410).json({ success: false, message: '此接口已废弃，请使用 POST /vip-levels' });
});

router.delete('/vip/:id', checkAdmin, (req, res) => {
    return res.status(410).json({ success: false, message: '此接口已废弃，请使用 DELETE /vip-levels/:id' });
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
        initSetting('referral_reward_amount', '5', '推荐奖励金额(USDT)，用户注册时推荐人获得');
        initSetting('level_1_commission_rate', '15', '一级返佣比例(%)，下级完成订单时一级推荐人获得');
        initSetting('level_2_commission_rate', '10', '二级返佣比例(%)，下级完成订单时二级推荐人获得');
        initSetting('level_3_commission_rate', '5', '三级返佣比例(%)，下级完成订单时三级推荐人获得');
        initSetting('withdraw_fee', '0', '提现手续费(%)');
        initSetting('withdraw_open', '1', '提现开关 (1开 0关)');
        initSetting('withdraw_min', '10', '最低提现金额(USDT)');
        initSetting('deposit_address', '', '充值收款地址(TRC20)');
        initSetting('deposit_channels', '[]', '充值方式列表JSON');
        initSetting('deposit_min_amount', '10', '最低充值金额(USDT)');
        initSetting('deposit_max_amount', '0', '单笔充值上限(USDT，0=不限制)');
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
        initSetting('terms_content', '', '用户协议/服务条款 HTML，留空则用户端显示默认英文');
        initSetting('privacy_content', '', '隐私政策 HTML，留空则用户端显示默认英文');
        initSetting('risk_disclaimer_content', '', '风险提示/免责声明 HTML，留空则用户端显示默认英文');
        initSetting('home_banner_1', 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=800', '首页Banner图1（URL或上传）');
        initSetting('home_banner_2', 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=800', '首页Banner图2（URL或上传）');
        initSetting('home_banner_3', 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=800', '首页Banner图3（URL或上传）');
        initSetting('finance_reminder_enabled', '1', '财务待审提醒总开关 1开0关');
        initSetting('finance_reminder_interval_sec', '45', '待审检测间隔（秒）');
        initSetting('finance_reminder_sound', '1', '有新待审时播放提示音 1开0关');
        initSetting('finance_reminder_toast', '1', '有新待审时弹出 Toast 提醒 1开0关');
        initSetting('maintenance_mode', '0', '全局维护模式(1=仅管理员可访问前台与API)');

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
    const { page = 1, limit = 50, referrer_username, referee_username, date_from, date_to } = req.query;
    try {
        const conditions = []; const params = [];
        try {
            const cols = db.prepare('PRAGMA table_info(referral_rewards)').all().map(r => r.name);
            if (referrer_username != null && String(referrer_username).trim() !== '') {
                if (cols.includes('referrer_username')) { conditions.push('referrer_username LIKE ?'); params.push('%' + String(referrer_username).trim() + '%'); }
            }
            if (referee_username != null && String(referee_username).trim() !== '') {
                if (cols.includes('referee_username')) { conditions.push('referee_username LIKE ?'); params.push('%' + String(referee_username).trim() + '%'); }
            }
            if (date_from != null && String(date_from).trim() !== '') { conditions.push("date(created_at) >= ?"); params.push(String(date_from).trim()); }
            if (date_to != null && String(date_to).trim() !== '') { conditions.push("date(created_at) <= ?"); params.push(String(date_to).trim()); }
        } catch (e) {}
        const whereClause = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
        const offset = ((parseInt(page, 10) || 1) - 1) * (parseInt(limit, 10) || 50);
        const limitNum = Math.min(parseInt(limit, 10) || 50, 500);
        const total = db.prepare('SELECT COUNT(*) as count FROM referral_rewards' + whereClause).get(...params).count;
        const rewards = db.prepare('SELECT * FROM referral_rewards' + whereClause + ' ORDER BY created_at DESC LIMIT ? OFFSET ?').all(...params, limitNum, offset);
        res.json({ success: true, data: { rewards, pagination: { page: parseInt(page) || 1, limit: limitNum, total } } });
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
        writeAuditLog(db, req.user.id, 'user_toggle_status', 'user', parseInt(userId, 10), null, { newStatus });
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
    const body = req.body || {};
    const password = body.password;
    const security_password = body.security_password;
    const vip_level = body.vip_level;
    const credit_score = body.credit_score;
    const allow_withdraw = body.allow_withdraw;
    const admin_remark = body.admin_remark !== undefined ? body.admin_remark : body.adminRemark;
    const remark = body.remark;
    
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
        
        // 管理端备注
        if (admin_remark !== undefined) {
            updates.push('admin_remark = ?');
            params.push(admin_remark == null || admin_remark === '' ? null : String(admin_remark).trim());
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
        writeAuditLog(db, req.user.id, 'user_edit', 'user', parseInt(userId, 10), remark || null, { fields: updates.length });
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
        const cols = db.prepare("PRAGMA table_info(vip_levels)").all().map(c => c.name);
        const orderBy = cols.includes('level_order') ? 'level_order' : (cols.includes('level') ? 'level' : 'id');
        const levels = db.prepare('SELECT * FROM vip_levels ORDER BY ' + orderBy + ' ASC').all();
        res.json({ success: true, data: levels });
    } catch (err) {
        console.error('获取VIP等级失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 创建或更新 VIP 等级（层级 level/level_order 唯一）
router.post('/vip-levels', checkAdmin, (req, res) => {
    const db = getDb();
    const actorId = (req.user && req.user.id) ? req.user.id : null;
    const { id, name, level, level_order, price, commission_rate, task_limit, daily_orders, min_balance, description } = req.body;
    const effectiveLevelOrder = Number.isFinite(+level_order) ? +level_order : (Number.isFinite(+level) ? +level : null);
    const effectiveLevel = Number.isFinite(+level) ? +level : (effectiveLevelOrder != null ? effectiveLevelOrder : null);
    const effectiveDailyOrders = Number.isFinite(+daily_orders) ? +daily_orders : (Number.isFinite(+task_limit) ? +task_limit : 0);
    const effectiveTaskLimit = Number.isFinite(+task_limit) ? +task_limit : effectiveDailyOrders;
    const effectiveMinBalance = Number.isFinite(+min_balance) ? +min_balance : (Number.isFinite(+price) ? +price : 0);
    const effectivePrice = Number.isFinite(+price) ? +price : effectiveMinBalance;
    const orderVal = effectiveLevelOrder != null ? effectiveLevelOrder : effectiveLevel;
    try {
        if (orderVal != null) {
            const cols = db.prepare("PRAGMA table_info(vip_levels)").all().map(c => c.name);
            const col = cols.includes('level_order') ? 'level_order' : 'level';
            const existing = db.prepare('SELECT id FROM vip_levels WHERE ' + col + ' = ?').all(orderVal);
            if (existing.length > 0 && (!id || String(existing[0].id) !== String(id))) {
                return res.status(400).json({ success: false, message: '层级已存在，请使用其他层级数值' });
            }
        }
        if (id) {
            try {
                db.prepare(`UPDATE vip_levels SET name = ?, level_order = ?, level = ?, price = ?, commission_rate = ?, daily_orders = ?, task_limit = ?, min_balance = ?, description = ? WHERE id = ?`)
                    .run(name, effectiveLevelOrder, effectiveLevel, effectivePrice, commission_rate, effectiveDailyOrders, effectiveTaskLimit, effectiveMinBalance, description, id);
            } catch (e) {
                db.prepare(`UPDATE vip_levels SET name = ?, level_order = ?, commission_rate = ?, daily_orders = ?, min_balance = ?, description = ? WHERE id = ?`)
                    .run(name, effectiveLevelOrder, commission_rate, effectiveDailyOrders, effectiveMinBalance, description, id);
            }
            writeAuditLog(db, actorId, 'update', 'vip_level', id, null, { name, level_order: effectiveLevelOrder });
            console.log('更新 VIP 等级: ' + name + ' (ID:' + id + ')');
            return res.json({ success: true, message: 'VIP等级更新成功' });
        }
        let result;
        try {
            result = db.prepare(`INSERT INTO vip_levels (name, level_order, level, price, commission_rate, daily_orders, task_limit, min_balance, description)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(name, effectiveLevelOrder, effectiveLevel, effectivePrice, commission_rate, effectiveDailyOrders, effectiveTaskLimit, effectiveMinBalance, description);
        } catch (e) {
            result = db.prepare(`INSERT INTO vip_levels (name, level_order, commission_rate, daily_orders, min_balance, description)
                VALUES (?, ?, ?, ?, ?, ?)`).run(name, effectiveLevelOrder, commission_rate, effectiveDailyOrders, effectiveMinBalance, description);
        }
        const newId = result.lastInsertRowid;
        writeAuditLog(db, actorId, 'create', 'vip_level', newId, null, { name, level_order: effectiveLevelOrder });
        console.log('创建 VIP 等级: ' + name + ' (Level:' + effectiveLevelOrder + ')');
        return res.json({ success: true, message: 'VIP等级创建成功', data: { id: newId } });
    } catch (err) {
        console.error('VIP等级操作失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 删除 VIP 等级
router.delete('/vip-levels/:id', checkAdmin, (req, res) => {
    const db = getDb();
    const levelId = req.params.id;
    const actorId = (req.user && req.user.id) ? req.user.id : null;
    try {
        const row = db.prepare('SELECT id, level, level_order, name FROM vip_levels WHERE id = ?').get(levelId);
        if (!row) {
            return res.status(404).json({ success: false, message: 'VIP等级不存在' });
        }
        const levelVal = row.level != null ? row.level : row.level_order;
        const usersCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE vip_level = ?').get(levelVal);
        if (usersCount && usersCount.count > 0) {
            return res.json({ success: false, message: '无法删除：有 ' + usersCount.count + ' 个用户正在使用此等级' });
        }
        db.prepare('DELETE FROM vip_levels WHERE id = ?').run(levelId);
        writeAuditLog(db, actorId, 'delete', 'vip_level', levelId, null, { name: row.name, level_order: levelVal });
        console.log('删除 VIP 等级 (ID:' + levelId + ')');
        res.json({ success: true, message: 'VIP等级已删除' });
    } catch (err) {
        console.error('删除VIP等级失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 系统参数管理
// ==========================================

// 获取系统参数（含做单比例与三级返佣比例）
router.get('/system-params', checkAdmin, (req, res) => {
    const db = getDb();
    try {
        const minRatio = db.prepare("SELECT value FROM settings WHERE key = 'match_min_ratio'").get();
        const maxRatio = db.prepare("SELECT value FROM settings WHERE key = 'match_max_ratio'").get();
        const l1 = db.prepare("SELECT value FROM settings WHERE key = 'level_1_commission_rate'").get();
        const l2 = db.prepare("SELECT value FROM settings WHERE key = 'level_2_commission_rate'").get();
        const l3 = db.prepare("SELECT value FROM settings WHERE key = 'level_3_commission_rate'").get();
        res.json({
            success: true,
            data: {
                match_min_ratio: minRatio ? parseFloat(minRatio.value) : 0.1,
                match_max_ratio: maxRatio ? parseFloat(maxRatio.value) : 0.7,
                level_1_commission_rate: l1 ? (l1.value != null ? parseFloat(l1.value) : 15) : 15,
                level_2_commission_rate: l2 ? (l2.value != null ? parseFloat(l2.value) : 10) : 10,
                level_3_commission_rate: l3 ? (l3.value != null ? parseFloat(l3.value) : 5) : 5
            }
        });
    } catch (err) {
        console.error('获取系统参数失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 更新系统参数（含做单比例与三级返佣比例）
router.post('/system-params', checkAdmin, (req, res) => {
    const db = getDb();
    const { match_min_ratio, match_max_ratio, level_1_commission_rate, level_2_commission_rate, level_3_commission_rate } = req.body;
    const config = require('../config');
    try {
        const upsert = (key, val, desc) => {
            if (val === undefined) return;
            db.prepare("INSERT INTO settings (key, value, description) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(val), desc);
        };
        upsert('match_min_ratio', match_min_ratio, '订单匹配最小比例');
        upsert('match_max_ratio', match_max_ratio, '订单匹配最大比例');
        upsert('level_1_commission_rate', level_1_commission_rate, '一级返佣比例(%)');
        upsert('level_2_commission_rate', level_2_commission_rate, '二级返佣比例(%)');
        upsert('level_3_commission_rate', level_3_commission_rate, '三级返佣比例(%)');
        res.json({ success: true, message: '系统参数更新成功' });
    } catch (err) {
        console.error('更新系统参数失败:', err);
        res.status(500).json({ success: false, message: config.env === 'production' ? '操作失败' : err.message });
    }
});

// ==========================================
// 业务员（代理）管理
// ==========================================

// 获取业务员列表
router.get('/agents', checkAdmin, (req, res) => {
    const db = getDb();
    const q = req.query;
    const where = ["u.role = 'Agent'"];
    const params = [];
    if (q.username && String(q.username).trim()) { where.push('u.username LIKE ?'); params.push('%' + String(q.username).trim() + '%'); }
    if (q.invite_code && String(q.invite_code).trim()) { where.push('u.invite_code LIKE ?'); params.push('%' + String(q.invite_code).trim() + '%'); }
    if (q.status && ['active','banned','frozen'].includes(String(q.status).toLowerCase())) { where.push('u.status = ?'); params.push(String(q.status).toLowerCase()); }
    const whereStr = ' WHERE ' + where.join(' AND ');
    try {
        const limit = Math.min(parseInt(q.limit, 10) || 50, 200);
        const offset = Math.max(0, parseInt(q.offset, 10) || 0);
        const total = db.prepare("SELECT COUNT(*) as c FROM users u" + whereStr).get(...params).c;
        const sql = "SELECT u.id, u.username, u.invite_code, u.created_at, u.status, u.agent_permissions, (SELECT COUNT(*) FROM users WHERE referred_by = u.invite_code) as member_count, (SELECT IFNULL(SUM(balance), 0) FROM users WHERE referred_by = u.invite_code) as total_team_balance FROM users u " + whereStr + " ORDER BY u.created_at DESC LIMIT ? OFFSET ?";
        const agentsPaginated = db.prepare(sql).all(...params, limit, offset);
        res.json({ success: true, data: { agents: agentsPaginated, pagination: { limit, offset, total } } });
    } catch (err) {
        console.error('获取业务员列表失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 创建代理（业务员）
router.post('/agent/create', checkAdmin, (req, res) => {
    const { username, password, remark, permissions } = req.body;
    
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

        const permList = Array.isArray(permissions) ? permissions : [];
        const agentPermissionsJson = permList.length ? JSON.stringify(permList) : null;

        // 创建代理账户 (role='Agent')，未传权限时默认全部权限
        const result = db.prepare(`
            INSERT INTO users (username, password_hash, invite_code, role, vip_level, balance, status, created_at, agent_permissions)
            VALUES (?, ?, ?, 'Agent', 1, 0, 'active', datetime('now'), ?)
        `).run(username, passwordHash, inviteCode, agentPermissionsJson || JSON.stringify(['view_team', 'view_stats', 'view_team_detail', 'view_deposit_withdraw', 'view_referral_rewards', 'view_team_orders', 'view_team_login']));

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
        const agent = db.prepare('SELECT username, invite_code FROM users WHERE id = ? AND role = ?').get(agentId, 'Agent');
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
        writeAuditLog(db, req.user.id, 'agent_delete', 'user', parseInt(agentId, 10), null, { username: agent.username });
        res.json({ success: true, message: '业务员已删除' });
    } catch (err) {
        console.error('删除业务员失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 更新代理权限
router.patch('/agents/:id', checkAdmin, (req, res) => {
    const db = getDb();
    const agentId = req.params.id;
    const { permissions } = req.body || {};
    try {
        const agent = db.prepare('SELECT id, username FROM users WHERE id = ? AND role = ?').get(agentId, 'Agent');
        if (!agent) {
            return res.status(404).json({ success: false, message: '代理不存在' });
        }
        const permList = Array.isArray(permissions) ? permissions : [];
        const agentPermissionsJson = permList.length ? JSON.stringify(permList) : null;
        db.prepare('UPDATE users SET agent_permissions = ? WHERE id = ?').run(agentPermissionsJson, agentId);
        res.json({ success: true, message: '权限已更新', data: { permissions: permList } });
    } catch (err) {
        console.error('更新代理权限失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 切换业务员状态
router.post('/agents/:id/toggle-status', checkAdmin, (req, res) => {
    const db = getDb();
    const agentId = req.params.id;
    
    try {
        const agent = db.prepare('SELECT id, username, status FROM users WHERE id = ? AND role = ?').get(agentId, 'Agent');
        if (!agent) {
            return res.status(404).json({ success: false, message: '业务员不存在' });
        }
        
        const newStatus = agent.status === 'active' ? 'banned' : 'active';
        db.prepare('UPDATE users SET status = ? WHERE id = ?').run(newStatus, agentId);
        
        console.log(`🔒 ${newStatus === 'banned' ? '冻结' : '解冻'}业务员: ${agent.username} (ID:${agentId})`);
        writeAuditLog(db, req.user.id, 'agent_toggle_status', 'user', parseInt(agentId, 10), null, { newStatus });
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
// 操作审计日志
// ==========================================
// 操作日志导出 CSV（与列表同筛选条件，最多 10000 条）
router.get('/audit-logs/export', checkAdmin, (req, res) => {
    const db = getDb();
    const q = req.query;
    const where = [];
    const params = [];
    if (q.actor_id && String(q.actor_id).trim()) { where.push('a.actor_id = ?'); params.push(parseInt(q.actor_id, 10)); }
    if (q.action && String(q.action).trim()) { where.push('a.action = ?'); params.push(String(q.action).trim()); }
    if (q.entity_type && String(q.entity_type).trim()) { where.push('a.entity_type = ?'); params.push(String(q.entity_type).trim()); }
    if (q.date_from && String(q.date_from).trim()) { where.push("date(a.created_at) >= ?"); params.push(String(q.date_from).trim()); }
    if (q.date_to && String(q.date_to).trim()) { where.push("date(a.created_at) <= ?"); params.push(String(q.date_to).trim()); }
    const whereStr = where.length ? ' WHERE ' + where.join(' AND ') : '';
    const limitNum = Math.min(parseInt(q.limit, 10) || 10000, 10000);
    try {
        const list = db.prepare(
            'SELECT a.id, a.actor_id, a.action, a.entity_type, a.entity_id, a.reason, a.metadata, a.created_at, u.username as actor_name FROM audit_logs a LEFT JOIN users u ON a.actor_id = u.id' + whereStr + ' ORDER BY a.created_at DESC LIMIT ?'
        ).all(...params, limitNum);
        const escapeCsv = (v) => (v == null ? '' : String(v).replace(/"/g, '""'));
        const header = 'ID,操作人ID,操作人,动作,对象类型,对象ID,备注,元数据,时间';
        const rows = list.map(a => [a.id, a.actor_id, escapeCsv(a.actor_name), escapeCsv(a.action), escapeCsv(a.entity_type), a.entity_id, escapeCsv(a.reason), escapeCsv(a.metadata), escapeCsv(a.created_at)].join(','));
        const csv = '\uFEFF' + header + '\n' + rows.join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=audit-logs.csv');
        res.send(csv);
    } catch (err) {
        console.error('导出操作日志失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

router.get('/audit-logs', checkAdmin, (req, res) => {
    const db = getDb();
    const q = req.query;
    const where = [];
    const params = [];
    if (q.actor_id && String(q.actor_id).trim()) { where.push('a.actor_id = ?'); params.push(parseInt(q.actor_id, 10)); }
    if (q.action && String(q.action).trim()) { where.push('a.action = ?'); params.push(String(q.action).trim()); }
    if (q.entity_type && String(q.entity_type).trim()) { where.push('a.entity_type = ?'); params.push(String(q.entity_type).trim()); }
    if (q.date_from && String(q.date_from).trim()) { where.push("date(a.created_at) >= ?"); params.push(String(q.date_from).trim()); }
    if (q.date_to && String(q.date_to).trim()) { where.push("date(a.created_at) <= ?"); params.push(String(q.date_to).trim()); }
    const whereStr = where.length ? ' WHERE ' + where.join(' AND ') : '';
    try {
        const limitNum = Math.min(parseInt(q.limit, 10) || 50, 500);
        const offsetNum = Math.max(0, parseInt(q.offset, 10) || 0);
        const total = db.prepare('SELECT COUNT(*) as count FROM audit_logs a' + whereStr).get(...params).count;
        const list = db.prepare(
            'SELECT a.id, a.actor_id, a.action, a.entity_type, a.entity_id, a.reason, a.metadata, a.created_at, u.username as actor_name FROM audit_logs a LEFT JOIN users u ON a.actor_id = u.id' + whereStr + ' ORDER BY a.created_at DESC LIMIT ? OFFSET ?'
        ).all(...params, limitNum, offsetNum);
        res.json({ success: true, data: { list, pagination: { limit: limitNum, offset: offsetNum, total } } });
    } catch (err) {
        console.error('获取操作日志失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// IP 查看（登录日志）
// ==========================================
router.get('/login-logs', checkAdmin, (req, res) => {
    const db = getDb();
    const { limit = 100, offset = 0, user_id, id, username, ip } = req.query;
    try {
        let whereClause = ' WHERE 1=1';
        const filterParams = [];
        if (id) {
            whereClause += ' AND id = ?';
            filterParams.push(id);
        }
        if (user_id) {
            whereClause += ' AND user_id = ?';
            filterParams.push(user_id);
        }
        if (username && String(username).trim()) {
            whereClause += ' AND username LIKE ?';
            filterParams.push('%' + String(username).trim() + '%');
        }
        if (ip && String(ip).trim()) {
            whereClause += ' AND ip LIKE ?';
            filterParams.push('%' + String(ip).trim() + '%');
        }
        const listSql = 'SELECT id, user_id, username, ip, user_agent, created_at FROM login_logs' + whereClause + ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        const logs = db.prepare(listSql).all(...filterParams, parseInt(limit), parseInt(offset));
        const total = db.prepare('SELECT COUNT(*) as count FROM login_logs' + whereClause).get(...filterParams);
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

// 登录日志导出 CSV（仅总端，与列表同筛选条件，最多 10000 条）
router.get('/login-logs/export', checkAdmin, (req, res) => {
    const db = getDb();
    const q = req.query;
    let whereClause = ' WHERE 1=1';
    const params = [];
    if (q.id) { whereClause += ' AND id = ?'; params.push(q.id); }
    if (q.user_id) { whereClause += ' AND user_id = ?'; params.push(q.user_id); }
    if (q.username && String(q.username).trim()) { whereClause += ' AND username LIKE ?'; params.push('%' + String(q.username).trim() + '%'); }
    if (q.ip && String(q.ip).trim()) { whereClause += ' AND ip LIKE ?'; params.push('%' + String(q.ip).trim() + '%'); }
    const limitNum = Math.min(parseInt(q.limit, 10) || 10000, 10000);
    try {
        const logs = db.prepare(
            'SELECT id, user_id, username, ip, user_agent, created_at FROM login_logs' + whereClause + ' ORDER BY created_at DESC LIMIT ?'
        ).all(...params, limitNum);
        const escapeCsv = (v) => (v == null ? '' : String(v).replace(/"/g, '""'));
        const header = 'ID,用户ID,用户名,IP,User-Agent,登录时间';
        const rows = logs.map(l => [l.id, l.user_id, escapeCsv(l.username), escapeCsv(l.ip), escapeCsv(l.user_agent), escapeCsv(l.created_at)].join(','));
        const csv = '\uFEFF' + header + '\n' + rows.join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=login-logs.csv');
        res.send(csv);
    } catch (err) {
        console.error('导出登录日志失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ==========================================
// 订单记录（抢单/订单列表）
// ==========================================
// 订单导出 CSV（与列表同筛选条件，最多 10000 条）
router.get('/orders/export', checkAdmin, (req, res) => {
    const db = getDb();
    const q = req.query;
    const where = ["o.user_id = u.id", "u.role = 'User'"];
    const params = [];
    if (q.user_id && String(q.user_id).trim()) { where.push('o.user_id = ?'); params.push(parseInt(q.user_id, 10)); }
    if (q.username && String(q.username).trim()) { where.push('u.username LIKE ?'); params.push('%' + String(q.username).trim() + '%'); }
    if (q.order_no && String(q.order_no).trim()) { where.push('o.order_no LIKE ?'); params.push('%' + String(q.order_no).trim() + '%'); }
    if (q.status && String(q.status).trim()) { where.push('o.status = ?'); params.push(String(q.status).trim()); }
    if (q.date_from && String(q.date_from).trim()) { where.push("date(o.created_at) >= ?"); params.push(String(q.date_from).trim()); }
    if (q.date_to && String(q.date_to).trim()) { where.push("date(o.created_at) <= ?"); params.push(String(q.date_to).trim()); }
    const whereStr = ' WHERE ' + where.join(' AND ');
    const baseSql = 'FROM orders o JOIN users u ON o.user_id = u.id' + whereStr;
    const limitNum = Math.min(parseInt(q.limit, 10) || 10000, 10000);
    try {
        const orders = db.prepare(
            'SELECT o.id, o.order_no, o.user_id, u.username, o.amount, o.commission, o.status, o.type, o.source, o.created_at ' + baseSql + ' ORDER BY o.created_at DESC LIMIT ?'
        ).all(...params, limitNum);
        const escapeCsv = (v) => (v == null ? '' : String(v).replace(/"/g, '""'));
        const header = 'ID,订单号,用户ID,用户名,金额,佣金,状态,类型,来源,创建时间';
        const rows = orders.map(o => [o.id, o.order_no, o.user_id, escapeCsv(o.username), o.amount, o.commission, escapeCsv(o.status), escapeCsv(o.type), escapeCsv(o.source), escapeCsv(o.created_at)].join(','));
        const csv = '\uFEFF' + header + '\n' + rows.join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=orders.csv');
        res.send(csv);
    } catch (err) {
        console.error('导出订单失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

router.get('/orders', checkAdmin, (req, res) => {
    try {
        const db = getDb();
        const q = req.query;
        const where = ['o.user_id = u.id'];
        const params = [];
        try {
            const hasRole = db.prepare("PRAGMA table_info(users)").all().some(r => r.name === 'role');
            if (hasRole) where.push("u.role = 'User'");
        } catch (_) {}
        if (q.user_id && String(q.user_id).trim()) { where.push('o.user_id = ?'); params.push(parseInt(q.user_id, 10)); }
        if (q.username && String(q.username).trim()) { where.push('u.username LIKE ?'); params.push('%' + String(q.username).trim() + '%'); }
        if (q.order_no && String(q.order_no).trim()) { where.push('o.order_no LIKE ?'); params.push('%' + String(q.order_no).trim() + '%'); }
        if (q.status && String(q.status).trim()) { where.push('o.status = ?'); params.push(String(q.status).trim()); }
        if (q.date_from && String(q.date_from).trim()) { where.push("date(o.created_at) >= ?"); params.push(String(q.date_from).trim()); }
        if (q.date_to && String(q.date_to).trim()) { where.push("date(o.created_at) <= ?"); params.push(String(q.date_to).trim()); }
        const whereStr = ' WHERE ' + where.join(' AND ');
        const baseSql = 'FROM orders o JOIN users u ON o.user_id = u.id' + whereStr;
        const limitNum = Math.min(parseInt(q.limit, 10) || 20, 500);
        const offsetNum = Math.max(0, parseInt(q.offset, 10) || 0);
        const sortCol = (q.sort === 'amount' || q.sort === 'id') ? q.sort : 'created_at';
        const sortOrder = (q.order === 'asc') ? 'ASC' : 'DESC';
        const orderBy = sortCol === 'created_at' ? 'o.created_at' : (sortCol === 'amount' ? 'o.amount' : 'o.id');
        const orderCols = 'o.id, o.order_no, o.user_id, u.username, o.amount, o.commission, o.status, o.type, o.created_at';
        const hasSource = db.prepare("PRAGMA table_info(orders)").all().some(r => r.name === 'source');
        const selectCols = hasSource ? orderCols.replace('o.created_at', 'o.source, o.created_at') : orderCols;
        const total = db.prepare('SELECT COUNT(*) as count ' + baseSql).get(...params).count;
        const orders = db.prepare(
            'SELECT ' + selectCols + ' ' + baseSql + ' ORDER BY ' + orderBy + ' ' + sortOrder + ' LIMIT ? OFFSET ?'
        ).all(...params, limitNum, offsetNum);
        const rows = orders.map(o => ({ ...o, source: o.source != null ? o.source : '' }));
        res.json({ success: true, data: { orders: rows, pagination: { limit: limitNum, offset: offsetNum, total } } });
    } catch (err) {
        console.error('获取订单列表失败:', err);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: err.message || '获取订单列表失败' });
        }
    }
});

// 订单状态数量（用于筛选旁展示）
router.get('/orders/status-counts', checkAdmin, (req, res) => {
    const db = getDb();
    try {
        const rows = db.prepare(
            "SELECT status, COUNT(*) as count FROM orders GROUP BY status"
        ).all();
        const counts = { pending: 0, completed: 0, cancelled: 0 };
        rows.forEach(r => { counts[r.status] = r.count; });
        res.json({ success: true, data: counts });
    } catch (err) {
        res.json({ success: true, data: { pending: 0, completed: 0, cancelled: 0 } });
    }
});

// ==========================================
// 报表统计系统
// ==========================================

// 每日经营报表（支持 days=7|30|90，默认 30）
router.get('/reports/daily', checkAdmin, (req, res) => {
    const db = getDb();
    const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 30));
    try {
        const dailyReports = [];
        for (let i = days - 1; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            
            // 统计新增用户
            const newUsers = db.prepare(`
                SELECT COUNT(*) as count 
                FROM users 
                WHERE date(created_at) = ? AND role = 'User'
            `).get(dateStr);
            
            // 统计充值总额（从 deposits 表，已审批通过的）
            let totalDeposit = 0;
            try {
                const depositResult = db.prepare(`
                    SELECT IFNULL(SUM(amount), 0) as total 
                    FROM deposits 
                    WHERE date(created_at) = ? AND status = 'approved'
                `).get(dateStr);
                totalDeposit = depositResult ? depositResult.total : 0;
            } catch (e) {}
            
            // 统计提现总额（从 withdrawals 表，已通过/已打款）
            let totalWithdraw = 0;
            try {
                const withdrawResult = db.prepare(`
                    SELECT IFNULL(SUM(amount), 0) as total 
                    FROM withdrawals 
                    WHERE date(created_at) = ? AND status IN ('approved', 'paid')
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

// 业务员报表：按日期+业务员汇总（申请提现/提现/充值/抢单/注册等）
// 同时支持 /salesperson-report 与 /reports/salesperson，避免代理或路径差异导致 404
function handleSalespersonReport(req, res) {
    const db = getDb();
    const q = req.query;
    const agentId = q.agent_id ? parseInt(q.agent_id, 10) : null;
    const dateFrom = (q.date_from && String(q.date_from).trim()) || null;
    const dateTo = (q.date_to && String(q.date_to).trim()) || null;
    const page = Math.max(1, parseInt(q.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(10, parseInt(q.pageSize, 10) || 20));
    try {
        // 业务员列表（仅 Agent 角色，可选单个）
        let agents = [];
        if (agentId) {
            const one = db.prepare("SELECT id, username, invite_code FROM users WHERE id = ? AND role = 'Agent'").get(agentId);
            if (one) agents = [one];
        } else {
            agents = db.prepare("SELECT id, username, invite_code FROM users WHERE role = 'Agent' ORDER BY username").all();
        }
        if (!agents.length) {
            return res.json({ success: true, data: { summary: makeSalespersonSummary(null), list: [], pagination: { page: 1, pageSize, total: 0 } } });
        }

        // 日期范围：默认近 30 天
        let startDate = dateFrom;
        let endDate = dateTo;
        if (!startDate || !endDate) {
            const end = new Date();
            const start = new Date();
            start.setDate(start.getDate() - 29);
            if (!endDate) endDate = end.toISOString().split('T')[0];
            if (!startDate) startDate = start.toISOString().split('T')[0];
        }

        const list = [];
        for (const agent of agents) {
            const teamIds = db.prepare("SELECT id FROM users WHERE referred_by = ?").all(agent.invite_code).map(r => r.id);
            const teamPh = teamIds.length ? teamIds.map(() => '?').join(',') : '';
            const d = new Date(startDate);
            const end = new Date(endDate);
            while (d <= end) {
                const dateStr = d.toISOString().split('T')[0];
                let apply_withdraw_amount = 0, apply_withdraw_count = 0, withdraw_count = 0, withdraw_amount = 0, manual_withdraw_amount = 0, manual_withdraw_fee = 0;
                let deposit_amount = 0, deposit_count = 0, manual_deposit_amount = 0;
                let grab_count = 0, grab_users = 0, reg_count = 0;

                if (teamIds.length) {
                    try {
                        const applyWd = db.prepare(
                            "SELECT COUNT(*) as c, COALESCE(SUM(amount),0) as s FROM withdrawals WHERE user_id IN (" + teamPh + ") AND date(created_at) = ?"
                        ).get(...teamIds, dateStr);
                        apply_withdraw_amount = applyWd ? applyWd.s : 0;
                        apply_withdraw_count = applyWd ? applyWd.c : 0;
                        const paidWd = db.prepare(
                            "SELECT COUNT(*) as c, COALESCE(SUM(amount),0) as s FROM withdrawals WHERE user_id IN (" + teamPh + ") AND date(created_at) = ? AND status IN ('approved','paid')"
                        ).get(...teamIds, dateStr);
                        withdraw_count = paidWd ? paidWd.c : 0;
                        withdraw_amount = paidWd ? paidWd.s : 0;
                    } catch (e) {}
                    try {
                        const dep = db.prepare(
                            "SELECT COUNT(*) as c, COALESCE(SUM(amount),0) as s FROM deposits WHERE user_id IN (" + teamPh + ") AND date(created_at) = ? AND status = 'approved'"
                        ).get(...teamIds, dateStr);
                        deposit_count = dep ? dep.c : 0;
                        deposit_amount = dep ? dep.s : 0;
                    } catch (e) {}
                    try {
                        reg_count = db.prepare(
                            "SELECT COUNT(*) as c FROM users WHERE referred_by = ? AND date(created_at) = ?"
                        ).get(agent.invite_code, dateStr).c || 0;
                    } catch (e) {}
                    try {
                        const grabRows = db.prepare(
                            "SELECT COUNT(*) as c, COUNT(DISTINCT user_id) as u FROM orders WHERE user_id IN (" + teamPh + ") AND date(created_at) = ?"
                        ).get(...teamIds, dateStr);
                        grab_count = grabRows ? grabRows.c : 0;
                        grab_users = grabRows ? grabRows.u : 0;
                    } catch (e) {}
                }
                list.push({
                    date: dateStr,
                    agent_id: agent.id,
                    agent_name: agent.username,
                    supervisor: '-',
                    apply_withdraw_amount,
                    apply_withdraw_count,
                    withdraw_count,
                    withdraw_amount,
                    manual_withdraw_amount,
                    manual_withdraw_fee,
                    deposit_amount,
                    deposit_count,
                    manual_deposit_amount,
                    grab_count,
                    grab_users,
                    reg_count,
                    updated_at: dateStr + ' 00:00'
                });
                d.setDate(d.getDate() + 1);
            }
        }
        // 按日期、业务员排序
        list.sort((a, b) => (a.date + a.agent_name).localeCompare(b.date + b.agent_name));

        const total = list.length;
        const start = (page - 1) * pageSize;
        const pagedList = list.slice(start, start + pageSize);

        // 汇总（当前筛选条件下所有行的合计）
        const summary = {
            apply_withdraw_amount: list.reduce((s, r) => s + Number(r.apply_withdraw_amount), 0),
            apply_withdraw_count: list.reduce((s, r) => s + Number(r.apply_withdraw_count || 0), 0),
            withdraw_amount: list.reduce((s, r) => s + Number(r.withdraw_amount), 0),
            manual_withdraw_amount: list.reduce((s, r) => s + Number(r.manual_withdraw_amount), 0),
            manual_withdraw_fee: list.reduce((s, r) => s + Number(r.manual_withdraw_fee), 0),
            deposit_amount: list.reduce((s, r) => s + Number(r.deposit_amount), 0),
            deposit_count: list.reduce((s, r) => s + Number(r.deposit_count), 0),
            manual_deposit_amount: list.reduce((s, r) => s + Number(r.manual_deposit_amount), 0)
        };
        res.json({
            success: true,
            data: {
                summary: {
                    apply_withdraw_amount: summary.apply_withdraw_amount,
                    apply_withdraw_count: summary.apply_withdraw_count,
                    withdraw_amount: summary.withdraw_amount,
                    manual_withdraw_amount: summary.manual_withdraw_amount,
                    manual_withdraw_fee: summary.manual_withdraw_fee,
                    deposit_amount: summary.deposit_amount,
                    deposit_count: summary.deposit_count,
                    manual_deposit_amount: summary.manual_deposit_amount
                },
                list: pagedList,
                pagination: { page, pageSize, total }
            }
        });
    } catch (err) {
        console.error('业务员报表失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
}
router.get('/reports/salesperson', checkAdmin, handleSalespersonReport);
router.get('/salesperson-report', checkAdmin, handleSalespersonReport);

function makeSalespersonSummary(nullVal) {
    return {
        apply_withdraw_amount: 0,
        apply_withdraw_count: 0,
        withdraw_amount: 0,
        manual_withdraw_amount: 0,
        manual_withdraw_fee: 0,
        deposit_amount: 0,
        deposit_count: 0,
        manual_deposit_amount: 0
    };
}

// 全局账变流水记录（支持 account_type: all|formal|worker）
router.get('/transactions/all', checkAdmin, (req, res) => {
    const db = getDb();
    const q = req.query;
    const where = []; const params = [];
    if (q.account_type === 'formal' || q.account_type === 'worker') {
        where.push('(COALESCE(t.account_type, (CASE WHEN u.is_worker = 1 THEN \'worker\' ELSE \'formal\' END)) = ?)');
        params.push(q.account_type);
    }
    if (q.user_id && String(q.user_id).trim()) { where.push('t.user_id = ?'); params.push(parseInt(q.user_id, 10)); }
    if (q.username && String(q.username).trim()) { where.push('u.username LIKE ?'); params.push('%' + String(q.username).trim() + '%'); }
    if (q.type && String(q.type).trim()) { where.push('t.type = ?'); params.push(String(q.type).trim()); }
    if (q.date_from && String(q.date_from).trim()) { where.push("date(t.created_at) >= ?"); params.push(String(q.date_from).trim()); }
    if (q.date_to && String(q.date_to).trim()) { where.push("date(t.created_at) <= ?"); params.push(String(q.date_to).trim()); }
    const whereStr = where.length ? ' WHERE ' + where.join(' AND ') : '';
    const baseSql = 'FROM transactions t LEFT JOIN users u ON t.user_id = u.id' + whereStr;
    try {
        const limitNum = Math.min(parseInt(q.limit, 10) || 100, 500);
        const offsetNum = Math.max(0, parseInt(q.offset, 10) || 0);
        const total = db.prepare('SELECT COUNT(*) as count ' + baseSql).get(...params).count;
        const transactions = db.prepare('SELECT t.id, t.user_id, t.type, t.amount, t.description, t.account_type, t.created_at, u.username ' + baseSql + ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?').all(...params, limitNum, offsetNum);
        res.json({ success: true, data: { transactions, pagination: { limit: limitNum, offset: offsetNum, total } } });
    } catch (err) {
        console.error('获取账变记录失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 资金流水导出 CSV（仅总端，与 /transactions/all 同筛选条件，最多 10000 条）
router.get('/transactions/export', checkAdmin, (req, res) => {
    const db = getDb();
    const q = req.query;
    const where = []; const params = [];
    if (q.account_type === 'formal' || q.account_type === 'worker') {
        where.push('(COALESCE(t.account_type, (CASE WHEN u.is_worker = 1 THEN \'worker\' ELSE \'formal\' END)) = ?)');
        params.push(q.account_type);
    }
    if (q.user_id && String(q.user_id).trim()) { where.push('t.user_id = ?'); params.push(parseInt(q.user_id, 10)); }
    if (q.username && String(q.username).trim()) { where.push('u.username LIKE ?'); params.push('%' + String(q.username).trim() + '%'); }
    if (q.type && String(q.type).trim()) { where.push('t.type = ?'); params.push(String(q.type).trim()); }
    if (q.date_from && String(q.date_from).trim()) { where.push("date(t.created_at) >= ?"); params.push(String(q.date_from).trim()); }
    if (q.date_to && String(q.date_to).trim()) { where.push("date(t.created_at) <= ?"); params.push(String(q.date_to).trim()); }
    const whereStr = where.length ? ' WHERE ' + where.join(' AND ') : '';
    const baseSql = 'FROM transactions t LEFT JOIN users u ON t.user_id = u.id' + whereStr;
    const limitNum = Math.min(parseInt(q.limit, 10) || 10000, 10000);
    try {
        const transactions = db.prepare(
            'SELECT t.id, t.user_id, t.type, t.amount, t.description, t.account_type, t.created_at, u.username ' + baseSql + ' ORDER BY t.created_at DESC LIMIT ?'
        ).all(...params, limitNum);
        const escapeCsv = (v) => (v == null ? '' : String(v).replace(/"/g, '""'));
        const header = 'ID,用户ID,用户名,类型,账户类型,金额,说明,创建时间';
        const rows = transactions.map(t => [t.id, t.user_id, escapeCsv(t.username), escapeCsv(t.type), (t.account_type === 'worker' ? '做单' : '正式'), t.amount, escapeCsv(t.description), escapeCsv(t.created_at)].join(','));
        const csv = '\uFEFF' + header + '\n' + rows.join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=transactions.csv');
        res.send(csv);
    } catch (err) {
        console.error('导出流水失败:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 数据分析：多维度报表
router.get('/reports/multi', checkAdmin, (req, res) => {
    const db = getDb();
    const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 30));
    try {
        const rows = [];
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            const newUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE date(created_at) = ? AND role = 'User'").get(dateStr);
            const dep = db.prepare("SELECT IFNULL(SUM(amount),0) as total FROM deposits WHERE date(created_at) = ? AND status = 'approved'").get(dateStr);
            const wd = db.prepare("SELECT IFNULL(SUM(amount),0) as total FROM withdrawals WHERE date(created_at) = ? AND status IN ('approved','paid')").get(dateStr);
            const ord = db.prepare("SELECT COUNT(*) as c, IFNULL(SUM(CASE WHEN status = 'completed' THEN commission ELSE 0 END),0) as commission FROM orders WHERE date(created_at) = ?").get(dateStr);
            rows.push({
                date: dateStr,
                new_users: newUsers ? newUsers.count : 0,
                total_deposit: dep ? dep.total : 0,
                total_withdraw: wd ? wd.total : 0,
                net_inflow: (dep ? dep.total : 0) - (wd ? wd.total : 0),
                orders_count: ord ? ord.c : 0,
                orders_commission: ord ? ord.commission : 0
            });
        }
        res.json({ success: true, data: { rows, compare_prev: null } });
    } catch (err) {
        console.error('reports/multi error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// 数据分析：邀请汇总
router.get('/reports/invite-summary', checkAdmin, (req, res) => {
    const db = getDb();
    const dateFrom = (req.query.date_from || '').trim();
    const dateTo = (req.query.date_to || '').trim();
    try {
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

// 数据分析：流水汇总
router.get('/reports/finance-summary', checkAdmin, (req, res) => {
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

// 数据分析：简单对账
router.get('/reports/balance-check', checkAdmin, (req, res) => {
    const db = getDb();
    try {
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

module.exports = router;
module.exports.getUsersHandler = getUsersHandler;