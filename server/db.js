/**
 * 数据库连接与初始化
 * 使用 better-sqlite3 (同步API，高性能)
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('./config');

let db = null;

/**
 * 获取数据库连接（单例模式）
 */
function getDb() {
  if (!db) {
    // 确保数据目录存在
    const dbDir = path.dirname(config.database.path);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    
    db = new Database(config.database.path, {
      verbose: config.env === 'development' ? console.log : null
    });
    
    // 启用外键约束
    db.pragma('foreign_keys = ON');
    
    // 初始化数据库表
    initTables();
  }
  
  return db;
}

/**
 * 初始化数据库表结构
 */
function initTables() {
  db.exec(`
    -- 用户表
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('SuperAdmin', 'Admin', 'Finance', 'Support', 'Agent', 'User')),
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'frozen', 'banned')),
      balance REAL DEFAULT 0,
      frozen_balance REAL DEFAULT 0,
      vip_level INTEGER DEFAULT 0,
      agent_id INTEGER,
      agent_path TEXT,
      account_lock_status TEXT DEFAULT 'normal',
      account_lock_reason TEXT,
      force_chain_next INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 用户索引
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    CREATE INDEX IF NOT EXISTS idx_users_agent_path ON users(agent_path);

    -- 任务模板表
    CREATE TABLE IF NOT EXISTS task_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      reward REAL NOT NULL,
      daily_limit INTEGER DEFAULT 10,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 用户任务表
    CREATE TABLE IF NOT EXISTS user_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      task_id INTEGER NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'failed')),
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (task_id) REFERENCES task_templates(id)
    );

    -- 商品表（用于抢单选品，vip_level=0 表示全员通用）
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      price REAL,
      image TEXT,
      vip_level INTEGER DEFAULT 0
    );

    -- 订单表
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      commission REAL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      type TEXT DEFAULT 'normal',
      task_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- 连环单表
    CREATE TABLE IF NOT EXISTS chain_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      order_id INTEGER NOT NULL,
      status TEXT DEFAULT 'locked' CHECK(status IN ('locked', 'settled', 'cancelled')),
      trigger_probability REAL,
      user_balance_at_trigger REAL,
      required_amount REAL NOT NULL,
      gap_amount REAL NOT NULL,
      lock_reason TEXT,
      settled_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    -- 充值记录表
    CREATE TABLE IF NOT EXISTS deposits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      hash TEXT,
      screenshot_url TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
      note TEXT,
      reviewed_by INTEGER,
      reviewed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- 提现记录表
    CREATE TABLE IF NOT EXISTS withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      wallet_address TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'paid', 'rejected')),
      note TEXT,
      payout_ref TEXT,
      reviewed_by INTEGER,
      reviewed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- 流水账本表
    CREATE TABLE IF NOT EXISTS ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      order_no TEXT,
      reason TEXT,
      created_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- VIP 规则表
    CREATE TABLE IF NOT EXISTS vip_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level INTEGER UNIQUE NOT NULL,
      name TEXT NOT NULL,
      min_balance REAL NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 审计日志表
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      reason TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (actor_id) REFERENCES users(id)
    );

    -- 登录日志表
    CREATE TABLE IF NOT EXISTS login_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // 迁移：为 match 流程支持 pending 订单添加 source、dispatch_order_id 列
  try {
    const cols = db.prepare("PRAGMA table_info(orders)").all().map(r => r.name);
    if (!cols.includes('source')) {
      db.exec("ALTER TABLE orders ADD COLUMN source TEXT DEFAULT 'start'");
      console.log('✅ orders.source 列已添加');
    }
    if (!cols.includes('dispatch_order_id')) {
      db.exec('ALTER TABLE orders ADD COLUMN dispatch_order_id INTEGER');
      console.log('✅ orders.dispatch_order_id 列已添加');
    }
    // 动态数量匹配：订单写入商品信息（可选字段）
    if (!cols.includes('product_title')) {
      db.exec('ALTER TABLE orders ADD COLUMN product_title TEXT');
      console.log('✅ orders.product_title 列已添加');
    }
    if (!cols.includes('product_image')) {
      db.exec('ALTER TABLE orders ADD COLUMN product_image TEXT');
      console.log('✅ orders.product_image 列已添加');
    }
    if (!cols.includes('unit_price')) {
      db.exec('ALTER TABLE orders ADD COLUMN unit_price REAL');
      console.log('✅ orders.unit_price 列已添加');
    }
    if (!cols.includes('quantity')) {
      db.exec('ALTER TABLE orders ADD COLUMN quantity INTEGER');
      console.log('✅ orders.quantity 列已添加');
    }
    if (!cols.includes('product_name')) {
      db.exec('ALTER TABLE orders ADD COLUMN product_name TEXT');
      console.log('✅ orders.product_name 列已添加');
    }
  } catch (e) {
    console.warn('orders 表迁移跳过:', e.message);
  }

  // 迁移：用户在线状态 last_active_at
  try {
    const userCols = db.prepare("PRAGMA table_info(users)").all().map(r => r.name);
    if (!userCols.includes('last_active_at')) {
      db.exec("ALTER TABLE users ADD COLUMN last_active_at DATETIME DEFAULT NULL");
      console.log('✅ users.last_active_at 列已添加');
    }
  } catch (e) {
    console.warn('users 表迁移跳过:', e.message);
  }

  // 迁移：login_logs 增加 action 列（login / logout）
  try {
    const logCols = db.prepare("PRAGMA table_info(login_logs)").all().map(r => r.name);
    if (!logCols.includes('action')) {
      db.exec("ALTER TABLE login_logs ADD COLUMN action TEXT DEFAULT 'login'");
      console.log('✅ login_logs.action 列已添加');
    }
  } catch (e) {
    console.warn('login_logs 表迁移跳过:', e.message);
  }

  // 迁移：deposits 增加 channel_id（充值方式）
  try {
    const depCols = db.prepare("PRAGMA table_info(deposits)").all().map(r => r.name);
    if (!depCols.includes('channel_id')) {
      db.exec("ALTER TABLE deposits ADD COLUMN channel_id TEXT");
      console.log('✅ deposits.channel_id 列已添加');
    }
  } catch (e) {
    console.warn('deposits 表迁移跳过:', e.message);
  }

  // 迁移：withdrawals 增加 channel_id（提现方式）
  try {
    const wdCols = db.prepare("PRAGMA table_info(withdrawals)").all().map(r => r.name);
    if (!wdCols.includes('channel_id')) {
      db.exec("ALTER TABLE withdrawals ADD COLUMN channel_id TEXT");
      console.log('✅ withdrawals.channel_id 列已添加');
    }
  } catch (e) {
    console.warn('withdrawals 表迁移跳过:', e.message);
  }

  console.log('✅ 数据库表初始化完成');
}

/**
 * 关闭数据库连接
 */
function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  getDb,
  closeDb
};
