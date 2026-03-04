#!/usr/bin/env node
/**
 * 清理过期登录日志与操作日志（按天数保留）
 * 用法: node server/scripts/cleanup-old-logs.js [保留天数]
 * 默认保留 90 天，即删除 90 天前的 login_logs 和 audit_logs 记录。
 * 建议配合 cron 定期执行，例如每周日凌晨 3 点: 0 3 * * 0 cd /path/to/project && node server/scripts/cleanup-old-logs.js 90
 */
require('dotenv').config();
const config = require('../config');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const keepDays = Math.max(1, parseInt(process.argv[2], 10) || 90);
const dbPath = path.resolve(process.cwd(), config.database.path);

if (!fs.existsSync(dbPath)) {
  console.error('数据库文件不存在:', dbPath);
  process.exit(1);
}

const db = new Database(dbPath);
const cutoff = new Date();
cutoff.setDate(cutoff.getDate() - keepDays);
const cutoffStr = cutoff.toISOString().slice(0, 10);

try {
  const r1 = db.prepare("DELETE FROM login_logs WHERE date(created_at) < date(?)").run(cutoffStr);
  const r2 = db.prepare("DELETE FROM audit_logs WHERE date(created_at) < date(?)").run(cutoffStr);
  console.log('清理完成: login_logs 删除', r1.changes, '条, audit_logs 删除', r2.changes, '条 (保留', keepDays, '天内)');
} catch (err) {
  console.error('清理失败:', err.message);
  process.exit(1);
} finally {
  db.close();
}
