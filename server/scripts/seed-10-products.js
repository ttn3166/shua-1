/**
 * 从 Fake Store API 拉取 10 个商品并写入 products 表（名称、价格、图片一一对应）
 * 运行: node server/scripts/seed-10-products.js
 */
const https = require('https');
const path = require('path');

// 从项目根目录运行时，确保能加载 server 下的模块
const scriptDir = __dirname;
const serverDir = path.join(scriptDir, '..');
const projectRoot = path.join(serverDir, '..');
process.chdir(projectRoot);

const { getDb } = require(path.join(serverDir, 'db'));

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
  console.log('正在从 Fake Store API 拉取 10 个商品（名称、价格、图片一致）...');
  const list = await fetchJson('https://fakestoreapi.com/products');
  const all = Array.isArray(list) ? list : [];
  const products = all.slice(0, 10);

  if (products.length === 0) {
    console.log('未获取到商品数据。');
    return;
  }

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
  for (const p of products) {
    const title = (p.title || '').trim() || 'Product';
    const price = typeof p.price === 'number' ? p.price : parseFloat(p.price) || 10;
    const image = (p.image && p.image.trim()) ? p.image.trim() : '';
    if (!image) {
      console.warn('跳过（无图片）:', title);
      continue;
    }
    try {
      insert.run(title, price, image);
      inserted++;
      console.log(`  [${inserted}] ${title} | ${price} USDT | ${image.substring(0, 50)}...`);
    } catch (e) {
      console.warn('跳过:', title, e.message);
    }
  }

  console.log('\n完成。已成功写入', inserted, '个商品，名称与图片一一对应。');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
