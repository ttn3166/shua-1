const { getDb } = require('../db');

const db = getDb();

console.log('🔧 Adding database indexes...');

try {
    // 订单表索引
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_orders_user_status 
        ON orders(user_id, status);
        
        CREATE INDEX IF NOT EXISTS idx_orders_created 
        ON orders(created_at DESC);
    `);
    
    // 提现表索引
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_withdrawals_status 
        ON withdrawals(status);
        
        CREATE INDEX IF NOT EXISTS idx_withdrawals_user 
        ON withdrawals(user_id);
    `);
    
    // 充值表索引
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_deposits_status 
        ON deposits(status);
        
        CREATE INDEX IF NOT EXISTS idx_deposits_user 
        ON deposits(user_id);
    `);
    
    // 流水表索引
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_ledger_user 
        ON ledger(user_id, created_at DESC);
    `);
    
    console.log('✅ Indexes created successfully!');
} catch (error) {
    console.error('❌ Error creating indexes:', error);
}
