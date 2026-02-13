/**
 * 用户诊断脚本 - 检查用户数据和账户状态
 */
const { getDb } = require('../db');
require('dotenv').config();

function checkUser() {
  console.log('');
  console.log('🔍 用户数据诊断');
  console.log('━'.repeat(50));
  
  const db = getDb();
  
  try {
    // 获取所有用户
    const users = db.prepare('SELECT * FROM users').all();
    
    console.log(`\n📊 系统用户总数: ${users.length}`);
    console.log('');
    
    users.forEach((user, index) => {
      console.log(`【用户 ${index + 1}】`);
      console.log(`   ID: ${user.id}`);
      console.log(`   用户名: ${user.username}`);
      console.log(`   角色: ${user.role}`);
      console.log(`   状态: ${user.status} ${user.status === 'active' ? '✅' : '❌'}`);
      console.log(`   余额: ${user.balance} USDT`);
      console.log(`   冻结余额: ${user.frozen_balance} USDT`);
      console.log(`   VIP等级: ${user.vip_level}`);
      console.log(`   账户锁定: ${user.account_lock_status}`);
      
      if (user.account_lock_reason) {
        console.log(`   锁定原因: ${user.account_lock_reason}`);
      }
      
      // 检查今日抢单次数
      const today = new Date().toISOString().split('T')[0];
      const todayCount = db.prepare(
        'SELECT COUNT(*) as count FROM user_tasks WHERE user_id = ? AND date(created_at) = ?'
      ).get(user.id, today);
      
      console.log(`   今日抢单: ${todayCount.count}/10 次`);
      
      // 检查是否可以抢单
      let canOrder = true;
      let reason = [];
      
      if (user.status !== 'active') {
        canOrder = false;
        reason.push('账户未激活');
      }
      
      if (user.account_lock_status === 'locked_chain') {
        canOrder = false;
        reason.push('有未完成连环单');
      }
      
      if (todayCount.count >= 10) {
        canOrder = false;
        reason.push('今日抢单次数已满');
      }
      
      if (user.balance < 50) {
        canOrder = false;
        reason.push('余额不足（最低 50 USDT）');
      }
      
      if (canOrder) {
        console.log(`   ✅ 可以抢单`);
      } else {
        console.log(`   ❌ 无法抢单: ${reason.join(', ')}`);
      }
      
      console.log('');
    });
    
    // 检查任务模板
    console.log('━'.repeat(50));
    console.log('\n🎯 任务模板状态:');
    const tasks = db.prepare('SELECT * FROM task_templates WHERE status = ?').all('active');
    console.log(`   活跃任务: ${tasks.length} 个`);
    
    if (tasks.length === 0) {
      console.log('   ❌ 警告：没有活跃任务模板！');
    }
    
    console.log('');
    console.log('━'.repeat(50));
    console.log('');
    
  } catch (error) {
    console.error('❌ 诊断失败:', error.message);
    process.exit(1);
  }
}

// 执行
checkUser();
process.exit(0);
