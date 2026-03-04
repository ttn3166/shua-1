#!/usr/bin/env node
/**
 * 数据库备份脚本（SQLite 文件复制）
 * 用法: node server/scripts/backup-db.js [输出目录]
 * 默认输出到项目根目录下的 backups/，文件名带时间戳。
 * 可配合 cron 定时执行，例如每天 4 点: 0 4 * * * cd /path/to/project && node server/scripts/backup-db.js
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');

const config = require('../config');
const dbPath = path.resolve(process.cwd(), config.database.path);
const outDir = path.resolve(process.cwd(), process.argv[2] || 'backups');
const name = path.basename(dbPath, path.extname(dbPath));
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outPath = path.join(outDir, `${name}_${timestamp}.db`);

if (!fs.existsSync(dbPath)) {
  console.error('数据库文件不存在:', dbPath);
  process.exit(1);
}

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

try {
  fs.copyFileSync(dbPath, outPath);
  console.log('备份完成:', outPath);
} catch (err) {
  console.error('备份失败:', err.message);
  process.exit(1);
}
