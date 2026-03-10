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

// 管理员登录限流：每 IP 每分钟最多 5 次
const adminLoginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
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
const USERNAME_MIN_LEN = 2;
const USERNAME_MAX_LEN = 32;
const PASSWORD_MIN_LEN = 8;
const PASSWORD_MAX_LEN = 12;

function validateUsername(u) {
  if (u == null || typeof u !== 'string') return false;
  const s = u.trim();
  return s.length >= USERNAME_MIN_LEN && s.length <= USERNAME_MAX_LEN;
}

/**
 * 校验密码强度：长度 8～12 位，且至少包含一个字母和一个数字
 */
function validatePassword(p) {
  if (p == null || typeof p !== 'string') return { ok: false, msg: '密码格式无效' };
  const s = String(p);
  if (s.length < PASSWORD_MIN_LEN) return { ok: false, msg: `密码至少 ${PASSWORD_MIN_LEN} 位` };
  if (s.length > PASSWORD_MAX_LEN) return { ok: false, msg: `密码不能超过 ${PASSWORD_MAX_LEN} 位` };
  const hasLetter = /[a-zA-Z]/.test(s);
  const hasNumber = /[0-9]/.test(s);
  if (!hasLetter || !hasNumber) return { ok: false, msg: '密码须同时包含字母和数字' };
  return { ok: true };
}

