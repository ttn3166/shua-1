/**
 * Seed 1000 products - various industries, high/low prices, no brands
 * Run: node server/scripts/seed-1000-products.js
 */
const { getDb } = require('../db');

const CATEGORIES = [
  // Electronics - high prices
  ['Gaming Laptop 17 Inch', 1299, 1899],
  ['4K Monitor 32 Inch', 399, 699],
  ['Wireless Mechanical Keyboard', 89, 159],
  ['Noise Canceling Headphones', 199, 349],
  ['Tablet 10 Inch', 249, 449],
  ['Smart Watch Pro', 199, 399],
  ['Bluetooth Speaker Portable', 49, 129],
  ['Webcam HD 1080p', 69, 119],
  ['USB-C Hub 7-in-1', 39, 79],
  ['External SSD 1TB', 89, 159],
  ['Wireless Mouse Ergonomic', 29, 59],
  ['Portable Power Bank 20000mAh', 35, 69],
  ['LED Ring Light', 25, 49],
  ['Microphone USB Condenser', 59, 129],
  ['Router WiFi 6', 79, 159],
  // Fashion
  ['Cotton T-Shirt Classic', 12, 28],
  ['Denim Jacket Slim Fit', 45, 89],
  ['Winter Coat Wool Blend', 89, 189],
  ['Running Shoes Lightweight', 55, 120],
  ['Leather Belt Casual', 18, 45],
  ['Sunglasses Polarized', 25, 79],
  ['Wool Scarf Striped', 22, 48],
  ['Backpack Travel 30L', 45, 95],
  ['Canvas Sneakers', 35, 75],
  ['Silk Scarf Print', 28, 65],
  ['Baseball Cap Cotton', 15, 35],
  ['Leather Wallet Bifold', 35, 85],
  ['Hoodie Fleece', 38, 78],
  ['Chino Pants Slim', 42, 88],
  ['Ankle Boots Suede', 65, 135],
  // Home & Kitchen
  ['Air Fryer 5.5L', 79, 149],
  ['Blender High Speed', 45, 99],
  ['Coffee Maker Drip', 35, 79],
  ['Kitchen Knife Set 5-Piece', 55, 129],
  ['Nonstick Frying Pan Set', 39, 79],
  ['Food Storage Containers Set', 18, 45],
  ['Yoga Mat Non-Slip', 22, 48],
  ['Throw Pillow Cover Set', 15, 35],
  ['Desk Lamp LED', 28, 65],
  ['Curtains Blackout Pair', 35, 79],
  ['Humidifier Ultrasonic', 35, 75],
  ['Electric Kettle Glass', 25, 55],
  ['Vacuum Cleaner Cordless', 149, 299],
  ['Iron Steam', 35, 75],
  ['Laundry Basket Collapsible', 15, 35],
  // Sports & Outdoors
  ['Dumbbells Set Adjustable', 89, 189],
  ['Resistance Bands Set', 18, 39],
  ['Camping Tent 4-Person', 89, 189],
  ['Sleeping Bag Synthetic', 45, 95],
  ['Water Bottle Insulated', 22, 48],
  ['Fitness Tracker Band', 35, 79],
  ['Bicycle Helmet', 35, 85],
  ['Jump Rope weighted', 12, 28],
  ['Yoga Block Set 2', 12, 25],
  ['Hiking Boots Waterproof', 89, 179],
  ['Tennis Racket Graphite', 65, 149],
  ['Swimming Goggles', 18, 45],
  ['Foam Roller', 22, 48],
  ['Pull-Up Bar Doorway', 28, 55],
  ['Ski Gloves Insulated', 35, 79],
  // Beauty & Personal
  ['Facial Cleanser Gentle', 12, 28],
  ['Moisturizer SPF 30', 18, 45],
  ['Hair Dryer Ionic', 35, 79],
  ['Electric Toothbrush', 45, 99],
  ['Perfume Roll-On', 22, 55],
  ['Nail Polish Set 6 Colors', 15, 35],
  ['Makeup Brush Set', 25, 55],
  ['Sunscreen SPF 50', 15, 35],
  ['Lip Balm Set 5 Pack', 8, 18],
  ['Face Mask Sheet 10 Pack', 12, 28],
  ['Body Lotion Hydrating', 10, 25],
  ['Razor Handle Premium', 18, 45],
  ['Hair Serum Argan', 22, 48],
  ['Hand Cream Gift Set', 15, 35],
  ['Exfoliating Scrub', 12, 28],
  // Food & Grocery style (low)
  ['Organic Honey 500g', 8, 18],
  ['Olive Oil Extra Virgin 1L', 12, 28],
  ['Granola Mix 500g', 6, 14],
  ['Coffee Beans 1kg', 18, 45],
  ['Tea Assortment Box', 12, 28],
  ['Protein Bars 12 Pack', 18, 38],
  ['Nuts Mixed 500g', 10, 22],
  ['Chocolate Gift Box', 15, 35],
  ['Cereal Whole Grain', 5, 12],
  ['Maple Syrup Pure 250ml', 12, 28],
  ['Spice Set 12 Jars', 25, 55],
  ['Hot Sauce Variety 3 Pack', 10, 22],
  ['Rice Cakes Assorted', 4, 10],
  ['Dried Fruits Mix 400g', 8, 18],
  ['Peanut Butter Natural', 6, 14],
  // Office & Stationery
  ['Notebook A5 Hardcover', 8, 18],
  ['Pen Set Gel 12 Colors', 6, 15],
  ['Desk Organizer Tray', 18, 45],
  ['Sticky Notes 12 Pack', 5, 12],
  ['Calculator Scientific', 12, 28],
  ['Laptop Stand Aluminum', 35, 75],
  ['File Folder Pack 50', 12, 28],
  ['Whiteboard 24x18', 25, 55],
  ['Paper Clips Assorted 100', 3, 8],
  ['Envelope Set A4 50', 5, 12],
  ['Highlighters 6 Pack', 5, 12],
  ['Binder 3-Ring 2 Inch', 8, 18],
  ['Index Cards 500', 4, 10],
  ['Tape Dispenser Desktop', 12, 28],
  ['Letter Tray Stacking', 15, 35],
  // Jewelry & Accessories
  ['Silver Pendant Necklace', 35, 89],
  ['Stud Earrings Gold Plated', 18, 45],
  ['Bracelet Leather Wrap', 22, 55],
  ['Ring Sterling Silver', 45, 120],
  ['Anklet Beaded', 12, 28],
  ['Brooch Vintage Style', 25, 65],
  ['Choker Chain', 15, 38],
  ['Hoop Earrings Medium', 22, 55],
  ['Cuff Bracelet Metal', 35, 89],
  ['Hair Clip Set 5', 5, 15],
  ['Watch Band Leather', 25, 65],
  ['Necklace Pearl Strand', 45, 120],
  ['Bangle Set 3', 28, 65],
  ['Ear Cuffs Pair', 18, 45],
  ['Keychain Leather', 8, 22],
  // Toys & Games
  ['Board Game Strategy', 28, 65],
  ['Puzzle 1000 Pieces', 15, 35],
  ['Action Figure Collectible', 22, 55],
  ['Building Blocks Set 500', 35, 79],
  ['Card Game Family', 12, 28],
  ['Plush Toy Medium', 18, 45],
  ['Remote Control Car', 35, 85],
  ['Art Supplies Set Kids', 22, 55],
  ['Science Kit DIY', 28, 65],
  ['Chess Set Wooden', 35, 89],
  ['Dice Set 7 Pack', 8, 18],
  ['Coloring Book Set 3', 10, 25],
  ['Sticker Pack Assorted', 5, 12],
  ['Slime Kit 5 Colors', 12, 28],
  ['Marble Run 100 Pieces', 22, 55],
  // Automotive
  ['Car Phone Mount', 15, 35],
  ['Dashboard Cam 1080p', 45, 99],
  ['Tire Pressure Gauge', 12, 28],
  ['Car Vacuum Cordless', 45, 95],
  ['Seat Cover Set 2', 35, 79],
  ['Jump Starter Portable', 65, 149],
  ['Car Air Freshener Pack', 5, 15],
  ['Bluetooth Car Adapter', 18, 45],
  ['Car Charger Dual USB', 12, 28],
  ['Steering Wheel Cover', 18, 45],
  ['Floor Mats Set 4', 35, 75],
  ['LED Interior Lights Kit', 28, 65],
  ['Windshield Sun Shade', 15, 35],
  ['Car Organizer Trunk', 22, 55],
  ['OBD2 Scanner Bluetooth', 35, 89],
  // Pet Supplies
  ['Pet Bowl Stainless Set', 15, 35],
  ['Dog Toy Chew', 8, 22],
  ['Cat Scratching Post', 28, 65],
  ['Pet Carrier Soft', 35, 79],
  ['Automatic Feeder', 45, 99],
  ['Flea Collar', 12, 28],
  ['Pet Grooming Brush', 12, 28],
  ['Litter Box Enclosed', 35, 75],
  ['Dog Bed Orthopedic', 45, 95],
  ['Aquarium Filter', 25, 55],
  ['Fish Food Flakes', 5, 12],
  ['Bird Cage Small', 45, 95],
  ['Hamster Wheel Silent', 15, 35],
  ['Rabbit Hutch', 55, 120],
  ['Reptile Heat Lamp', 18, 45],
  // Baby & Kids
  ['Baby Bottle Set 6', 22, 55],
  ['Diaper Bag Large', 35, 79],
  ['Baby Monitor Video', 65, 149],
  ['Stroller Lightweight', 89, 199],
  ['Baby Wipes 12 Pack', 18, 38],
  ['Bib Set 5 Pack', 8, 18],
  ['Nursing Pillow', 28, 65],
  ['Baby Thermometer Digital', 18, 45],
  ['High Chair Convertible', 75, 165],
  ['Baby Carrier Soft', 45, 99],
  ['Teething Ring Set', 8, 18],
  ['Baby Lotion Sensitive', 10, 25],
  ['Crib Mobile Musical', 22, 55],
  ['Changing Pad', 22, 48],
  ['Baby Soap Gentle', 8, 18],
];

