// backend/scripts/seedDemo.js
// Run from the backend folder:  node scripts/seedDemo.js
// Wipes and recreates ONLY the tenants "savera" and "sweetcrumbs" (and their data). Other tenants are untouched.
require('dotenv').config();
const mongoose = require('mongoose');

const M = (n) => require(`../src/models/${n}`);
const Tenant = M('Tenant'), Category = M('Category'), Product = M('Product'), Banner = M('Banner');
const Coupon = M('Coupon'), Collection = M('Collection'), User = M('User'), Address = M('Address');
const Order = M('Order'), Review = M('Review'), Favourite = M('Favourite'), Counter = M('Counter');
const Session = M('Session'), OtpRequest = M('OtpRequest');
const { validateSettings } = require('../src/services/tenantConfigService');

const DAY = 86400000;
const now = Date.now();
// Placeholder stock photos by keyword (replace with your own later). lock= keeps each image stable.
const fs = require('fs');
const path = require('path');
const CACHE_FILE = path.join(__dirname, '.imgcache.json');
let CACHE = {};
try { CACHE = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { /* first run */ }

let n = 0;
// Uses a real photo when one was found, else the old placeholder.
const img = (kw, w = 640, h = 480) =>
    CACHE[kw] || `https://loremflickr.com/${w}/${h}/${encodeURIComponent(kw)}?lock=${++n}`;

async function getJson(url) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    try {
        const r = await fetch(url, { headers: { 'User-Agent': 'SeedDemo/1.0 (demo seed script)' }, signal: ctl.signal });
        return r.ok ? await r.json() : null;
    } catch { return null; } finally { clearTimeout(t); }
}

async function findPhoto(q) {
    const words = q.replace(/[,()]/g, ' ').replace(/\s+/g, ' ').trim();
    const parts = words.toLowerCase().split(' ').filter((w) => w.length > 3);

    // 1) TheMealDB: professional food photos. Accept only if the dish name shares a word with our query.
    const m = await getJson(`https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(words)}`);
    const meal = (m?.meals || []).find((x) => parts.some((w) => String(x.strMeal).toLowerCase().includes(w)));
    if (meal?.strMealThumb) return meal.strMealThumb;

    // 2) Wikimedia Commons: real photos by keyword
    const c = await getJson(
        'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=6'
        + `&gsrsearch=${encodeURIComponent(`${words} filetype:bitmap`)}&prop=imageinfo&iiprop=url|mime&iiurlwidth=800`,
    );
    const pages = Object.values(c?.query?.pages || {}).sort((a, b) => a.index - b.index);
    const hit = pages.find((p) => p.imageinfo?.[0]?.mime === 'image/jpeg');
    return hit?.imageinfo[0].thumburl || null;
}

async function preloadImages() {
    const qs = new Set();
    for (const def of [SAVERA, CRUMBS]) {
        for (const [, , items] of def.categories) for (const { name, o } of items) if (!o.noImg) qs.add(o.kw || name);
        def.banners.forEach((b) => qs.add(b[2]));
    }
    const todo = [...qs].filter((q) => !(q in CACHE));
    if (!todo.length) return;
    console.log(`Finding real photos for ${todo.length} items (first run only)...`);
    let found = 0;
    const queue = [...todo];
    await Promise.all(Array.from({ length: 5 }, async () => {
        while (queue.length) {
            const q = queue.shift();
            CACHE[q] = await findPhoto(q);
            if (CACHE[q]) found++;
        }
    }));
    fs.writeFileSync(CACHE_FILE, JSON.stringify(CACHE, null, 1));
    console.log(`Found ${found} of ${todo.length} photos. The rest use placeholders.`);
}

/* ------------------------------------------------------------------ item helper */
// opts: v(veg) m(mrp) kw(photo keyword) noImg best new gift egg(eggless) sugarFree jain spice serves kcal prep
//       rating count orders out(sold out) groups(optionGroups)
const item = (name, price, o = {}) => ({ name, price, o });
const group = (id, name, min, max, opts) => ({
    id, name, min, max,
    options: opts.map(([oid, oname, p, d]) => ({ id: oid, name: oname, price: p || 0, isDefault: !!d })),
});
const sizes = (a, b, c) => group('size', 'Choose size', 1, 1, [['regular', 'Regular', 0, true], ['large', 'Large', a], ...(b ? [['family', 'Family', b]] : [])].slice(0, c || 3));
const extras = (list) => group('extras', 'Add extras', 0, list.length, list.map(([x, p]) => [x.toLowerCase().replace(/\s+/g, '-'), x, p]));
const weight = (kgPrice) => group('weight', 'Choose weight', 1, 1, [['500g', '500 g', 0, true], ['1kg', '1 kg', kgPrice]]);

