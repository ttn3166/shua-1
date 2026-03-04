/**
 * 第十四批 30 个商品，严格保证每条使用该商品自带的图片（商品与图片一一对应）
 * 数据源：DummyJSON，每条记录自带 title / price / thumbnail，一一对应
 * 运行: node server/scripts/seed-30-batch14.js
 */
const https = require('https');
const path = require('path');

const scriptDir = __dirname;
const serverDir = path.join(scriptDir, '..');
const projectRoot = path.join(serverDir, '..');
process.chdir(projectRoot);

const { getDb } = require(path.join(serverDir, 'db'));

const SKIP = 50;
const LIMIT = 60;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('正在拉取第十四批 30 个商品（每条严格使用该商品自带图片）...\n');
  const url = `https://dummyjson.com/products?limit=${LIMIT}&skip=${SKIP}`;
  const res = await fetchJson(url);
  const products = res.products && Array.isArray(res.products) ? res.products : [];

  const collected = [];
  for (const p of products) {
    if (collected.length >= 30) break;
    if ((p.category || '').toLowerCase() === 'groceries') continue;
    const title = (p.title || '').trim();
    const price = typeof p.price === 'number' ? p.price : parseFloat(p.price);
    const image = (p.thumbnail && p.thumbnail.trim())
      ? p.thumbnail.trim()
      : (p.images && p.images[0] && typeof p.images[0] === 'string')
        ? p.images[0].trim()
        : '';
    if (!title || !image || !isFinite(price) || price <= 0) continue;
    collected.push({ title, price, image });
  }

  if (collected.length === 0) {
    console.log('未获取到符合条件的商品。');
    return;
  }

  const toInsert = collected.slice(0, 30);
  const db = getDb();
  db.prepare(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      price REAL,
      image TEXT,
      vip_level INTEGER DEFAULT 0
    )
  `).run();

  const insert = db.prepare(
    'INSERT INTO products (title, price, image, vip_level) VALUES (?, ?, ?, 0)'
  );

  let inserted = 0;
  for (const p of toInsert) {
    try {
      insert.run(p.title, p.price, p.image);
      inserted++;
      const shortTitle = p.title.length > 42 ? p.title.substring(0, 42) + '...' : p.title;
      console.log(`  [${inserted}] ${shortTitle} | ${p.price} USDT`);
    } catch (e) {
      console.warn('跳过:', p.title, e.message);
    }
  }

  console.log('\n完成。已写入', inserted, '个商品，名称与图片一一对应。');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
