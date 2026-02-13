/**
 * 配置文件 - 统一管理环境变量和系统配置
 */
require('dotenv').config();

module.exports = {
  // 服务器配置
  port: process.env.PORT || 3000,
  env: process.env.NODE_ENV || 'development',
  
  // JWT 配置（生产环境务必设置 JWT_SECRET 环境变量）
  jwt: {
    secret: process.env.JWT_SECRET || 'default-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES || '7d'
  },
  
  // 数据库配置
  database: {
    path: process.env.DB_PATH || './data/taskmall.db'
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