/* ------------------------------------------------------------------ SCENARIO 1: Savera */
const SAVERA = {
    tenant: {
        slug: 'savera', name: 'Savera', tagline: 'Delicious food, delivered to your door',
        colors: { primary: '#E23744', primaryLight: '#EE4B58', primaryDark: '#D42A38', background: '#FFFFFF', text: '#1C1C1C', error: '#C62828' },
        phone: '9876543210', address: { line: '12 Civil Lines', city: 'Kanpur', pincode: '208001' },
        delivery: { latitude: 26.4499, longitude: 80.3319, radiusKm: 8, minOrder: 149 },
        business: { legalName: 'Savera Foods Pvt Ltd' },
    },
    settings: {
        tabs: ['home', 'search', 'orders', 'profile'],
        home: {
            shopType: 'restaurant', foodMode: 'mixed', cardStyle: 'big',
            blocks: ['search', 'banner', 'categories', 'filters', 'offers', 'bestsellers', 'combos', 'new_arrivals', 'items'],
            filters: ['veg_only', 'egg_free', 'rating_4', 'offers', 'bestseller', 'new'],
            sortOptions: ['popularity', 'price_low', 'price_high', 'rating', 'prep_time', 'newest'],
            itemOptions: { sizes: true, addOns: true, spiceLevel: true, weightOptions: false },
        },
        features: { ratingBadge: true, prepTime: true, serves: false, calories: false, specialInstructions: true, scheduleOrder: false, reorder: true, favourites: true, guestBrowsing: true, couponField: true, tips: true, vegToggle: true, vegDot: true },
        menu: { outOfStock: 'dim', groupByCategory: true },
        orders: { types: ['delivery', 'pickup'], payments: ['cod'], minOrder: 149, deliveryFee: { type: 'flat', amount: 40, freeAbove: 499 }, packagingCharge: 10, gst: { mode: 'inclusive', percent: 5 }, tipOptions: [10, 20, 30], prepTimeMin: 30, acceptingOrders: true },
        offers: { couponsEnabled: true, showOnHome: true, showInCart: true },
        labels: { addButton: 'Add', orderButton: 'Place order', emptyCart: 'Your cart is empty', emptySearch: 'No dishes found', closedMessage: 'We are closed right now' },
    },
    banners: [
        ['Flat 50% off your first order', 'Use code FIRST50', 'biryani', 'FIRST50', true],
        ['Biryani Fest', 'Hyderabadi dum biryani, slow cooked', 'biryani,food', null],
        ['Free delivery above ₹499', 'Order more, pay less', 'burger,food', 'FLAT100'],
        ['Sweet endings', 'Desserts that hit the spot', 'dessert,sweet', null],
    ],
    coupons: [
        ['FIRST50', '50% off on your first order, up to ₹100', 'percent', 50, 100, 199, true],
        ['FLAT100', '₹100 off on orders above ₹499', 'flat', 100, null, 499, false],
        ['SAVE20', '20% off, up to ₹80', 'percent', 20, 80, 299, false],
        ['WEEKEND75', '₹75 off all weekend', 'flat', 75, null, 399, false],
    ],
    categories: [
        ['Starters', 'appetizer', [
            item('Paneer Tikka', 249, { m: 299, v: 1, kw: 'paneer,tikka', best: 1, rating: 4.5, count: 120, orders: 300, prep: 20, groups: [extras([['Mint chutney', 10], ['Extra cheese', 30]])] }),
            item('Chicken 65', 229, { m: 269, kw: 'fried,chicken', spice: 'hot', rating: 4.3, count: 88, orders: 210, prep: 20 }),
            item('Veg Spring Rolls', 159, { v: 1, kw: 'spring,rolls', rating: 4.0, count: 41, orders: 90, prep: 15 }),
            item('Crispy Corn', 179, { v: 1, kw: 'crispy,corn', jain: 1, rating: 4.1, count: 33, orders: 70, prep: 15 }),
            item('Chicken Wings', 269, { kw: 'chicken,wings', spice: 'hot', new: 1, rating: 0, prep: 25 }),
        ]],
        ['Biryani & Rice', 'biryani', [
            item('Hyderabadi Chicken Biryani', 329, { m: 379, kw: 'chicken,biryani', best: 1, spice: 'medium', rating: 4.7, count: 540, orders: 1200, prep: 35, groups: [sizes(120, 260), extras([['Raita', 30], ['Boiled egg', 20], ['Salan', 25]])] }),
            item('Veg Dum Biryani', 249, { v: 1, kw: 'veg,biryani', spice: 'mild', rating: 4.2, count: 150, orders: 380, prep: 30, groups: [sizes(90, 190)] }),
            item('Mutton Biryani', 429, { m: 489, kw: 'mutton,biryani', spice: 'hot', rating: 4.6, count: 210, orders: 450, prep: 40 }),
            item('Egg Fried Rice', 169, { kw: 'fried,rice,egg', rating: 3.9, count: 24, orders: 80, prep: 20 }),
            item('Jeera Rice', 129, { v: 1, egg: 1, noImg: 1, rating: 4.0, count: 12, orders: 60, prep: 15 }),
        ]],
        ['Main Course', 'curry', [
            item('Butter Chicken', 349, { m: 399, kw: 'butter,chicken', best: 1, spice: 'mild', rating: 4.8, count: 620, orders: 1500, prep: 30 }),
            item('Paneer Butter Masala', 289, { m: 329, v: 1, kw: 'paneer,butter,masala', best: 1, spice: 'mild', rating: 4.5, count: 300, orders: 900, prep: 25 }),
            item('Dal Makhani', 219, { v: 1, kw: 'dal,makhani', jain: 1, rating: 4.4, count: 180, orders: 520, prep: 25 }),
            item('Kadai Paneer', 279, { v: 1, kw: 'kadai,paneer', spice: 'medium', rating: 4.2, count: 70, orders: 190, prep: 25 }),
            item('Mutton Rogan Josh', 449, { kw: 'mutton,curry', spice: 'hot', rating: 4.5, count: 95, orders: 160, prep: 40 }),
        ]],
        ['Breads', 'naan', [
            item('Butter Naan', 45, { v: 1, egg: 1, kw: 'naan,bread', rating: 4.4, count: 400, orders: 2000, prep: 10 }),
            item('Garlic Naan', 59, { v: 1, egg: 1, kw: 'garlic,naan', rating: 4.5, count: 350, orders: 1700, prep: 10 }),
            item('Tandoori Roti', 25, { v: 1, egg: 1, kw: 'roti,bread', jain: 1, rating: 4.1, count: 90, orders: 800, prep: 8 }),
            item('Laccha Paratha', 55, { v: 1, noImg: 1, rating: 4.0, count: 20, orders: 140, prep: 12 }),
        ]],
        ['Burgers & Wraps', 'burger', [
            item('Classic Veg Burger', 129, { m: 159, v: 1, kw: 'veg,burger', rating: 4.0, count: 60, orders: 210, prep: 15 }),
            item('Chicken Zinger Burger', 189, { kw: 'chicken,burger', new: 1, rating: 4.3, count: 18, orders: 55, prep: 15 }),
            item('Paneer Wrap', 169, { v: 1, kw: 'paneer,wrap', new: 1, rating: 0, prep: 15 }),
            item('Peri Peri Fries', 119, { v: 1, kw: 'french,fries', spice: 'medium', rating: 4.2, count: 75, orders: 330, prep: 10 }),
        ]],
        ['Desserts', 'dessert', [
            item('Gulab Jamun (2 pc)', 99, { v: 1, kw: 'gulab,jamun', rating: 4.6, count: 200, orders: 600, prep: 5 }),
            item('Brownie Sundae', 179, { m: 219, v: 1, kw: 'brownie,icecream', new: 1, rating: 4.7, count: 30, orders: 90, prep: 10 }),
            item('Rasmalai', 129, { v: 1, kw: 'rasmalai', rating: 4.5, count: 66, orders: 150, prep: 5 }),
            item('Kulfi Falooda', 89, { v: 1, kw: 'kulfi', out: 1, rating: 4.3, count: 40, orders: 100, prep: 5 }),
        ]],
        ['Beverages', 'drink', [
            item('Masala Chai', 49, { v: 1, kw: 'masala,chai', rating: 4.5, count: 300, orders: 1400, prep: 5 }),
            item('Sweet Lassi', 89, { v: 1, kw: 'lassi', rating: 4.4, count: 120, orders: 400, prep: 5 }),
            item('Fresh Lime Soda', 79, { v: 1, kw: 'lime,soda', sugarFree: 1, rating: 4.0, count: 45, orders: 180, prep: 5 }),
            item('Cold Coffee', 129, { m: 149, v: 1, kw: 'cold,coffee', rating: 4.3, count: 90, orders: 350, prep: 8 }),
        ]],
        ['Combos', 'combo', [
            item('Biryani Feast Combo', 449, { m: 549, kw: 'biryani,thali', best: 1, rating: 4.6, count: 160, orders: 420, prep: 35 }),
            item('Veg Thali Combo', 299, { m: 359, v: 1, kw: 'indian,thali', rating: 4.4, count: 110, orders: 310, prep: 30 }),
        ]],
    ],
    collections: [
        { kind: 'combo', title: 'Meal Deals', subtitle: 'Complete meals, better prices', names: ['Biryani Feast Combo', 'Veg Thali Combo'] },
    ],
};

