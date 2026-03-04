/**
 * 配置文件 - 统一管理环境变量和系统配置
 */
require('dotenv').config();
const path = require('path');

// 项目根目录（server 的上一级），保证无论从哪启动都能找到同一份 data
const projectRoot = path.resolve(__dirname, '..');
function resolveDbPath() {
  const raw = process.env.DB_PATH || './data/taskmall.db';
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(projectRoot, raw);
}

module.exports = {
  // 服务器配置
  port: process.env.PORT || 3000,
  env: process.env.NODE_ENV || 'development',
  
  // JWT 配置（生产环境务必设置 JWT_SECRET 环境变量）
  jwt: {
    secret: process.env.JWT_SECRET || 'default-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES || '7d'
  },
  
  // 数据库配置（相对路径会基于项目根目录解析，避免 PM2 等启动目录不同导致 502）
  database: {
    path: resolveDbPath()
  },
  
  // 管理员初始账号
  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin123'
  },
  
  // 业务配置
  business: {
    // 连环单触发概率
    chainOrderProb: {
      min: 0.05,
      max: 0.10
    },
    // 连环单倍数
    chainMultiplier: 1.5,
    // 每日任务限制
    dailyTaskLimit: 10
  }
};
