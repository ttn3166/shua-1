/**
 * 创建初始超级管理员脚本
 * 用途：首次部署时创建默认管理员账号
 */
const bcrypt = require('bcryptjs');
const { getDb } = require('../db');
require('dotenv').config();

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '123456';

async function createAdmin() {
  console.log('');
  console.log('🔐 初始化超级管理员账号');
  console.log('━'.repeat(50));
  
  const db = getDb();
  
  try {
    // 检查是否已存在管理员
    const existingAdmin = db.prepare(
      'SELECT id, username FROM users WHERE role = ? LIMIT 1'
    ).get('SuperAdmin');
    
    if (existingAdmin) {
      console.log('⚠️  超级管理员已存在:');
      console.log(`   账号: ${existingAdmin.username}`);
      console.log(`   ID: ${existingAdmin.id}`);
      console.log('');
      console.log('💡 提示: 如需重置密码，请手动删除该用户后重新运行此脚本');
      return;
    }
    
    // 创建管理员
    const passwordHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
    
    const result = db.prepare(`
      INSERT INTO users (username, password_hash, role, status, balance, vip_level)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(ADMIN_USERNAME, passwordHash, 'SuperAdmin', 'active', 0, 99);
    
    console.log('✅ 超级管理员创建成功！');
    console.log('━'.repeat(50));
    console.log('');
    console.log('📝 登录信息:');
    console.log(`   🔹 账号: ${ADMIN_USERNAME}`);
    console.log(`   🔹 密码: ${ADMIN_PASSWORD}`);
    console.log(`   🔹 角色: SuperAdmin (上帝权限)`);
    console.log(`   🔹 用户ID: ${result.lastInsertRowid}`);
    console.log('');
    console.log('🌐 登录地址:');
    console.log('   http://185.39.31.27/views/admin/login.html');
    console.log('');
    console.log('⚠️  安全提示: 请在首次登录后立即修改默认密码！');
    console.log('━'.repeat(50));
    console.log('');
    
  } catch (error) {
    console.error('❌ 创建管理员失败:', error.message);
    process.exit(1);
  }
}

// 执行
createAdmin()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
