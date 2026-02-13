/**
 * 从 Fake Store API 拉取商品并写入 products 表（国际电商风格实拍图）
 * 说明：无法从亚马逊/淘宝等商城直接抓图（版权与 ToS），此处使用免费 Fake Store API，图片为电商风格实拍。
 * 运行: node server/scripts/seed-100-products.js
 */
const https = require('https');
const { getDb } = require('../db');

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
  console.log('Fetching products from Fake Store API (international store style images)...');
  const list = await fetchJson('https://fakestoreapi.com/products');
  const products = Array.isArray(list) ? list : [];
  if (products.length === 0) {
    console.log('No products returned.');
    return;
  }

  const db = getDb();
  const insert = db.prepare(
    'INSERT INTO products (title, price, image, vip_level) VALUES (?, ?, ?, 0)'
  );

  let inserted = 0;
  for (const p of products) {
    const title = (p.title || '').trim() || 'Product';
    const price = typeof p.price === 'number' ? p.price : parseFloat(p.price) || 10;
    const image = (p.image && p.image.trim()) ? p.image.trim() : '';
    if (!image) continue;
    try {
      insert.run(title, price, image);
      inserted++;
    } catch (e) {
      console.warn('Skip:', title, e.message);
    }
  }

  console.log('Done. Inserted', inserted, 'products (Fake Store API – store-style product images).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
