const db = require('./db').getDb();

console.log("🛠️ Starting Database Patch...");

try {
    // 1. 检查 orders 表，补全 missing columns
    const columns = db.prepare("PRAGMA table_info(orders)").all().map(c => c.name);
    console.log("Current columns in orders:", columns);

    if (!columns.includes('commission')) {
        db.prepare("ALTER TABLE orders ADD COLUMN commission REAL DEFAULT 0").run();
        console.log("✅ Added column: commission");
    }

    if (!columns.includes('type')) {
        db.prepare("ALTER TABLE orders ADD COLUMN type TEXT DEFAULT 'normal'").run();
        console.log("✅ Added column: type");
    }

    // 2. 确保 order_no 存在 (您提到已补上，这里双重确认)
    if (!columns.includes('order_no')) {
        db.prepare("ALTER TABLE orders ADD COLUMN order_no TEXT").run();
        console.log("✅ Added column: order_no");
    }

    // 3. 确保 transactions 表存在
    db.prepare(`
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            type TEXT,
            amount REAL,
            description TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();
    console.log("✅ Verified table: transactions");

    console.log("🎉 Database Patch Completed!");

} catch (err) {
    console.error("❌ Patch Failed:", err);
}
