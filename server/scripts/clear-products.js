/**
 * 清空商品表
 * 运行: node server/scripts/clear-products.js
 */
const { getDb } = require('../db');

const db = getDb();
const n = db.prepare('DELETE FROM products').run();
console.log('已清空商品表，删除', n.changes, '条记录。');
