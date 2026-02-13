/**
 * 代理商路由
 */
const express = require('express');
const { authenticate, requireAgent } = require('../middleware/auth');
const { success } = require('../utils/response');

const router = express.Router();

/**
 * 获取代理统计数据
 * GET /api/agent/stats
 */
router.get('/stats', authenticate, requireAgent, (req, res) => {
  const agentPath = req.user.agent_path || String(req.user.id);
  const likePrefix = agentPath + '/%';
  
  // 获取团队用户ID列表
  const teamUsers = req.db.prepare(
    'SELECT id FROM users WHERE agent_path = ? OR agent_path LIKE ?'
  ).all(agentPath, likePrefix);
  
  const teamUserIds = teamUsers.map(u => u.id);
  
  if (teamUserIds.length === 0) {
    return success(res, {
      team_count: 0,
      today_deposit: 0,
      today_withdraw: 0,
      total_balance: 0
    });
  }
  
  // 统计今日充值
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
 * 获取团队成员列表
 * GET /api/agent/team
 */
router.get('/team', authenticate, requireAgent, (req, res) => {
  const agentPath = req.user.agent_path || String(req.user.id);
  const likePrefix = agentPath + '/%';
  
  const team = req.db.prepare(
    `SELECT id, username, role, status, balance, vip_level, agent_path, created_at 
     FROM users 
     WHERE agent_path = ? OR agent_path LIKE ?
     ORDER BY agent_path, id
     LIMIT 500`
  ).all(agentPath, likePrefix);
  
  return success(res, team);
});

module.exports = router;