/* ------------------------------------------------------------------ SCENARIO 2: Sweet Crumbs (bakery) */
const CRUMBS = {
    tenant: {
        slug: 'sweetcrumbs', name: 'Sweet Crumbs', tagline: 'Freshly baked happiness',
        colors: { primary: '#9C4A2E', primaryLight: '#B25D3F', primaryDark: '#7E3A22', background: '#FFF8F0', text: '#2B1B14', error: '#B3261E' },
        phone: '9876501234', address: { line: '5 Swaroop Nagar', city: 'Kanpur', pincode: '208002' },
        delivery: { latitude: 26.4670, longitude: 80.3500, radiusKm: 6, minOrder: 0 },
    },
    settings: {
        tabs: ['home', 'search', 'orders', 'profile'],
        home: {
            shopType: 'bakery', foodMode: 'veg', cardStyle: 'grid',
            blocks: ['search', 'banner', 'categories', 'festival', 'filters', 'bestsellers', 'items'],
            filters: ['egg_free', 'sugar_free', 'jain', 'gift_pack', 'bestseller', 'offers', 'new'],
            sortOptions: ['popularity', 'price_low', 'price_high', 'rating', 'newest'],
            itemOptions: { sizes: false, addOns: false, spiceLevel: false, weightOptions: true },
        },
        features: { ratingBadge: true, prepTime: false, serves: true, calories: true, specialInstructions: true, scheduleOrder: true, reorder: true, favourites: true, guestBrowsing: true, couponField: true, tips: false, vegToggle: false, vegDot: false },
        menu: { outOfStock: 'dim', groupByCategory: true },
        orders: { types: ['delivery', 'pickup'], payments: ['cod'], minOrder: 0, deliveryFee: { type: 'free', amount: 0, freeAbove: 0 }, packagingCharge: 0, gst: { mode: 'none', percent: 0 }, tipOptions: [], prepTimeMin: 60, acceptingOrders: true },
        offers: { couponsEnabled: true, showOnHome: true, showInCart: true },
        labels: { addButton: 'Add to box', orderButton: 'Place order', emptyCart: 'Your box is empty', emptySearch: 'No bakes found', closedMessage: 'The oven is cooling. Back soon!' },
    },
    banners: [
        ['Custom cakes for every occasion', 'Order 24 hours ahead', 'birthday,cake', null],
        ['Festive hampers are here', 'Gift sweetness this season', 'sweets,mithai', 'GIFT15'],
        ['Fresh from the oven', 'Breads and buns baked every morning', 'bakery,bread', null],
    ],
    coupons: [
        ['GIFT15', '15% off gift boxes, up to ₹150', 'percent', 15, 150, 499, false],
        ['CAKE100', '₹100 off any cake above ₹699', 'flat', 100, null, 699, false],
        ['SWEET10', '10% off your first order', 'percent', 10, 100, 0, true],
    ],
    categories: [
        ['Cakes', 'cake', [
            item('Chocolate Truffle Cake', 549, { m: 649, v: 1, kw: 'chocolate,cake', best: 1, egg: 1, serves: 6, kcal: 380, rating: 4.8, count: 250, orders: 700, groups: [weight(520)] }),
            item('Black Forest Cake', 499, { v: 1, kw: 'blackforest,cake', egg: 1, serves: 6, kcal: 350, rating: 4.5, count: 180, orders: 480, groups: [weight(470)] }),
            item('Red Velvet Cake', 599, { m: 699, v: 1, kw: 'redvelvet,cake', egg: 1, new: 1, serves: 6, kcal: 400, rating: 4.7, count: 60, orders: 140, groups: [weight(560)] }),
            item('Pineapple Cake', 449, { v: 1, kw: 'pineapple,cake', egg: 1, serves: 6, kcal: 330, rating: 4.2, count: 90, orders: 260, groups: [weight(420)] }),
            item('Sugar-free Fruit Cake', 649, { v: 1, kw: 'fruit,cake', egg: 1, sugarFree: 1, serves: 8, kcal: 260, rating: 4.1, count: 22, orders: 50, groups: [weight(600)] }),
        ]],
        ['Pastries & Cupcakes', 'pastry', [
            item('Chocolate Pastry', 85, { m: 99, v: 1, kw: 'chocolate,pastry', serves: 1, kcal: 320, rating: 4.4, count: 140, orders: 900 }),
            item('Red Velvet Cupcake', 70, { v: 1, kw: 'cupcake', egg: 1, serves: 1, kcal: 260, rating: 4.3, count: 77, orders: 400 }),
            item('Blueberry Muffin', 80, { v: 1, kw: 'blueberry,muffin', serves: 1, kcal: 290, new: 1, rating: 0 }),
            item('Fudgy Brownie', 95, { v: 1, kw: 'brownie', egg: 1, serves: 1, kcal: 340, best: 1, rating: 4.6, count: 210, orders: 800 }),
        ]],
        ['Breads & Buns', 'bread', [
            item('Multigrain Bread', 65, { v: 1, kw: 'multigrain,bread', egg: 1, sugarFree: 1, serves: 6, kcal: 180, rating: 4.1, count: 55, orders: 300 }),
            item('Garlic Bread', 99, { m: 119, v: 1, kw: 'garlic,bread', egg: 1, serves: 2, kcal: 240, rating: 4.4, count: 120, orders: 500 }),
            item('Butter Croissant', 89, { v: 1, kw: 'croissant', serves: 1, kcal: 270, rating: 4.5, count: 66, orders: 210 }),
            item('Soft Pav (6 pc)', 30, { v: 1, egg: 1, jain: 1, noImg: 1, serves: 3, kcal: 150, rating: 3.9, count: 15, orders: 400 }),
        ]],
        ['Cookies & Tea Cakes', 'cookies', [
            item('Choco Chip Cookies (200 g)', 149, { v: 1, kw: 'chocolate,chip,cookies', best: 1, serves: 4, kcal: 480, rating: 4.6, count: 190, orders: 650 }),
            item('Nankhatai (250 g)', 120, { v: 1, kw: 'nankhatai,biscuit', egg: 1, jain: 1, serves: 5, kcal: 450, rating: 4.3, count: 48, orders: 180 }),
            item('Oats Jaggery Cookies', 169, { v: 1, kw: 'oatmeal,cookies', egg: 1, sugarFree: 1, serves: 4, kcal: 380, new: 1, rating: 4.0, count: 9 }),
            item('Plum Tea Cake', 199, { v: 1, kw: 'tea,cake', serves: 6, kcal: 310, out: 1, rating: 4.2, count: 30 }),
        ]],
        ['Gift Boxes & Sweets', 'mithai', [
            item('Dry Fruit Gift Box', 899, { m: 1099, v: 1, kw: 'dry,fruits,gift', gift: 1, serves: 8, rating: 4.7, count: 80, orders: 160 }),
            item('Assorted Cookie Hamper', 699, { m: 799, v: 1, kw: 'cookies,hamper', gift: 1, egg: 1, best: 1, serves: 8, rating: 4.6, count: 52, orders: 120 }),
            item('Festive Mithai Box', 799, { v: 1, kw: 'indian,sweets', gift: 1, new: 1, serves: 10, rating: 0 }),
            item('Kaju Katli (250 g)', 400, { v: 1, kw: 'kaju,katli', jain: 1, serves: 5, rating: 4.8, count: 140, orders: 380 }),
        ]],
    ],
    collections: [
        { kind: 'festival', title: 'Festive Gifting', subtitle: 'Hampers and boxes for your loved ones', names: ['Dry Fruit Gift Box', 'Assorted Cookie Hamper', 'Festive Mithai Box', 'Kaju Katli (250 g)'] },
    ],
};

