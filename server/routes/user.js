/**
 * C端用户路由
 * 已废弃且未保留的接口：GET /balance（由 /me 替代）、GET /tasks、GET /my-tasks（旧任务系统）
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { success, error } = require('../utils/response');

const router = express.Router();

// === 数据库自动修复脚本 ===
const dbInstance = require('../db').getDb();
try {
    const columns = dbInstance.prepare("PRAGMA table_info(users)").all();
    
    // 1. 补全 wallet_address (钱包地址)
    if (!columns.some(c => c.name === 'wallet_address')) {
        dbInstance.prepare("ALTER TABLE users ADD COLUMN wallet_address TEXT DEFAULT NULL").run();
        console.log("✅ 成功添加 wallet_address 字段");
    }
    
    // 2. 补全 security_password (资金密码) - 为下一步做准备
    if (!columns.some(c => c.name === 'security_password')) {
        dbInstance.prepare("ALTER TABLE users ADD COLUMN security_password TEXT DEFAULT NULL").run();
        console.log("✅ 成功添加 security_password 字段");
    }
    
    // 3. 补全 invite_code (邀请码)
    if (!columns.some(c => c.name === 'invite_code')) {
        dbInstance.prepare("ALTER TABLE users ADD COLUMN invite_code TEXT DEFAULT NULL").run();
        console.log("✅ 成功添加 invite_code 字段");
    }
    
    // 4. 补全 referred_by (推荐人邀请码)
    if (!columns.some(c => c.name === 'referred_by')) {
        dbInstance.prepare("ALTER TABLE users ADD COLUMN referred_by TEXT DEFAULT NULL").run();
        console.log("✅ 成功添加 referred_by 字段");
    }
    
    // 5. 创建推荐奖励记录表
    dbInstance.prepare(`
        CREATE TABLE IF NOT EXISTS referral_rewards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            referrer_id INTEGER NOT NULL,
            referrer_username TEXT,
            referee_id INTEGER NOT NULL,
            referee_username TEXT,
            amount REAL NOT NULL,
            status TEXT DEFAULT 'completed',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();
    console.log("✅ referral_rewards 表已就绪");
    
    // 6. 确保 settings 表存在并初始化推荐奖励配置
    dbInstance.prepare(`
        CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT UNIQUE NOT NULL,
            value TEXT NOT NULL,
            description TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();
    
    const rewardSetting = dbInstance.prepare('SELECT value FROM settings WHERE key = ?').get('referral_reward_amount');
    if (!rewardSetting) {
        dbInstance.prepare('INSERT INTO settings (key, value, description) VALUES (?, ?, ?)').run(
            'referral_reward_amount',
            '5.00',
            '推荐奖励金额（元）'
        );
        console.log("✅ 初始化推荐奖励配置: 5.00 元");
    }
    
    // 6.5 创建派送订单表 (dispatched_orders)
    dbInstance.prepare(`
        CREATE TABLE IF NOT EXISTS dispatched_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            task_index INTEGER NOT NULL,
            min_amount REAL NOT NULL,
            max_amount REAL NOT NULL,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            triggered_at DATETIME DEFAULT NULL,
            UNIQUE(user_id, task_index)
        )
    `).run();
    console.log("✅ dispatched_orders 表已就绪");
    
    // 6.6 创建交易记录表 (transactions) - 用于财务对账
    dbInstance.prepare(`
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            amount REAL NOT NULL,
            description TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();
    console.log("✅ transactions 表已就绪");
    
    // 7. 补全 allow_grab (抢单开关) - 默认开启
    if (!columns.some(c => c.name === 'allow_grab')) {
        dbInstance.prepare("ALTER TABLE users ADD COLUMN allow_grab INTEGER DEFAULT 1").run();
        console.log("✅ 成功添加 allow_grab 字段（抢单开关）");
    }
    
    // 8. 补全 task_progress (任务进度) - 默认为0
    if (!columns.some(c => c.name === 'task_progress')) {
        dbInstance.prepare("ALTER TABLE users ADD COLUMN task_progress INTEGER DEFAULT 0").run();
        console.log("✅ 成功添加 task_progress 字段（任务进度）");
    }
    
    // 9. 补全 is_worker (做单账户标识) - 默认为0（普通用户）
    if (!columns.some(c => c.name === 'is_worker')) {
        dbInstance.prepare("ALTER TABLE users ADD COLUMN is_worker INTEGER DEFAULT 0").run();
        console.log("✅ 成功添加 is_worker 字段（做单账户标识）");
    }
    
    // 9. 为所有没有邀请码的用户自动生成邀请码
    const usersWithoutCode = dbInstance.prepare("SELECT id, username FROM users WHERE invite_code IS NULL AND role = 'User'").all();
    if (usersWithoutCode.length > 0) {
        console.log(`🔧 发现 ${usersWithoutCode.length} 个用户没有邀请码，开始自动生成...`);
        const updateStmt = dbInstance.prepare('UPDATE users SET invite_code = ? WHERE id = ?');
        const existingCodes = new Set(
            dbInstance.prepare('SELECT invite_code FROM users WHERE invite_code IS NOT NULL').all().map(r => r.invite_code)
        );
        
        usersWithoutCode.forEach(user => {
            let code;
            do {
                code = Math.random().toString(36).substring(2, 8).toUpperCase();
            } while (existingCodes.has(code));
            
            updateStmt.run(code, user.id);
            existingCodes.add(code);
            console.log(`  ✅ 用户 ${user.username} (ID:${user.id}) 邀请码: ${code}`);
        });
        console.log(`✅ 已为 ${usersWithoutCode.length} 个用户生成邀请码`);
    }
    
    // 10. 补全 credit_score (信用分) - 默认100分
    if (!columns.some(c => c.name === 'credit_score')) {
        dbInstance.prepare("ALTER TABLE users ADD COLUMN credit_score INTEGER DEFAULT 100").run();
        console.log("✅ 成功添加 credit_score 字段（信用分）");
    }
    
    // 11. 补全 allow_withdraw (提现权限) - 默认允许
    if (!columns.some(c => c.name === 'allow_withdraw')) {
        dbInstance.prepare("ALTER TABLE users ADD COLUMN allow_withdraw INTEGER DEFAULT 1").run();
        console.log("✅ 成功添加 allow_withdraw 字段（提现权限）");
    }

    // 12. 补全 phone (手机号) - 用于条件搜索
    if (!columns.some(c => c.name === 'phone')) {
        dbInstance.prepare("ALTER TABLE users ADD COLUMN phone TEXT DEFAULT NULL").run();
        try {
            dbInstance.prepare("CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone)").run();
        } catch (e) {}
        console.log("✅ 成功添加 phone 字段（手机号）");
    }
} catch (e) {
    console.error("数据库自动修复失败:", e);
}

/**
 * 获取个人信息 (增强版 - 含 VIP 每日上限与费率，供任务大厅展示 X/Y)
 * GET /api/user/me
 */
