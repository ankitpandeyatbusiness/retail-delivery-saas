// Run from the project root:  node src/scripts/seedDemoShop.js
// Creates (or re-creates) one demo shop with slug "demo". Safe to run again.
// It does NOT touch orders, users or any other shop.
require('dotenv').config();
const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const Category = require('../models/Category');
const Product = require('../models/Product');
const Banner = require('../models/Banner');
const Collection = require('../models/Collection');

const SLUG = 'demo';
const img = (seed, w = 600, h = 400) => `https://picsum.photos/seed/${seed}/${w}/${h}`;

const sizeGroup = (largeExtra) => ({
    id: 'size', name: 'Choose size', min: 1, max: 1,
    options: [
        { id: 'regular', name: 'Regular', price: 0, isDefault: true },
        { id: 'large', name: 'Large', price: largeExtra },
    ],
});

const extrasGroup = (items) => ({
    id: 'extras', name: 'Add extras', min: 0, max: 3,
    options: items.map(([id, name, price]) => ({ id, name, price })),
});

async function main() {
    await mongoose.connect(process.env.MONGODB_URI);

    // 1. remove the old demo shop (if any)
    const old = await Tenant.findOne({ slug: SLUG });
    if (old) {
        await Promise.all([Product, Category, Banner, Collection].map((M) => M.deleteMany({ tenantId: old._id })));
        await old.deleteOne();
        console.log('Old demo shop removed');
    }

    // 2. the shop
    const tenant = await Tenant.create({
        slug: SLUG,
        name: 'Demo Kitchen',
        tagline: 'Fresh food, fast at your door',
        logo: img('demo-logo', 200, 200),
        colors: {
            primary: '#D32F2F',
            primaryLight: '#FFEBEE',
            primaryDark: '#B71C1C',
            background: '#FFFFFF',
            text: '#1C1C1C',
            error: '#D32F2F',
        },
        heroImages: [img('demo-hero-1', 900, 500), img('demo-hero-2', 900, 500)],
        phone: '9876543210',
        address: { line: '12 Mall Road', city: 'Kanpur', pincode: '208001' },
        delivery: { latitude: 26.4499, longitude: 80.3319, radiusKm: 8, minOrder: 100 },
        homeConfig: {
            shopType: 'restaurant',
            foodMode: 'mixed',
            blocks: ['banner', 'categories', 'filters', 'festival', 'combos', 'bestsellers', 'new_arrivals', 'items']
                .map((type) => ({ type, enabled: true })),
            filters: ['veg_only', 'rating_4', 'price_range', 'offers', 'bestseller', 'sugar_free', 'spice_level', 'gift_pack'],
            sortOptions: ['popularity', 'price_low', 'price_high', 'rating', 'prep_time', 'newest'],
            cardStyle: 'big',
            itemOptions: { sizes: true, addOns: true, spiceLevel: true, weightOptions: false },
        },
    });

    // 3. categories
    const catNames = ['Starters', 'Main Course', 'Breads', 'Desserts', 'Drinks', 'Combos'];
    const cats = await Category.insertMany(catNames.map((name, i) => ({
        tenantId: tenant._id, name, image: img(`cat-${name}`, 300, 300), sortOrder: i,
    })));
    const cat = Object.fromEntries(cats.map((c) => [c.name, c._id]));

    // 4. products
    const P = (category, name, price, extra = {}) => ({
        tenantId: tenant._id,
        categoryId: cat[category],
        name,
        price,
        image: img(`p-${name}`),
        description: `${name}, freshly made to order.`,
        prepTimeMin: 20,
        ...extra,
    });

    const products = await Product.insertMany([
        P('Starters', 'Paneer Tikka', 220, { isVeg: true, mrp: 260, isBestseller: true, spiceLevel: 'medium', serves: 2, optionGroups: [sizeGroup(80)] }),
        P('Starters', 'Veg Spring Roll', 140, { isVeg: true, spiceLevel: 'mild' }),
        P('Starters', 'Chicken 65', 260, { isVeg: false, isBestseller: true, spiceLevel: 'hot', serves: 2 }),
        P('Main Course', 'Dal Makhani', 240, { isVeg: true, isBestseller: true, serves: 2, optionGroups: [sizeGroup(90)] }),
        P('Main Course', 'Butter Chicken', 320, { isVeg: false, mrp: 360, isBestseller: true, serves: 2, optionGroups: [sizeGroup(110)] }),
        P('Main Course', 'Veg Biryani', 230, { isVeg: true, isNewArrival: true, serves: 2, optionGroups: [extrasGroup([['raita', 'Raita', 30], ['salad', 'Salad', 20], ['papad', 'Papad', 15]])] }),
        P('Breads', 'Butter Naan', 50, { isVeg: true }),
        P('Desserts', 'Gulab Jamun (2 pcs)', 90, { isVeg: true, isBestseller: true }),
        P('Desserts', 'Chocolate Brownie', 130, { isVeg: true, isNewArrival: true, isEggless: false }),
        P('Drinks', 'Sweet Lassi', 80, { isVeg: true, optionGroups: [sizeGroup(30)] }),
        P('Drinks', 'Fresh Lime Soda', 60, { isVeg: true, isSugarFree: false }),
        P('Combos', 'Paneer Meal Combo', 379, { isVeg: true, mrp: 450, description: 'Paneer Tikka + Dal Makhani + 2 Naan + Gulab Jamun' }),
        P('Combos', 'Chicken Meal Combo', 449, { isVeg: false, mrp: 540, description: 'Butter Chicken + 2 Naan + Sweet Lassi' }),
    ]);
    const prod = Object.fromEntries(products.map((p) => [p.name, p._id]));

    // 5. banners
    await Banner.insertMany([
        { tenantId: tenant._id, title: 'Welcome to Demo Kitchen', subtitle: 'Hot food, delivered fast', image: img('banner-1', 900, 400), sortOrder: 0 },
        { tenantId: tenant._id, title: 'Try our new Veg Biryani', subtitle: 'Just launched', image: img('banner-2', 900, 400), sortOrder: 1 },
    ]);

    // 6. collections (home strips)
    await Collection.insertMany([
        {
            tenantId: tenant._id, kind: 'festival', title: "Chef's Specials", subtitle: 'Hand-picked for you',
            image: img('col-1', 900, 400), sortOrder: 0,
            productIds: [prod['Paneer Tikka'], prod['Butter Chicken'], prod['Veg Biryani'], prod['Gulab Jamun (2 pcs)']],
        },
        {
            tenantId: tenant._id, kind: 'combo', title: 'Meal Deals', subtitle: 'Save more with combos',
            image: img('col-2', 900, 400), sortOrder: 1,
            productIds: [prod['Paneer Meal Combo'], prod['Chicken Meal Combo']],
        },
    ]);

    console.log(`Done. Shop slug: "${SLUG}"  (tenantId ${tenant._id})`);
    console.log(`Products: ${products.length}, categories: ${cats.length}`);
    await mongoose.disconnect();
}

main().catch(async (err) => {
    console.error('Seed failed:', err.message);
    if (err.errors) Object.values(err.errors).forEach((e) => console.error(' -', e.message));
    await mongoose.disconnect().catch(() => { });
    process.exit(1);
});