router.post('/register', authLimiter, (req, res) => {
  const { username, password, ref, code } = req.body;
  const usernameTrimmed = typeof username === 'string' ? username.trim() : '';
  
  if (!username || !password) {
    return error(res, '请填写用户名和密码');
  }
  if (!validateUsername(usernameTrimmed)) {
    return error(res, `用户名长度需为 ${USERNAME_MIN_LEN}～${USERNAME_MAX_LEN} 个字符`);
  }
  const pwdCheck = validatePassword(password);
  if (!pwdCheck.ok) {
    return error(res, pwdCheck.msg);
  }
  
  // 检查用户是否已存在
  const existing = req.db.prepare('SELECT id FROM users WHERE username = ?').get(usernameTrimmed);
  if (existing) {
    return error(res, '该用户名已被注册', 409);
  }
  
  // 1. 查找推荐人（代理）：支持 ref 为代理 ID、用户名 或 邀请码（代理链接常用 ?ref=邀请码）
  let agentId = null;
  let agentInviteCode = null;
  const inviteCodeParam = code || ref;
  if (ref || code) {
    let agent = req.db.prepare(
      'SELECT id, agent_path, invite_code FROM users WHERE (id = ? OR username = ?) AND role = ?'
    ).get(Number(ref) || 0, String(ref), 'Agent');
    if (!agent && inviteCodeParam) {
      agent = req.db.prepare(
        'SELECT id, agent_path, invite_code FROM users WHERE invite_code = ? AND role = ?'
      ).get(String(inviteCodeParam), 'Agent');
    }
    if (agent) {
      agentId = agent.id;
      agentInviteCode = agent.invite_code || null;
    }
  }

  // 2. 查找普通用户推荐人（通过邀请码）：仅当不是代理推荐时，才可能是用户推荐
  let referrerInviteCode = null;
  if (inviteCodeParam && !agentInviteCode) {
    const referrer = req.db.prepare(
      'SELECT id, username, invite_code FROM users WHERE invite_code = ? AND role = ?'
    ).get(inviteCodeParam, 'User');
    if (referrer) {
      referrerInviteCode = referrer.invite_code;
      console.log(`✅ 用户 ${username} 被 ${referrer.username} (邀请码: ${referrerInviteCode}) 推荐`);
    }
  }

  // 代理推荐时也写入 referred_by，便于后台/代理端按 referred_by 统计
  const referredBy = referrerInviteCode || agentInviteCode || null;
  
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
  ).run(usernameTrimmed, passwordHash, 'User', agentId, referredBy, inviteCode);
  
  const userId = result.lastInsertRowid;
  console.log(`✅ 新用户 ${usernameTrimmed} 注册成功，邀请码: ${inviteCode}`);
  
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
        `).run(referrer.id, referrer.username, userId, usernameTrimmed, rewardAmount);
        
        console.log(`💰 推荐奖励: ${referrer.username}(ID:${referrer.id}) 推荐 ${usernameTrimmed}(ID:${userId})，获得 ${rewardAmount} 元`);
      }
    } catch (err) {
      console.error('发放推荐奖励失败:', err);
      // 不影响注册流程，只记录错误
    }
  }
  
  // 签发 Token
  const token = signToken({
    id: userId,
    username: usernameTrimmed,
    role: 'User'
  });

  // 同时写入 HttpOnly Cookie（兼容无痕/跨端口）
  setAuthCookie(req, res, token);
  
  return success(res, {
    token,
    user: { id: userId, username: usernameTrimmed, role: 'User' }
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
  
  // 查找用户（统一 trim，避免前后端空格不一致）
  const usernameTrimmed = typeof username === 'string' ? username.trim() : '';
  const user = req.db.prepare(
    'SELECT * FROM users WHERE username = ? AND role = ?'
  ).get(usernameTrimmed, 'User');
  
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
  // 记录登录日志（与管理员登录一致，保证日志完整）
  try {
    req.db.prepare(
      'INSERT INTO login_logs (user_id, username, ip, user_agent) VALUES (?, ?, ?, ?)'
    ).run(user.id, user.username, req.ip || '', req.get('user-agent') || '');
  } catch (logErr) {
    console.error('User login log error:', logErr);
  }
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
router.post('/admin/login', adminLoginLimiter, (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return error(res, '请填写用户名和密码');
  }
  if (!validateUsername(username)) {
    return error(res, `用户名长度需为 ${USERNAME_MIN_LEN}～${USERNAME_MAX_LEN} 个字符`);
  }
  
  // 查找管理员用户（不包括 Agent）
  const user = req.db.prepare(
    'SELECT * FROM users WHERE username = ? AND role IN (?, ?, ?, ?)'
  ).get(String(username).trim(), 'SuperAdmin', 'Admin', 'Finance', 'Support');
  
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
    return error(res, '请填写用户名和密码');
  }
  if (!validateUsername(username)) {
    return error(res, `用户名长度需为 ${USERNAME_MIN_LEN}～${USERNAME_MAX_LEN} 个字符`);
  }
  const name = String(username).trim();
  // 查找代理用户
  const user = req.db.prepare(
    'SELECT * FROM users WHERE username = ? AND role = ?'
  ).get(name, 'Agent');
  
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
 * 支持无 token 调用：token 过期时前端仍可调用，仅清 Cookie 并返回成功，避免 401
 */
router.post('/logout', (req, res, next) => {
  const authHeader = req.headers.authorization;
  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) token = authHeader.slice(7);
  if (!token && req.headers.cookie) {
    try {
      const parsed = require('cookie').parse(req.headers.cookie);
      token = parsed.token || null;
    } catch (e) {}
  }
  const decoded = token ? require('../utils/jwt').verifyToken(token) : null;

  res.clearCookie('token', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/'
  });

  if (decoded && req.db) {
    try {
      req.db.prepare(`
        INSERT INTO login_logs (user_id, username, ip, user_agent, action, created_at)
        VALUES (?, ?, ?, ?, 'logout', datetime('now'))
      `).run(
        decoded.id,
        decoded.username,
        (req.ip || req.headers['x-forwarded-for'] || 'unknown').toString().trim().split(',')[0],
        req.headers['user-agent'] || 'unknown'
      );
    } catch (logErr) {
      console.error('Logout log error:', logErr);
    }
  }
  return res.json({ success: true, message: 'Logged out successfully' });
});

module.exports = router;