router.get('/me', authenticate, (req, res) => {
  const db = req.db;
  const userId = req.user.id;

  try {
    const user = db.prepare(
      'SELECT id, username, balance, frozen_balance, vip_level, task_progress, invite_code, allow_grab, credit_score FROM users WHERE id = ?'
    ).get(userId);

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    let vipConfig = db.prepare('SELECT * FROM vip_levels WHERE level = ?').get(user.vip_level != null ? user.vip_level : 1);
    if (!vipConfig) {
      vipConfig = { task_limit: 40, commission_rate: 0.005 };
    }

    let totalProfit = 0;
    let todayProfit = 0;
    let totalOrders = 0;
    try {
      const stat = db.prepare(
        'SELECT COALESCE(SUM(commission), 0) as profit, COUNT(*) as cnt FROM orders WHERE user_id = ? AND status = ?'
      ).get(userId, 'completed');
      totalProfit = stat ? (stat.profit || 0) : 0;
      totalOrders = stat ? (stat.cnt || 0) : 0;
      const todayRow = db.prepare(
        "SELECT COALESCE(SUM(commission), 0) as profit FROM orders WHERE user_id = ? AND status = 'completed' AND date(created_at) = date('now', 'localtime')"
      ).get(userId);
      todayProfit = todayRow ? (todayRow.profit || 0) : 0;
    } catch (e) {}

    res.json({
      success: true,
      data: {
        ...user,
        task_progress: user.task_progress != null ? user.task_progress : 0,
        vip_daily_orders: vipConfig.task_limit != null ? vipConfig.task_limit : 40,
        vip_commission_rate: vipConfig.commission_rate != null ? vipConfig.commission_rate : 0.005,
        total_profit: totalProfit,
        today_profit: todayProfit,
        total_orders: totalOrders
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * 获取绑定的钱包信息
 * GET /api/user/wallet-info
 */
router.get('/wallet-info', authenticate, (req, res) => {
  try {
    const user = req.db.prepare('SELECT wallet_address FROM users WHERE id = ?').get(req.user.id);
    return success(res, { wallet_address: user.wallet_address || '' });
  } catch (err) {
    console.error('获取钱包信息失败:', err);
    return error(res, 'Failed to fetch wallet info', 500);
  }
});

/**
 * 绑定/更新钱包地址
 * POST /api/user/bind-wallet
 */
router.post('/bind-wallet', authenticate, (req, res) => {
  const { address } = req.body;
  
  // 验证地址格式
  if (!address || address.length < 10) {
    return error(res, 'Invalid wallet address', 400);
  }
  
  // 简单的 TRC20 地址验证（以 T 开头，长度 34）
  if (!address.startsWith('T') || address.length !== 34) {
    return error(res, 'Invalid TRC20 address format', 400);
  }
  
  try {
    req.db.prepare('UPDATE users SET wallet_address = ? WHERE id = ?').run(address, req.user.id);
    return success(res, { message: 'Wallet bound successfully' });
  } catch (err) {
    console.error('绑定钱包失败:', err);
    return error(res, 'Database error', 500);
  }
});

/**
 * 修改登录密码
 * POST /api/user/change-password
 */
router.post('/change-password', authenticate, (req, res) => {
  const { old_password, new_password } = req.body;
  const bcrypt = require('bcryptjs');
  
  // 验证输入
  if (!old_password || !new_password) {
    return error(res, 'Please provide both old and new password', 400);
  }
  
  if (new_password.length < 6) {
    return error(res, 'New password must be at least 6 characters', 400);
  }
  
  try {
    // 获取当前密码
    const user = req.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!user) return error(res, 'User not found', 404);
    
    // 验证旧密码
    const isValid = bcrypt.compareSync(old_password, user.password_hash);
    if (!isValid) {
      return error(res, 'Old password is incorrect', 400);
    }
    
    // 加密新密码
    const hashedPassword = bcrypt.hashSync(new_password, 10);
    
    // 更新密码
    req.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashedPassword, req.user.id);
    
    return success(res, { message: 'Password updated successfully' });
  } catch (err) {
    console.error('修改密码失败:', err);
    return error(res, 'Failed to update password', 500);
  }
});

/**
 * 设置/修改资金密码
 * POST /api/user/set-security-password
 */
router.post('/set-security-password', authenticate, (req, res) => {
  const { old_password, new_password } = req.body;
  const bcrypt = require('bcryptjs');
  
  // 验证新密码
  if (!new_password || new_password.length < 6) {
    return error(res, 'Security password must be at least 6 characters', 400);
  }
  
  try {
    // 获取当前资金密码
    const user = req.db.prepare('SELECT security_password FROM users WHERE id = ?').get(req.user.id);
    
    // 如果已设置过资金密码，需要验证旧密码
    if (user.security_password) {
      if (!old_password) {
        return error(res, 'Please provide old security password', 400);
      }
      
      const isValid = bcrypt.compareSync(old_password, user.security_password);
      if (!isValid) {
        return error(res, 'Old security password is incorrect', 400);
      }
    }
    
    // 加密新密码
    const hashedPassword = bcrypt.hashSync(new_password, 10);
    
    // 更新资金密码
    req.db.prepare('UPDATE users SET security_password = ? WHERE id = ?').run(hashedPassword, req.user.id);
    
    return success(res, { 
      message: user.security_password ? 'Security password updated' : 'Security password set successfully',
      is_first_time: !user.security_password
    });
  } catch (err) {
    console.error('设置资金密码失败:', err);
    return error(res, 'Failed to set security password', 500);
  }
});

/**
 * 检查是否已设置资金密码
 * GET /api/user/has-security-password
 */
router.get('/has-security-password', authenticate, (req, res) => {
  try {
    const user = req.db.prepare('SELECT security_password FROM users WHERE id = ?').get(req.user.id);
    return success(res, { 
      has_security_password: !!user.security_password 
    });
  } catch (err) {
    console.error('检查资金密码失败:', err);
    return error(res, 'Failed to check security password', 500);
  }
});

/**
 * 获取邀请信息
 * GET /api/user/invite-info
 */
router.get('/invite-info', authenticate, (req, res) => {
  try {
    const userId = req.user.id;
    
    // 1. 获取当前用户信息 (确保有邀请码)
    let user = req.db.prepare('SELECT username, invite_code FROM users WHERE id = ?').get(userId);
    
    // 如果没有邀请码，基于 ID 和随机字符生成一个
    if (!user.invite_code) {
      const newCode = `${userId}${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      req.db.prepare('UPDATE users SET invite_code = ? WHERE id = ?').run(newCode, userId);
      user.invite_code = newCode;
    }

    // 2. 统计团队人数 (referred_by 字段存储上级邀请码)
    let teamCount = 0;
    try {
      const result = req.db.prepare('SELECT COUNT(*) as count FROM users WHERE referred_by = ?').get(user.invite_code);
      teamCount = result ? result.count : 0;
    } catch (e) {
      console.error('统计团队人数失败:', e);
    }

    // 3. 构建邀请链接 (动态获取当前域名)
    const protocol = req.protocol;
    const host = req.get('host');
    const inviteLink = `${protocol}://${host}/views/user/register.html?code=${user.invite_code}`;

    return success(res, {
      invite_code: user.invite_code,
      invite_link: inviteLink,
      team_count: teamCount
    });
  } catch (err) {
    console.error('获取邀请信息失败:', err);
    return error(res, 'Failed to get invite info', 500);
  }
});

/**
 * 获取推荐商品（随机抽取）
 * GET /api/user/products/recommended?limit=6
 */
router.get('/products/recommended', authenticate, (req, res) => {
  try {
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit) || 6));
    const products = req.db.prepare(
      'SELECT id, title, price, image FROM products ORDER BY RANDOM() LIMIT ?'
    ).all(limit);
    return success(res, { products });
  } catch (err) {
    console.error('Get recommended products error:', err);
    return error(res, 'Failed to load products', 500);
  }
});

module.exports = router;
