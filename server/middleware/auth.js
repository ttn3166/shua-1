/**
 * 认证中间件
 */
const { verifyToken } = require('../utils/jwt');
const { error } = require('../utils/response');
const cookie = require('cookie');
const { getDb } = require('../db');

/**
 * 验证 Token（通用）
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  // 1) 优先 Bearer Token
  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  }

  // 2) 兜底读取 Cookie: token=<jwt>
  if (!token) {
    try {
      const rawCookie = req.headers.cookie || '';
      const parsed = cookie.parse(rawCookie);
      token = parsed.token || null;
    } catch (e) {
      token = null;
    }
  }

  if (!token) {
    return error(res, 'Unauthorized: No token provided', 401);
  }

  const decoded = verifyToken(token);
  
  if (!decoded) {
    return error(res, 'Unauthorized: Invalid token', 401);
  }
  
  req.user = decoded;
  // 更新用户最后活跃时间（用于在线统计）
  try {
    getDb().prepare("UPDATE users SET last_active_at = datetime('now') WHERE id = ?").run(decoded.id);
  } catch (e) { /* ignore */ }
  next();
}

/**
 * 验证角色
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return error(res, 'Unauthorized', 401);
    }
    
    if (!roles.includes(req.user.role)) {
      return error(res, 'Forbidden: Insufficient permissions', 403);
    }
    
    next();
  };
}

/**
 * 验证管理员权限
 */
function requireAdmin(req, res, next) {
  return requireRole('SuperAdmin', 'Admin')(req, res, next);
}

/**
 * 验证代理权限
 */
function requireAgent(req, res, next) {
  return requireRole('Agent')(req, res, next);
}

module.exports = {
  authenticate,
  requireRole,
  requireAdmin,
  requireAgent
};
