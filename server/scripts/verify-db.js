#!/usr/bin/env node
/**
 * 数据库完整性验证脚本
 * 用途：在 better-sqlite3 修复前后检查数据是否完整
 * 用法：node server/scripts/verify-db.js
 */
const path = require('path');
const fs = require('fs');

const dbPath = path.resolve(__dirname, '../../data/taskmall.db');

console.log('━'.repeat(50));
console.log('📋 TaskMall 数据库验证');
console.log('━'.repeat(50));
console.log('数据库路径:', dbPath);
console.log('');

// 1. 检查文件是否存在
if (!fs.existsSync(dbPath)) {
  console.error('❌ 错误: 数据库文件不存在:', dbPath);
  process.exit(1);
}

const stat = fs.statSync(dbPath);
console.log('✅ 数据库文件存在');
console.log('   大小:', (stat.size / 1024).toFixed(2), 'KB');
console.log('   修改时间:', stat.mtime.toISOString());
console.log('');

// 2. 尝试加载 better-sqlite3 并查询
try {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true });

  // 用户表统计
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get();
  const userRoleCount = db.prepare('SELECT role, COUNT(*) as c FROM users GROUP BY role').all();
  const totalBalance = db.prepare('SELECT COALESCE(SUM(balance), 0) as s FROM users WHERE role = ?').get('User');

  console.log('✅ better-sqlite3 连接成功');
  console.log('');
  console.log('📊 用户表 (users):');
  console.log('   总用户数:', userCount.c);
  userRoleCount.forEach(r => console.log('   -', r.role + ':', r.c));
  console.log('   普通用户总余额:', Number(totalBalance.s).toFixed(2), 'USDT');
  console.log('');

  // 抽样 3 个用户
  const sample = db.prepare('SELECT id, username, balance, role FROM users LIMIT 3').all();
  console.log('📌 用户抽样 (前3条):');
  sample.forEach(u => {
    console.log('   ID:', u.id, '|', u.username, '| 余额:', u.balance, '| 角色:', u.role);
  });

  db.close();
  console.log('');
  console.log('━'.repeat(50));
  console.log('✅ 验证完成 - 数据完整，better-sqlite3 正常工作');
  console.log('━'.repeat(50));
} catch (err) {
  if (err.message && err.message.includes('MODULE_VERSION')) {
    console.log('⚠️ better-sqlite3 模块版本不匹配，无法连接数据库');
    console.log('   错误:', err.message);
    console.log('');
    console.log('📌 修复前可用 sqlite3 命令行验证（若已安装）:');
    console.log('   sqlite3', dbPath, '"SELECT COUNT(*) FROM users;"');
    console.log('');
    console.log('   或执行修复后重新运行本脚本:');
    console.log('   npm rebuild better-sqlite3');
    console.log('   node server/scripts/verify-db.js');
  } else {
    console.error('❌ 连接失败:', err.message);
  }
  process.exit(1);
}
