/**
 * 代理商路由（员工后台，仅可查看自己名下客户）
 * 权限：agent_permissions 为 null/空 时视为拥有全部权限
 */
const express = require('express');
const { authenticate, requireAgent } = require('../middleware/auth');
const { success, error } = require('../utils/response');

const router = express.Router();

// 导出仅总端可用，代理端不提供导出功能
const ALL_AGENT_PERMISSIONS = [
  'view_team',
  'view_stats',
  'view_team_detail',
  'view_deposit_withdraw',
  'view_referral_rewards',
  'view_team_orders',
  'view_team_login'
];

/** 加载当前代理的权限到 req.agentPermissions（需在 authenticate + requireAgent 之后） */
function loadAgentPermissions(req, res, next) {
  try {
    const row = req.db.prepare('SELECT agent_permissions FROM users WHERE id = ?').get(req.user.id);
    let list = [];
    if (row && row.agent_permissions) {
      try {
        list = JSON.parse(row.agent_permissions);
      } catch (e) {
        list = [];
      }
    }
    req.agentPermissions = Array.isArray(list) && list.length > 0 ? list : ALL_AGENT_PERMISSIONS;
    next();
  } catch (err) {
    console.error('loadAgentPermissions:', err);
    req.agentPermissions = ALL_AGENT_PERMISSIONS;
    next();
  }
}

/** 要求拥有指定权限 */
function requireAgentPermission(perm) {
  return (req, res, next) => {
    if (!req.agentPermissions || !req.agentPermissions.includes(perm)) {
      return error(res, 'Forbidden: 无此权限', 403);
    }
    next();
  };
}

/** 获取团队用户 ID 列表（agent_path 或 referred_by 归到当前代理） */
function getTeamUserIds(req) {
  const agentPath = req.user.agent_path || String(req.user.id);
  const likePrefix = agentPath + '/%';
  const byPath = req.db.prepare(
    'SELECT id FROM users WHERE agent_path = ? OR agent_path LIKE ?'
  ).all(agentPath, likePrefix);
  const agent = req.db.prepare('SELECT invite_code FROM users WHERE id = ?').get(req.user.id);
  const byRef = agent ? req.db.prepare('SELECT id FROM users WHERE referred_by = ?').all(agent.invite_code) : [];
  const set = new Set(byPath.map(u => u.id));
  byRef.forEach(u => set.add(u.id));
  return Array.from(set);
}

/**
 * 当前代理信息与权限
 * GET /api/agent/me
 */
router.get('/me', authenticate, requireAgent, loadAgentPermissions, (req, res) => {
  const u = req.user;
  return success(res, {
    id: u.id,
    username: u.username,
    invite_code: u.invite_code,
    agent_path: u.agent_path,
    permissions: req.agentPermissions
  });
});

/**
 * 团队统计（需 view_stats）
 * GET /api/agent/stats
 */
router.get('/stats', authenticate, requireAgent, loadAgentPermissions, requireAgentPermission('view_stats'), (req, res) => {
  const teamUserIds = getTeamUserIds(req);
  if (teamUserIds.length === 0) {
    return success(res, {
      team_count: 0,
      today_deposit: 0,
      today_withdraw: 0,
      total_balance: 0
    });
  }
  const today = new Date().toISOString().split('T')[0];
  const placeholders = teamUserIds.map(() => '?').join(',');
  const deposits = req.db.prepare(
    `SELECT COALESCE(SUM(amount), 0) as total 
     FROM deposits 
     WHERE user_id IN (${placeholders}) 
     AND date(created_at) = ? 
     AND status = 'approved'`
  ).get(...teamUserIds, today);
  const withdrawals = req.db.prepare(
    `SELECT COALESCE(SUM(amount), 0) as total 
     FROM withdrawals 
     WHERE user_id IN (${placeholders}) 
     AND date(created_at) = ? 
     AND status IN ('approved', 'paid')`
  ).get(...teamUserIds, today);
  const balances = req.db.prepare(
    `SELECT COALESCE(SUM(balance), 0) as total 
     FROM users 
     WHERE id IN (${placeholders})`
  ).get(...teamUserIds);
  return success(res, {
    team_count: teamUserIds.length,
    today_deposit: deposits.total,
    today_withdraw: withdrawals.total,
    total_balance: balances.total
  });
});

/**
 * 团队成员列表（需 view_team）：仅返回当前代理名下客户（agent_path 或 referred_by 邀请码）
 */
router.get('/team', authenticate, requireAgent, loadAgentPermissions, requireAgentPermission('view_team'), (req, res) => {
  const teamUserIds = getTeamUserIds(req);
  if (teamUserIds.length === 0) {
    return success(res, []);
  }
  const placeholders = teamUserIds.map(() => '?').join(',');
  const team = req.db.prepare(
    `SELECT id, username, role, status, balance, vip_level, agent_path, created_at 
     FROM users 
     WHERE id IN (${placeholders})
     ORDER BY created_at DESC
     LIMIT 500`
  ).all(...teamUserIds);
  return success(res, team);
});

/**
 * 团队充值/提现记录（需 view_deposit_withdraw）
 * GET /api/agent/team/deposits-withdrawals
 */