// High-ticket items for variety
const HIGH_TICKET = [
  ['Premium Sofa 3-Seater', 899, 1899],
  ['Queen Mattress Memory Foam', 499, 999],
  ['Dining Table Oak 6-Seat', 599, 1299],
  ['TV Stand Entertainment', 189, 429],
  ['Office Chair Ergonomic', 249, 549],
  ['Standing Desk Electric', 399, 799],
  ['Patio Set 5-Piece', 299, 699],
  ['Treadmill Home', 499, 1299],
  ['Elliptical Machine', 399, 899],
  ['Projector 4K', 499, 1199],
  ['Sound Bar 5.1', 199, 499],
  ['Wine Cooler 24 Bottle', 299, 649],
  ['Refrigerator Compact', 249, 549],
  ['Microwave Convection', 149, 329],
  ['Dishwasher Slim', 399, 799],
  ['Washing Machine 8kg', 399, 899],
  ['Dryer Electric', 349, 749],
  ['Air Purifier HEPA', 149, 399],
  ['Dehumidifier 20L', 189, 429],
  ['Generator Portable 2000W', 399, 899],
];

function randomInRange(min, max) {
  return Math.round((min + Math.random() * (max - min)) * 100) / 100;
}

function main() {
  const db = getDb();
  const insert = db.prepare(
    'INSERT INTO products (title, price, image, vip_level) VALUES (?, ?, ?, 0)'
  );

  const allTemplates = [...CATEGORIES, ...HIGH_TICKET];
  let inserted = 0;
  const target = 1000;

  for (let i = 0; i < target; i++) {
    const [name, priceMin, priceMax] = allTemplates[i % allTemplates.length];
    const price = randomInRange(priceMin, priceMax);
    const suffix = i > allTemplates.length - 1 ? ' x ' + (Math.floor(i / allTemplates.length) + 1) : '';
    const title = name + suffix;
    const image = `https://picsum.photos/seed/${1000 + i}/400/400`;

    try {
      insert.run(title, price, image);
      inserted++;
    } catch (e) {
      console.warn('Skip:', title, e.message);
    }
  }

  console.log('Done. Inserted', inserted, 'products.');
}

main();
