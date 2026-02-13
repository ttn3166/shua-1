/**
 * 数据填充脚本 - 初始化任务模板与清理异常订单
 * 用途：首次部署或测试时填充基础数据
 */
const { getDb } = require('../db');
require('dotenv').config();

function seedData() {
  console.log('');
  console.log('🌱 开始填充数据...');
  console.log('━'.repeat(50));
  
  const db = getDb();
  
  try {
    // ==================== 1. 清理异常订单 ====================
    console.log('\n📦 Step 1: 清理 pending 状态订单...');
    
    const pendingOrders = db.prepare('SELECT COUNT(*) as count FROM orders WHERE status = ?').get('pending');
    
    if (pendingOrders.count > 0) {
      db.prepare('DELETE FROM orders WHERE status = ?').run('pending');
      console.log(`   ✅ 已删除 ${pendingOrders.count} 条异常订单`);
    } else {
      console.log('   ℹ️  没有需要清理的订单');
    }
    
    // ==================== 2. 填充任务模板 ====================
    console.log('\n🎯 Step 2: 填充任务模板...');
    
    // 检查是否已存在任务模板
    const existingTasks = db.prepare('SELECT COUNT(*) as count FROM task_templates').get();
    
    if (existingTasks.count > 0) {
      console.log(`   ℹ️  已存在 ${existingTasks.count} 个任务模板，跳过填充`);
    } else {
      // 插入默认任务模板（支持抢单功能）
      const taskTemplates = [
        {
          title: '跨境电商抢单',
          description: '完成订单匹配和确认，获得佣金奖励',
          reward: 25.00,
          daily_limit: 50,
          status: 'active'
        },
        {
          title: '优质订单抢购',
          description: '高价值订单，佣金更高',
          reward: 50.00,
          daily_limit: 30,
          status: 'active'
        },
        {
          title: 'VIP专属任务',
          description: 'VIP用户专享，超高佣金',
          reward: 100.00,
          daily_limit: 20,
          status: 'active'
        }
      ];
      
      const insertTask = db.prepare(`
        INSERT INTO task_templates (title, description, reward, daily_limit, status)
        VALUES (?, ?, ?, ?, ?)
      `);
      
      taskTemplates.forEach(task => {
        insertTask.run(task.title, task.description, task.reward, task.daily_limit, task.status);
      });
      
      console.log(`   ✅ 已插入 ${taskTemplates.length} 个任务模板`);
    }
    
    // ==================== 3. 验证数据 ====================
    console.log('\n✅ Step 3: 验证数据完整性...');
    
    const tasks = db.prepare('SELECT * FROM task_templates WHERE status = ?').all('active');
    
    console.log(`   📋 活跃任务模板: ${tasks.length} 个`);
    tasks.forEach((task, index) => {
      console.log(`      ${index + 1}. ${task.title} (ID: ${task.id}, 奖励: ${task.reward} USDT)`);
    });
    
    // ==================== 完成 ====================
    console.log('');
    console.log('━'.repeat(50));
    console.log('✅ 数据填充完成！');
    console.log('');
    console.log('💡 提示：');
    console.log('   - 任务模板已就绪，用户现在可以正常抢单');
    console.log('   - 每个任务都有独立的每日限制和奖励');
    console.log('   - 您可以在管理后台查看和管理任务模板');
    console.log('');
    console.log('🚀 现在可以测试抢单功能了！');
    console.log('━'.repeat(50));
    console.log('');
    
  } catch (error) {
    console.error('❌ 数据填充失败:', error.message);
    process.exit(1);
  }
}

// 执行
seedData();
process.exit(0);