router.get('/team/deposits-withdrawals', authenticate, requireAgent, loadAgentPermissions, requireAgentPermission('view_deposit_withdraw'), (req, res) => {
  const teamUserIds = getTeamUserIds(req);
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  if (teamUserIds.length === 0) {
    return success(res, { deposits: [], withdrawals: [], pagination: { limit, offset, total: 0 } });
  }
  const placeholders = teamUserIds.map(() => '?').join(',');
  const deposits = req.db.prepare(
    `SELECT d.id, d.user_id, d.amount, d.status, d.created_at, u.username 
     FROM deposits d JOIN users u ON d.user_id = u.id 
     WHERE d.user_id IN (${placeholders}) 
     ORDER BY d.created_at DESC LIMIT ? OFFSET ?`
  ).all(...teamUserIds, limit, offset);
  const withdrawals = req.db.prepare(
    `SELECT w.id, w.user_id, w.amount, w.status, w.created_at, u.username 
     FROM withdrawals w JOIN users u ON w.user_id = u.id 
     WHERE w.user_id IN (${placeholders}) 
     ORDER BY w.created_at DESC LIMIT ? OFFSET ?`
  ).all(...teamUserIds, limit, offset);
  const totalD = req.db.prepare(`SELECT COUNT(*) as c FROM deposits WHERE user_id IN (${placeholders})`).get(...teamUserIds).c;
  const totalW = req.db.prepare(`SELECT COUNT(*) as c FROM withdrawals WHERE user_id IN (${placeholders})`).get(...teamUserIds).c;
  return success(res, {
    deposits,
    withdrawals,
    pagination: { limit, offset, total_deposits: totalD, total_withdrawals: totalW }
  });
});

/**
 * 推荐奖励记录（需 view_referral_rewards）：团队成员的推荐奖励
 * GET /api/agent/referral-rewards
 */
router.get('/referral-rewards', authenticate, requireAgent, loadAgentPermissions, requireAgentPermission('view_referral_rewards'), (req, res) => {
  const teamUserIds = getTeamUserIds(req);
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  if (teamUserIds.length === 0) {
    return success(res, { list: [], pagination: { limit, offset, total: 0 } });
  }
  const placeholders = teamUserIds.map(() => '?').join(',');
  const cols = req.db.prepare('PRAGMA table_info(referral_rewards)').all().map(r => r.name);
  const hasTable = cols.length > 0;
  if (!hasTable) {
    return success(res, { list: [], pagination: { limit, offset, total: 0 } });
  }
  const total = req.db.prepare(`SELECT COUNT(*) as count FROM referral_rewards WHERE referrer_id IN (${placeholders})`).get(...teamUserIds).count;
  const list = req.db.prepare(
    `SELECT * FROM referral_rewards WHERE referrer_id IN (${placeholders}) ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...teamUserIds, limit, offset);
  return success(res, { list, pagination: { limit, offset, total } });
});

/**
 * 团队订单列表（需 view_team_orders）：仅当前代理名下客户的订单
 * GET /api/agent/team/orders
 */
router.get('/team/orders', authenticate, requireAgent, loadAgentPermissions, requireAgentPermission('view_team_orders'), (req, res) => {
  const teamUserIds = getTeamUserIds(req);
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  if (teamUserIds.length === 0) {
    return success(res, { list: [], pagination: { limit, offset, total: 0 } });
  }
  const placeholders = teamUserIds.map(() => '?').join(',');
  const total = req.db.prepare(`SELECT COUNT(*) as c FROM orders WHERE user_id IN (${placeholders})`).get(...teamUserIds).c;
  const list = req.db.prepare(
    `SELECT o.id, o.user_id, o.amount, o.status, o.created_at, u.username 
     FROM orders o JOIN users u ON o.user_id = u.id 
     WHERE o.user_id IN (${placeholders}) 
     ORDER BY o.created_at DESC LIMIT ? OFFSET ?`
  ).all(...teamUserIds, limit, offset);
  return success(res, { list, pagination: { limit, offset, total } });
});

/**
 * 团队登录记录（需 view_team_login）：仅当前代理名下客户的登录日志
 * GET /api/agent/team/login-logs
 */
router.get('/team/login-logs', authenticate, requireAgent, loadAgentPermissions, requireAgentPermission('view_team_login'), (req, res) => {
  const teamUserIds = getTeamUserIds(req);
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  if (teamUserIds.length === 0) {
    return success(res, { list: [], pagination: { limit, offset, total: 0 } });
  }
  const placeholders = teamUserIds.map(() => '?').join(',');
  const total = req.db.prepare(`SELECT COUNT(*) as c FROM login_logs WHERE user_id IN (${placeholders})`).get(...teamUserIds).c;
  const list = req.db.prepare(
    `SELECT l.id, l.user_id, l.ip, l.action, l.created_at, u.username 
     FROM login_logs l JOIN users u ON l.user_id = u.id 
     WHERE l.user_id IN (${placeholders}) 
     ORDER BY l.created_at DESC LIMIT ? OFFSET ?`
  ).all(...teamUserIds, limit, offset);
  return success(res, { list, pagination: { limit, offset, total } });
});

/**
 * 单个客户详情（需 view_team_detail），仅限团队内用户
 * GET /api/agent/team/:userId
 */
router.get('/team/:userId', authenticate, requireAgent, loadAgentPermissions, requireAgentPermission('view_team_detail'), (req, res) => {
  const userId = req.params.userId;
  const teamUserIds = getTeamUserIds(req);
  if (!teamUserIds.includes(parseInt(userId, 10))) {
    return error(res, '无权查看该客户', 403);
  }
  const user = req.db.prepare(
    'SELECT id, username, role, status, balance, vip_level, invite_code, referred_by, agent_path, created_at FROM users WHERE id = ?'
  ).get(userId);
  if (!user) {
    return error(res, '用户不存在', 404);
  }
  return success(res, user);
});

module.exports = router;
