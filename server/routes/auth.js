/**
 * 认证路由 - 登录/注册
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const { signToken } = require('../utils/jwt');
const { success, error } = require('../utils/response');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// 登录/注册限流：每个 IP 每分钟最多 10 次
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { success: false, error: 'Too many attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

function setAuthCookie(req, res, token) {
  const isHttps = !!(req.secure || (req.headers['x-forwarded-proto'] || '').toString().includes('https'));
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
}

/**
 * C 端用户注册
 * POST /api/auth/register
 */
router.post('/register', (req, res) => {
  const { username, password, ref, code } = req.body;
  
  if (!username || !password) {
    return error(res, 'Username and password are required');
  }
  
  // 检查用户是否已存在
  const existing = req.db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return error(res, 'Username already exists', 409);
  }
  
  // 1. 查找推荐人（代理） - 兼容旧逻辑
  let agentId = null;
  if (ref) {
    const agent = req.db.prepare(
      'SELECT id, agent_path FROM users WHERE (id = ? OR username = ?) AND role = ?'
    ).get(Number(ref) || 0, String(ref), 'Agent');
    
    if (agent) {
      agentId = agent.id;
    }
  }
  
  // 2. 查找普通用户推荐人（通过邀请码）- 新功能
  let referrerInviteCode = null;
  const inviteCodeParam = code || ref; // 兼容 code 和 ref 参数
  
  if (inviteCodeParam) {
    const referrer = req.db.prepare(
      'SELECT id, username, invite_code FROM users WHERE invite_code = ? AND role = ?'
    ).get(inviteCodeParam, 'User');
    
    if (referrer) {
      referrerInviteCode = referrer.invite_code;
      console.log(`✅ 用户 ${username} 被 ${referrer.username} (邀请码: ${referrerInviteCode}) 推荐`);
    }
  }
  
  // 创建用户 - 自动生成邀请码
  const passwordHash = bcrypt.hashSync(password, 10);
  
  // 生成唯一的6位邀请码
  const generateInviteCode = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  };
  
  let inviteCode = generateInviteCode();
  // 确保邀请码唯一
  while (req.db.prepare('SELECT id FROM users WHERE invite_code = ?').get(inviteCode)) {
    inviteCode = generateInviteCode();
  }
  
  const result = req.db.prepare(
    'INSERT INTO users (username, password_hash, role, agent_id, referred_by, invite_code) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(username, passwordHash, 'User', agentId, referrerInviteCode, inviteCode);
  
  const userId = result.lastInsertRowid;
  console.log(`✅ 新用户 ${username} 注册成功，邀请码: ${inviteCode}`);
  
  // 更新代理路径
  if (agentId) {
    const parent = req.db.prepare('SELECT agent_path FROM users WHERE id = ?').get(agentId);
    const agentPath = parent?.agent_path ? `${parent.agent_path}/${userId}` : `${agentId}/${userId}`;
    req.db.prepare('UPDATE users SET agent_path = ? WHERE id = ?').run(agentPath, userId);
  }
  
  // 3. 给推荐人发放奖励（可选）
  if (referrerInviteCode) {
    try {
      const referrer = req.db.prepare('SELECT id, username FROM users WHERE invite_code = ?').get(referrerInviteCode);
      if (referrer) {
        // 从配置中读取奖励金额
        const rewardConfig = req.db.prepare('SELECT value FROM settings WHERE key = ?').get('referral_reward_amount');
        const rewardAmount = rewardConfig ? parseFloat(rewardConfig.value) : 5.00;
        req.db.prepare(
          'UPDATE users SET balance = balance + ? WHERE id = ?'
        ).run(rewardAmount, referrer.id);
        
        // 记录奖励发放历史
        req.db.prepare(`
          INSERT INTO referral_rewards (referrer_id, referrer_username, referee_id, referee_username, amount, status)
          VALUES (?, ?, ?, ?, ?, 'completed')
        `).run(referrer.id, referrer.username, userId, username, rewardAmount);
        
        console.log(`💰 推荐奖励: ${referrer.username}(ID:${referrer.id}) 推荐 ${username}(ID:${userId})，获得 ${rewardAmount} 元`);
      }
    } catch (err) {
      console.error('发放推荐奖励失败:', err);
      // 不影响注册流程，只记录错误
    }
  }
  
  // 签发 Token
  const token = signToken({
    id: userId,
    username,
    role: 'User'
  });

  // 同时写入 HttpOnly Cookie（兼容无痕/跨端口）
  setAuthCookie(req, res, token);
  
  return success(res, {
    token,
    user: { id: userId, username, role: 'User' }
  }, 'Registration successful');
});