/* ------------------------------------------------------------------ settings validation */
// The blocks format in settings is not known to this script, so both shapes are tried.
function buildSettings(base) {
    const asStrings = base;
    const asObjects = { ...base, home: { ...base.home, blocks: base.home.blocks.map((type) => ({ type, enabled: true })) } };
    for (const s of [asStrings, asObjects]) {
        const v = validateSettings(s);
        if (v.ok) return s;
        if (s === asObjects) {
            console.error('\nSettings rejected by validateSettings. Paste these errors to Claude:\n - ' + v.errors.join('\n - '));
            process.exit(1);
        }
    }
}

/* ------------------------------------------------------------------ seeding */
async function wipe(slug) {
    const t = await Tenant.findOne({ slug });
    if (!t) return;
    const f = { tenantId: t._id };
    await Promise.all([Category, Product, Banner, Coupon, Collection, User, Address, Order, Review, Favourite, Session, OtpRequest]
        .map((Mod) => Mod.deleteMany(f)));
    await Counter.deleteOne({ _id: `order:${t._id}` });
    await Tenant.deleteOne({ _id: t._id });
}

async function seed(def, customerPhone) {
    await wipe(def.tenant.slug);
    const settings = buildSettings(def.settings);
    const tenant = await new Tenant({ ...def.tenant, heroImages: [], settings }).save();
    const tid = tenant._id;

    // categories + products
    const products = {};
    let catOrder = 0;
    for (const [name, kw, items] of def.categories) {
        const cat = await Category.create({ tenantId: tid, name, sortOrder: catOrder++ });
        let i = 0;
        for (const { name: pname, price, o } of items) {
            const p = await Product.create({
                tenantId: tid, categoryId: cat._id, name: pname, price, mrp: o.m,
                description: `${pname}, made fresh to order.`,
                image: o.noImg ? undefined : img(o.kw || pname),
                isVeg: !!o.v, isEggless: !!o.egg, isSugarFree: !!o.sugarFree, isJain: !!o.jain,
                spiceLevel: o.spice || 'none',
                isBestseller: !!o.best, isNewArrival: !!o.new, isGiftPack: !!o.gift,
                serves: o.serves, calories: o.kcal, prepTimeMin: o.prep,
                optionGroups: o.groups || [],
                rating: o.rating || 0, ratingCount: o.count || 0, orderCount: o.orders || 0,
                isAvailable: !o.out, sortOrder: i++,
            });
            products[pname] = p;
            if (p.image && !cat.image) { cat.image = p.image; await cat.save(); }
        }
    }

    // banners
    let bo = 0;
    for (const [title, subtitle, kw, couponCode, firstOrderOnly] of def.banners) {
        await Banner.create({ tenantId: tid, title, subtitle, image: img(kw, 900, 400), couponCode: couponCode || undefined, firstOrderOnly: !!firstOrderOnly, sortOrder: bo++ });
    }

    // coupons
    for (const [code, description, discountType, discountValue, maxDiscount, minOrder, firstOrderOnly] of def.coupons) {
        await Coupon.create({ tenantId: tid, code, description, discountType, discountValue, maxDiscount: maxDiscount || undefined, minOrder, firstOrderOnly, startsAt: new Date(now - DAY), endsAt: new Date(now + 60 * DAY) });
    }

    // collections (festival / combo strips)
    let co = 0;
    for (const c of def.collections) {
        await Collection.create({ tenantId: tid, kind: c.kind, title: c.title, subtitle: c.subtitle, image: products[c.names[0]].image || img(c.title, 900, 400), productIds: c.names.map((x) => products[x]._id), startsAt: new Date(now - DAY), endsAt: new Date(now + 30 * DAY), sortOrder: co++ });
    }

    // users: one customer (log in with this number) and one shop owner
    const customer = await User.create({ tenantId: tid, phone: customerPhone, name: 'Demo Customer', role: 'customer' });
    await User.create({ tenantId: tid, phone: def.tenant.phone, name: `${def.tenant.name} Owner`, role: 'admin' });
    const addr = await Address.create({ tenantId: tid, userId: customer._id, label: 'Home', name: 'Demo Customer', phone: customerPhone, line1: 'B-14, Sunrise Apartments', line2: 'Near City Mall', landmark: 'Opposite the park', city: 'Kanpur', pincode: '208001', latitude: def.tenant.delivery.latitude + 0.01, longitude: def.tenant.delivery.longitude + 0.01, isDefault: true });
    await Address.create({ tenantId: tid, userId: customer._id, label: 'Work', name: 'Demo Customer', phone: customerPhone, line1: '3rd Floor, Tech Park', city: 'Kanpur', pincode: '208002', latitude: def.tenant.delivery.latitude - 0.01, longitude: def.tenant.delivery.longitude - 0.01 });

    // favourites
    const all = Object.values(products);
    for (const p of all.filter((x) => x.isBestseller).slice(0, 3)) {
        await Favourite.create({ tenantId: tid, userId: customer._id, productId: p._id });
    }

    // ---------- orders: every status, spread over ~2 months, so every screen can be tested ----------
    const MIN = 60000, D = 1440;                    // minutes in a day
    const all2 = Object.values(products);
    const sold = all2.find((x) => !x.isAvailable);  // a sold-out dish, to test Reorder skipping
    const at = (i) => all2[i % all2.length];

    // ago = minutes ago. lines = [[productIndex, qty], ...]. rate = [stars, comment] means already reviewed.
    const SPECS = [
        { ago: 55 * D, st: 'delivered', type: 'delivery', lines: [[1, 1], [8, 2]], rate: [5, 'Loved it, will order again!'] },
        { ago: 41 * D, st: 'delivered', type: 'pickup', lines: [[3, 2]], rate: [4, ''] },
        { ago: 33 * D, st: 'cancelled', type: 'delivery', lines: [[6, 1]], by: 'shop', reason: 'Item not available' },
        { ago: 27 * D, st: 'delivered', type: 'delivery', lines: [[0, 1], [12, 1]], coupon: def.coupons[0][0] },
        { ago: 20 * D, st: 'delivered', type: 'delivery', lines: [[5, 2], [9, 1]], tip: def.settings.orders.tipOptions[0] || 0, rate: [3, 'Food was good but a bit late.'] },
        { ago: 14 * D, st: 'cancelled', type: 'delivery', lines: [[2, 1]], by: 'customer', reason: 'Changed my mind' },
        { ago: 9 * D, st: 'delivered', type: 'pickup', lines: [[7, 1], [10, 1]] },
        { ago: 6 * D, st: 'delivered', type: 'delivery', lines: [[4, 1], [11, 2], ...(sold ? [['SOLD', 1]] : [])], rate: [5, 'Best in town. Packaging was great.'] },
        { ago: 4 * D, st: 'delivered', type: 'delivery', lines: [[13, 1], [14, 1]], note: 'Please do not ring the bell' },
        { ago: 2 * D, st: 'cancelled', type: 'delivery', lines: [[15, 1]], by: 'admin', reason: 'Shop closed early' },
        { ago: 1 * D, st: 'delivered', type: 'delivery', lines: [[16, 1], [17, 1]], rate: [2, 'Arrived cold.'] },
        { ago: 40, st: 'out_for_delivery', type: 'delivery', lines: [[1, 1], [3, 1]] },
        { ago: 25, st: 'ready', type: 'pickup', lines: [[8, 1]] },
        { ago: 15, st: 'preparing', type: 'delivery', lines: [[0, 1], [7, 1]] },
        { ago: 3, st: 'placed', type: 'delivery', lines: [[5, 1]] },
    ].sort((a, b) => b.ago - a.ago);               // oldest first, so order numbers go up with time

    const FLOW = {
        delivery: ['placed', 'accepted', 'preparing', 'out_for_delivery', 'delivered'],
        pickup: ['placed', 'accepted', 'preparing', 'ready', 'delivered'],
    };
    const round2 = (x) => Math.round(x * 100) / 100;
    const oc = def.settings.orders;

    function priceOf(items, spec) {
        const subtotal = items.reduce((a, l) => a + l.lineTotal, 0);
        const c = spec.coupon && def.coupons.find((x) => x[0] === spec.coupon);
        let discount = 0;
        if (c && subtotal >= (c[5] || 0)) {
            discount = c[2] === 'percent' ? Math.min(Math.floor((subtotal * c[3]) / 100), c[4] || Infinity) : c[3];
        }
        const fd = oc.deliveryFee || {};
        const deliveryFee = spec.type !== 'delivery' || fd.type === 'free' ? 0 : (fd.freeAbove && subtotal >= fd.freeAbove ? 0 : fd.amount || 0);
        const packagingCharge = oc.packagingCharge || 0;
        const tip = spec.tip || 0;
        const g = oc.gst || { mode: 'none', percent: 0 };
        const base = subtotal - discount;
        const tax = g.mode === 'inclusive' ? round2((base * g.percent) / (100 + g.percent)) : g.mode === 'exclusive' ? round2((base * g.percent) / 100) : 0;
        const total = round2(base + deliveryFee + packagingCharge + tip + (g.mode === 'exclusive' ? tax : 0));
        return { subtotal, discount, couponCode: discount ? spec.coupon : undefined, deliveryFee, packagingCharge, tax, taxMode: g.mode, tip, total };
    }

    let no = 0;
    for (const spec of SPECS) {
        no += 1;
        const when = new Date(now - spec.ago * MIN);
        const items = spec.lines.map(([i, q]) => {
            const p = i === 'SOLD' ? sold : at(i);
            return { productId: p._id, name: p.name, image: p.image, isVeg: p.isVeg, quantity: q, unitPrice: p.price, lineTotal: p.price * q, selections: [] };
        });

        let steps;
        if (spec.st === 'cancelled') steps = ['placed', ...(spec.ago > 60 ? ['accepted'] : []), 'cancelled'];
        else steps = FLOW[spec.type].slice(0, FLOW[spec.type].indexOf(spec.st) + 1);
        const statusHistory = steps.map((status, k) => ({ status, at: new Date(+when + k * 10 * MIN) }));
        const delivered = spec.st === 'delivered';

        // pickup orders carry a time window
        let scheduledFor, pickupUntil;
        if (spec.type === 'pickup') {
            scheduledFor = new Date(+when + (delivered || spec.st === 'cancelled' ? 60 : 30) * MIN);
            pickupUntil = new Date(+scheduledFor + 2 * 60 * MIN);
        }

        const order = await Order.create({
            tenantId: tid, userId: customer._id, orderNo: no, status: spec.st, orderType: spec.type, items,
            pricing: priceOf(items, spec),
            seller: { name: def.tenant.name },
            payment: { method: 'cod', status: delivered ? 'paid' : 'pending' },
            customer: { name: 'Demo Customer', phone: customerPhone },
            address: spec.type === 'delivery'
                ? { label: addr.label, name: addr.name, phone: addr.phone, line1: addr.line1, line2: addr.line2, landmark: addr.landmark, city: addr.city, pincode: addr.pincode, latitude: addr.latitude, longitude: addr.longitude }
                : undefined,
            note: spec.note,
            etaMin: 35,
            scheduledFor, pickupUntil,
            statusHistory,
            cancelReason: spec.st === 'cancelled' ? spec.reason : undefined,
            cancelledBy: spec.st === 'cancelled' ? spec.by : undefined,
            deliveredAt: delivered ? new Date(+when + 45 * MIN) : undefined,
            ratedAt: delivered && spec.rate ? new Date(+when + 90 * MIN) : undefined,
            createdAt: when, updatedAt: when,
        });

        // reviews: one per dish, same as the app sends them
        if (delivered && spec.rate) {
            const seen = new Set();
            for (const l of order.items) {
                if (seen.has(String(l.productId))) continue;
                seen.add(String(l.productId));
                await Review.create({ tenantId: tid, userId: customer._id, orderId: order._id, productId: l.productId, rating: spec.rate[0], ...(spec.rate[1] ? { comment: spec.rate[1] } : {}) });
            }
        }
    }
    await Counter.findOneAndUpdate({ _id: `order:${tid}` }, { seq: SPECS.length }, { upsert: true });

    console.log(`✔ ${def.tenant.slug}: ${all.length} products, ${def.categories.length} categories, ${def.banners.length} banners, ${def.coupons.length} coupons, ${SPECS.length} orders. Customer login: ${customerPhone}, owner: ${def.tenant.phone}`);
}

(async () => {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) throw new Error('Set MONGO_URI (or MONGODB_URI) in your .env');
    await preloadImages();
    await mongoose.connect(uri);
    await seed(SAVERA, '8318538918');
    await seed(CRUMBS, '9454326498');
    console.log('\nDone. Restart the backend once so it drops any cached "tenant not found".');
    await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });