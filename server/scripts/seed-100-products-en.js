/**
 * 录入 100 条英文商品，图片与内容匹配，价格合理
 * 使用本地已生成的产品图，确保图片可正常显示
 * Run: node server/scripts/seed-100-products-en.js
 */
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db');
const XLSX = require('xlsx');

// 100 条英文商品 [Name, PriceMin, PriceMax, ImageFile]
const PRODUCTS = [
  ['iPhone 15 Pro Clear Case Shockproof', 12, 28, 'p01-phone-case.png'],
  ['Samsung Galaxy Tempered Glass Screen Protector', 8, 18, 'p01-phone-case.png'],
  ['Type-C Fast Charging Cable 1m Braided', 9, 22, 'p29-cable.png'],
  ['Wireless Bluetooth Earphones Noise Canceling', 35, 89, 'p02-earphones.png'],
  ['Mechanical Gaming Keyboard RGB Backlit', 89, 199, 'p03-keyboard.png'],
  ['Ergonomic Wireless Silent Mouse', 25, 55, 'p04-mouse.png'],
  ['20000mAh Portable Power Bank Fast Charge', 35, 75, 'p05-power-bank.png'],
  ['Aluminum Laptop Stand Adjustable', 28, 65, 'p30-laptop-stand.png'],
  ['iPad Case with Pencil Holder', 22, 48, 'p01-phone-case.png'],
  ['Portable Bluetooth Speaker Waterproof', 45, 99, 'p02-earphones.png'],
  ['USB-C 7-in-1 Hub Adapter', 45, 95, 'p29-cable.png'],
  ['1TB Portable External SSD', 65, 129, 'p05-power-bank.png'],
  ['1080P Webcam with Microphone', 55, 119, 'p02-earphones.png'],
  ['Car Phone Mount Gravity Sensor', 15, 35, 'p26-car-mount.png'],
  ['Smart Fitness Band Heart Rate Sleep', 35, 79, 'p02-earphones.png'],
  ['Cotton T-Shirt Unisex Basic', 29, 69, 'p06-tshirt.png'],
  ['High Waist Slim Fit Stretch Jeans', 79, 159, 'p07-jeans.png'],
  ['Running Sneakers Breathable Lightweight', 129, 269, 'p08-sneakers.png'],
  ['Laptop Backpack Water Resistant', 89, 189, 'p09-backpack.png'],
  ['Polarized Sunglasses UV Protection', 39, 89, 'p06-tshirt.png'],
  ['Leather Wallet Multi Card Slots', 45, 99, 'p27-necklace.png'],
  ['5.5L Air Fryer Touch Screen', 199, 399, 'p10-air-fryer.png'],
  ['1.8L Electric Kettle Keep Warm', 69, 139, 'p11-kettle.png'],
  ['Non-Stick Frying Pan 28cm with Lid', 79, 159, 'p12-pan.png'],
  ['5-Piece Stainless Steel Knife Set', 99, 229, 'p12-pan.png'],
  ['Sealed Food Storage Containers 10-Pack', 49, 99, 'p12-pan.png'],
  ['Anti-Slip Yoga Mat 183cm', 39, 79, 'p13-yoga-mat.png'],
  ['LED Desk Lamp Touch Dimming', 45, 99, 'p14-desk-lamp.png'],
  ['Memory Foam Pillow Cervical Support', 69, 139, 'p15-pillow.png'],
  ['Amino Acid Gentle Facial Cleanser', 35, 79, 'p16-skincare.png'],
  ['Hydrating Moisturizer 50ml', 49, 119, 'p16-skincare.png'],
  ['SPF50 Sunscreen Lightweight', 45, 99, 'p16-skincare.png'],
  ['Sonic Electric Toothbrush 2-Pack', 129, 269, 'p17-toothbrush.png'],
  ['Ionic Hair Dryer Constant Temperature', 89, 199, 'p18-hair-dryer.png'],
  ['Hydrating Sheet Mask 10-Pack', 39, 89, 'p19-face-mask.png'],
  ['Adjustable Dumbbells Pair', 129, 269, 'p20-dumbbell.png'],
  ['Anti-Burst Yoga Ball 65cm', 35, 69, 'p13-yoga-mat.png'],
  ['Jump Rope with Counter', 25, 55, 'p20-dumbbell.png'],
  ['Running Waist Pack Phone Keys', 29, 59, 'p09-backpack.png'],
  ['Insulated Sports Water Bottle 500ml', 35, 69, 'p20-dumbbell.png'],
  ['4-Person Camping Tent Windproof', 199, 429, 'p21-tent.png'],
  ['3-Season Sleeping Bag Synthetic', 129, 269, 'p21-tent.png'],
  ['Carbon Fiber Trekking Poles Pair', 79, 159, 'p21-tent.png'],
  ['Wide Neck Anti-Colic Baby Bottle 240ml', 45, 99, 'p22-baby-bottle.png'],
  ['Baby Wipes 80ct 10-Pack', 49, 99, 'p22-baby-bottle.png'],
  ['Stainless Steel Baby Bottle Set', 35, 79, 'p22-baby-bottle.png'],
  ['Organic Mixed Nuts 500g Jar', 59, 129, 'p23-nuts.png'],
  ['Dark Chocolate Gift Box Assorted', 49, 99, 'p23-nuts.png'],
  ['Arabica Coffee Beans 1kg', 79, 169, 'p23-nuts.png'],
  ['Pure Honey 500g Natural', 49, 99, 'p23-nuts.png'],
  ['A5 Hardcover Notebook Ruled', 25, 55, 'p24-notebook.png'],
  ['Gel Pen Set 12 Colors', 15, 35, 'p24-notebook.png'],
  ['Desktop Organizer Multi-Layer', 35, 69, 'p24-notebook.png'],
  ['Adult Cat Food 2kg Dry', 59, 129, 'p25-cat-food.png'],
  ['Clumping Cat Litter 10L', 35, 69, 'p25-cat-food.png'],
  ['Pet Stainless Steel Bowl Set', 35, 69, 'p25-cat-food.png'],
  ['Car Phone Holder Magnetic', 25, 55, 'p26-car-mount.png'],
  ['1080P Dash Cam Night Vision', 129, 269, 'p26-car-mount.png'],
  ['Dual USB Car Charger Fast Charge', 35, 69, 'p26-car-mount.png'],
  ['Sterling Silver Pendant Necklace', 59, 129, 'p27-necklace.png'],
  ['925 Silver Stud Earrings Minimalist', 35, 79, 'p27-necklace.png'],
  ['Leather Watch Band Replacement', 45, 99, 'p27-necklace.png'],
  ['Building Blocks Set 500 Pcs', 59, 129, 'p28-blocks.png'],
  ['1000-Piece Jigsaw Puzzle Landscape', 45, 89, 'p28-blocks.png'],
  ['Remote Control Car 4WD Charging', 89, 179, 'p28-blocks.png'],
  ['LED Ring Light Stand 10"', 25, 49, 'p14-desk-lamp.png'],
  ['USB Condenser Microphone K歌', 88, 199, 'p02-earphones.png'],
  ['WiFi 6 Gigabit Router', 99, 229, 'p29-cable.png'],
  ['24" 75Hz Monitor Eye Care', 199, 399, 'p03-keyboard.png'],
  ['Knitted Cardigan Lightweight', 69, 139, 'p06-tshirt.png'],
  ['Fleece Hoodie Zip Up', 79, 159, 'p06-tshirt.png'],
  ['Low Top Canvas Sneakers Classic', 89, 179, 'p08-sneakers.png'],
  ['Genuine Leather Belt Auto Buckle', 55, 119, 'p07-jeans.png'],
  ['3L Smart Rice Cooker with Timer', 199, 399, 'p10-air-fryer.png'],
  ['Portable Blender USB Rechargeable', 89, 179, 'p11-kettle.png'],
  ['Cordless Vacuum Cleaner 2-in-1', 199, 429, 'p10-air-fryer.png'],
  ['Handheld Steam Iron', 79, 159, 'p11-kettle.png'],
  ['Resistance Bands 5-Level Set', 39, 79, 'p20-dumbbell.png'],
  ['Foam Roller Massage Recovery', 49, 99, 'p20-dumbbell.png'],
  ['Swimming Goggles Anti-Fog', 35, 79, 'p20-dumbbell.png'],
  ['Nursing Pillow Ergonomic', 28, 65, 'p22-baby-bottle.png'],
  ['Steam Bottle Sterilizer', 99, 219, 'p11-kettle.png'],
  ['Protein Bars 12-Pack Variety', 18, 38, 'p23-nuts.png'],
  ['Green Tea Can 200g', 45, 99, 'p23-nuts.png'],
  ['Sticky Notes 12-Pack Assorted', 19, 39, 'p24-notebook.png'],
  ['Scientific Calculator Solar', 29, 59, 'p24-notebook.png'],
  ['Pet Travel Carrier Soft', 35, 79, 'p25-cat-food.png'],
  ['Cat Scratching Post Sisal', 28, 65, 'p25-cat-food.png'],
  ['Car Air Freshener Vent Clip', 25, 55, 'p26-car-mount.png'],
  ['All-Weather Car Floor Mats', 129, 269, 'p26-car-mount.png'],
  ['Pearl Strand Necklace Classic', 79, 169, 'p27-necklace.png'],
  ['Charm Bracelet Sterling Silver', 45, 99, 'p27-necklace.png'],
  ['Strategy Board Game Family', 28, 65, 'p28-blocks.png'],
  ['Collectible Action Figure', 22, 55, 'p28-blocks.png'],
  ['Kids Art Supplies Set 24 Colors', 22, 55, 'p28-blocks.png'],
  ['Throw Pillow Cover Set 2-Pack', 15, 35, 'p15-pillow.png'],
  ['Blackout Curtains Pair', 69, 149, 'p15-pillow.png'],
  ['Ultrasonic Humidifier Quiet', 79, 159, 'p11-kettle.png'],
  ['Electric Hot Water Bottle', 25, 55, 'p15-pillow.png'],
  ['Linen Bed Sheet Set Queen', 89, 179, 'p15-pillow.png'],
  ['Lip Balm Set 5 Pack Hydrating', 25, 55, 'p16-skincare.png'],
  ['Makeup Brush Set 8-Piece', 49, 109, 'p16-skincare.png'],
  ['Silicone Face Cleansing Brush', 18, 45, 'p16-skincare.png'],
  ['Bicycle Helmet Adjustable', 89, 179, 'p20-dumbbell.png'],
  ['Insulated Lunch Bag', 25, 55, 'p09-backpack.png'],
  ['Wireless Earbuds Sport', 45, 99, 'p02-earphones.png'],
  ['Phone Grip Holder Ring', 8, 18, 'p01-phone-case.png'],
  ['Tablet Stand Adjustable Rotating', 18, 42, 'p30-laptop-stand.png'],
];

const BASE_URL = '/public/uploads/products/';

function randomInRange(min, max) {
  return Math.round((min + Math.random() * (max - min)) * 100) / 100;
}

function main() {
  const db = getDb();
  const insert = db.prepare(
    'INSERT INTO products (title, price, image, vip_level) VALUES (?, ?, ?, 0)'
  );

  const rows = [];
  PRODUCTS.forEach(([name, minP, maxP, img]) => {
    const price = randomInRange(minP, maxP);
    const image = BASE_URL + img;
    insert.run(name, price, image);
    rows.push({ Name: name, Price: price, Image: image });
  });

  console.log('Inserted', PRODUCTS.length, 'English products.');

  // 生成 Excel 供下载
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Products');

  const outDir = path.join(__dirname, '../../public/downloads');
  try { fs.mkdirSync(outDir, { recursive: true }); } catch (e) {}
  const outPath = path.join(outDir, 'products-100-en.xlsx');
  XLSX.writeFile(wb, outPath);
  console.log('Excel saved:', outPath);
  console.log('Download URL: /public/downloads/products-100-en.xlsx');
}

main();