/**
 * C 端用户登录
 * POST /api/auth/login
 */
router.post('/login', authLimiter, (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return error(res, 'Username and password are required');
  }
  
  // 查找用户
  const user = req.db.prepare(
    'SELECT * FROM users WHERE username = ? AND role = ?'
  ).get(username, 'User');
  
  if (!user) {
    return error(res, 'Invalid credentials', 401);
  }
  
  // 检查账户状态
  if (user.status === 'banned') {
    return error(res, 'Account is banned', 403);
  }
  
  if (user.account_lock_status === 'banned_login') {
    return error(res, 'Account is locked', 403);
  }
  
  // 验证密码
  const passwordMatch = bcrypt.compareSync(password, user.password_hash);
  if (!passwordMatch) {
    return error(res, 'Invalid credentials', 401);
  }
  
  // 签发 Token
  const token = signToken({
    id: user.id,
    username: user.username,
    role: user.role
  });

  // 同时写入 HttpOnly Cookie（兼容无痕/跨端口）
  setAuthCookie(req, res, token);
  
  return success(res, {
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      balance: user.balance,
      vip_level: user.vip_level
    }
  }, 'Login successful');
});

/**
 * 管理员登录
 * POST /api/auth/admin/login
 */
router.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return error(res, 'Username and password are required');
  }
  
  // 查找管理员用户（不包括 Agent）
  const user = req.db.prepare(
    'SELECT * FROM users WHERE username = ? AND role IN (?, ?, ?, ?)'
  ).get(username, 'SuperAdmin', 'Admin', 'Finance', 'Support');
  
  if (!user) {
    return error(res, 'Invalid credentials', 401);
  }
  
  // 验证密码
  const passwordMatch = bcrypt.compareSync(password, user.password_hash);
  if (!passwordMatch) {
    return error(res, 'Invalid credentials', 401);
  }
  
  // 签发 Token
  const token = signToken({
    id: user.id,
    username: user.username,
    role: user.role
  });

  setAuthCookie(req, res, token);
  
  // 记录登录日志
  req.db.prepare(
    'INSERT INTO login_logs (user_id, username, ip, user_agent) VALUES (?, ?, ?, ?)'
  ).run(user.id, user.username, req.ip, req.get('user-agent'));
  
  return success(res, {
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role
    }
  }, 'Login successful');
});

/**
 * 代理商登录
 * POST /api/auth/agent/login
 */
router.post('/agent/login', authLimiter, (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return error(res, 'Username and password are required');
  }
  
  // 查找代理用户
  const user = req.db.prepare(
    'SELECT * FROM users WHERE username = ? AND role = ?'
  ).get(username, 'Agent');
  
  if (!user) {
    return error(res, 'Invalid credentials', 401);
  }
  
  // 验证密码
  const passwordMatch = bcrypt.compareSync(password, user.password_hash);
  if (!passwordMatch) {
    return error(res, 'Invalid credentials', 401);
  }
  
  // 签发 Token
  const token = signToken({
    id: user.id,
    username: user.username,
    role: user.role,
    agent_path: user.agent_path
  });

  setAuthCookie(req, res, token);
  
  return success(res, {
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      agent_path: user.agent_path
    }
  }, 'Login successful');
});

/**
 * 退出登录（清 Cookie + 记录退出日志）
 * POST /api/auth/logout
 */
router.post('/logout', authenticate, (req, res) => {
  try {
    res.clearCookie('token', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/'
    });
    try {
      req.db.prepare(`
        INSERT INTO login_logs (user_id, username, ip, user_agent, action, created_at)
        VALUES (?, ?, ?, ?, 'logout', datetime('now'))
      `).run(
        req.user.id,
        req.user.username,
        (req.ip || req.headers['x-forwarded-for'] || 'unknown').toString().trim().split(',')[0],
        req.headers['user-agent'] || 'unknown'
      );
    } catch (logErr) {
      console.error('Logout log error:', logErr);
    }
    return res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    console.error('Logout error:', err);
    return res.json({ success: false, message: 'Logout failed' });
  }
});

module.exports = router;
