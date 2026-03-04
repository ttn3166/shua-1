/**
 * 从 DummyJSON 拉取 30 个非生鲜/非易腐商品（排除蔬菜、生鲜、易坏品）
 * 仅使用：数码、美妆、家具、服饰、配饰等类目
 * 运行: node server/scripts/seed-30-nonperishable.js
 */
const https = require('https');
const path = require('path');

const scriptDir = __dirname;
const serverDir = path.join(scriptDir, '..');
const projectRoot = path.join(serverDir, '..');
process.chdir(projectRoot);

const { getDb } = require(path.join(serverDir, 'db'));

// 排除：生鲜、食品、蔬菜等易坏品类，只选耐储存类目
const EXCLUDED_CATEGORIES = new Set(['groceries']);
const ALLOWED_CATEGORIES = [
  'smartphones', 'laptops', 'tablets', 'fragrances', 'skin-care', 'beauty',
  'furniture', 'home-decoration', 'mens-shirts', 'mens-shoes', 'mens-watches',
  'womens-dresses', 'womens-shoes', 'womens-bags', 'womens-jewellery', 'womens-watches',
  'tops', 'sunglasses', 'mobile-accessories', 'sports-accessories',
  'kitchen-accessories', 'motorcycle', 'vehicle'
];

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

async function fetchCategory(category) {
  const url = `https://dummyjson.com/products/category/${category}`;
  const res = await fetchJson(url);
  return res.products && Array.isArray(res.products) ? res.products : [];
}

async function main() {
  console.log('正在拉取 30 个非生鲜/非易腐商品（排除蔬菜、生鲜、易坏品）...\n');
  const seenIds = new Set();
  const collected = [];

  for (const cat of ALLOWED_CATEGORIES) {
    if (collected.length >= 30) break;
    try {
      const products = await fetchCategory(cat);
      for (const p of products) {
        if (collected.length >= 30) break;
        if (seenIds.has(p.id)) continue;
        const title = (p.title || '').trim();
        const price = typeof p.price === 'number' ? p.price : parseFloat(p.price);
        const image = (p.thumbnail && p.thumbnail.trim()) || (p.images && p.images[0]);
        if (!title || !image || !isFinite(price) || price <= 0) continue;
        seenIds.add(p.id);
        collected.push({ title, price, image: image.trim() });
      }
    } catch (e) {
      console.warn('  跳过类目', cat, e.message);
    }
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

  console.log('\n完成。已成功写入', inserted, '个非生鲜/非易腐商品，名称与图片一一对应。');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
