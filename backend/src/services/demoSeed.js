// Fills the public demo shop (slug "demo") with a full, believable shop: menu with free photos, banners, coupons, a combo strip, services,
// table booking, bulk orders, points, pretend customers, riders, staff, reviews, a month of past orders, and a brand with 3 branches.
// Everything is fake. seed() can be run again at any time: it wipes the demo shop's CONTENT and rebuilds it (the demo people and their
// logins are kept). Phase 4's Reset uses it. Photos: backend/src/data/demoPhotos.json (sources in docs/demo-photo-sources.md).
const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const Brand = require('../models/Brand');
const Category = require('../models/Category');
const Product = require('../models/Product');
const Banner = require('../models/Banner');
const Coupon = require('../models/Coupon');
const Collection = require('../models/Collection');
const User = require('../models/User');
const Address = require('../models/Address');
const Order = require('../models/Order');
const Review = require('../models/Review');
const Favourite = require('../models/Favourite');
const Counter = require('../models/Counter');
const Staff = require('../models/Staff');
const Rider = require('../models/Rider');
const ShopService = require('../models/ShopService');
const TableBookingConfig = require('../models/TableBookingConfig');
const BulkSettings = require('../models/BulkSettings');
const LoyaltyAccount = require('../models/LoyaltyAccount');
const { hashPhone } = require('../utils/phoneHash');
const { validateSettings } = require('./tenantConfigService');
const demoTenant = require('./demoTenant');
const PHOTOS = require('../data/demoPhotos.json');

const DAY = 86400000;
const MIN = 60000;
const LAT = 26.4499;
const LNG = 80.3319;
const photo = (k) => (PHOTOS[k] ? PHOTOS[k].url : undefined);

/* ---------------------------------------------------------------- the menu */
const item = (name, price, o = {}) => ({ name, price, o });
const group = (id, name, min, max, opts) => ({ id, name, min, max, options: opts.map(([oid, oname, p, d]) => ({ id: oid, name: oname, price: p || 0, isDefault: !!d })) });
const sizes = (a, b) => group('size', 'Choose size', 1, 1, [['regular', 'Regular', 0, true], ['large', 'Large', a], ...(b ? [['family', 'Family', b]] : [])]);
const extras = (list) => group('extras', 'Add extras', 0, list.length, list.map(([x, p]) => [x.toLowerCase().replace(/\s+/g, '-'), x, p]));

const MENU = [
    ['Starters', 'paneer tikka', [
        item('Paneer Tikka', 249, { m: 299, v: 1, ph: 'paneer tikka', best: 1, rating: 4.5, count: 120, orders: 300, prep: 20, groups: [extras([['Mint chutney', 10], ['Extra cheese', 30]])] }),
        item('Chicken 65', 229, { m: 269, ph: 'chicken 65', spice: 'hot', rating: 4.3, count: 88, orders: 210, prep: 20 }),
        item('Veg Spring Rolls', 159, { v: 1, ph: 'spring rolls', rating: 4.0, count: 41, orders: 90, prep: 15 }),
        item('Crispy Corn', 179, { v: 1, ph: 'crispy corn', jain: 1, rating: 4.1, count: 33, orders: 70, prep: 15 }),
        item('Veg Samosa (2 pc)', 49, { v: 1, ph: 'samosa', rating: 4.4, count: 210, orders: 900, prep: 8 }),
    ]],
    ['Biryani & Rice', 'chicken biryani', [
        item('Hyderabadi Chicken Biryani', 329, { m: 379, ph: 'chicken biryani', best: 1, spice: 'medium', rating: 4.7, count: 540, orders: 1200, prep: 35, groups: [sizes(120, 260), extras([['Raita', 30], ['Boiled egg', 20]])] }),
        item('Veg Dum Biryani', 249, { v: 1, ph: 'veg biryani', spice: 'mild', rating: 4.2, count: 150, orders: 380, prep: 30, groups: [sizes(90, 190)] }),
        item('Mutton Biryani', 429, { m: 489, ph: 'mutton biryani', spice: 'hot', rating: 4.6, count: 210, orders: 450, prep: 40 }),
        item('Egg Fried Rice', 169, { ph: 'fried rice', rating: 3.9, count: 24, orders: 80, prep: 20 }),
    ]],
    ['Main Course', 'butter chicken', [
        item('Butter Chicken', 349, { m: 399, ph: 'butter chicken', best: 1, spice: 'mild', rating: 4.8, count: 620, orders: 1500, prep: 30 }),
        item('Paneer Butter Masala', 289, { m: 329, v: 1, ph: 'paneer butter masala', best: 1, spice: 'mild', rating: 4.5, count: 300, orders: 900, prep: 25 }),
        item('Dal Makhani', 219, { v: 1, ph: 'dal makhani', jain: 1, rating: 4.4, count: 180, orders: 520, prep: 25 }),
        item('Paneer Curry', 279, { v: 1, ph: 'paneer', spice: 'medium', rating: 4.2, count: 70, orders: 190, prep: 25 }),
        item('Chole Bhature', 149, { v: 1, ph: 'chole bhature', rating: 4.5, count: 260, orders: 700, prep: 15 }),
        item('Pav Bhaji', 139, { v: 1, ph: 'pav bhaji', rating: 4.3, count: 130, orders: 410, prep: 15 }),
    ]],
    ['Breads', 'naan', [
        item('Butter Naan', 45, { v: 1, egg: 1, ph: 'naan', rating: 4.4, count: 400, orders: 2000, prep: 10 }),
        item('Tandoori Roti', 25, { v: 1, egg: 1, ph: 'roti', jain: 1, rating: 4.1, count: 90, orders: 800, prep: 8 }),
        item('Laccha Paratha', 55, { v: 1, ph: 'paratha', rating: 4.0, count: 20, orders: 140, prep: 12 }),
    ]],
    ['South Indian', 'masala dosa', [
        item('Masala Dosa', 129, { v: 1, ph: 'masala dosa', best: 1, rating: 4.5, count: 190, orders: 520, prep: 15 }),
        item('Idli Sambar (3 pc)', 89, { v: 1, ph: 'idli', egg: 1, rating: 4.3, count: 110, orders: 330, prep: 10 }),
    ]],
    ['Burgers, Pizza & Snacks', 'veg burger', [
        item('Classic Cheese Burger', 139, { m: 169, v: 1, ph: 'veg burger', rating: 4.0, count: 60, orders: 210, prep: 15 }),
        item('Chicken Zinger Burger', 189, { ph: 'chicken burger', new: 1, rating: 4.3, count: 18, orders: 55, prep: 15 }),
        item('Margherita Pizza', 249, { v: 1, ph: 'pizza', rating: 4.2, count: 75, orders: 230, prep: 20, groups: [sizes(100, 220)] }),
        item('Penne Pasta', 199, { v: 1, ph: 'pasta', new: 1, rating: 0, prep: 18 }),
        item('Grilled Sandwich', 119, { v: 1, ph: 'sandwich', rating: 4.0, count: 44, orders: 150, prep: 10 }),
        item('Veg Momos (8 pc)', 129, { v: 1, ph: 'momos', spice: 'medium', rating: 4.4, count: 160, orders: 480, prep: 15 }),
    ]],
    ['Desserts', 'gulab jamun', [
        item('Gulab Jamun (2 pc)', 99, { v: 1, ph: 'gulab jamun', rating: 4.6, count: 200, orders: 600, prep: 5 }),
        item('Fudgy Brownie', 129, { m: 159, v: 1, ph: 'brownie', new: 1, rating: 4.7, count: 30, orders: 90, prep: 8 }),
        item('Rasmalai', 129, { v: 1, ph: 'rasmalai', rating: 4.5, count: 66, orders: 150, prep: 5 }),
        item('Kulfi', 89, { v: 1, ph: 'kulfi', out: 1, rating: 4.3, count: 40, orders: 100, prep: 5 }),
        item('Chocolate Cake Slice', 149, { v: 1, ph: 'chocolate cake', egg: 1, rating: 4.4, count: 52, orders: 170, prep: 5 }),
    ]],
    ['Beverages', 'chai', [
        item('Masala Chai', 49, { v: 1, ph: 'chai', rating: 4.5, count: 300, orders: 1400, prep: 5 }),
        item('Sweet Lassi', 89, { v: 1, ph: 'lassi', rating: 4.4, count: 120, orders: 400, prep: 5 }),
        item('Fresh Lime Soda', 79, { v: 1, ph: 'lime soda', sugarFree: 1, rating: 4.0, count: 45, orders: 180, prep: 5 }),
        item('Cold Coffee', 129, { m: 149, v: 1, ph: 'cold coffee', rating: 4.3, count: 90, orders: 350, prep: 8 }),
    ]],
    ['Combos', 'thali', [
        item('Biryani Feast Combo', 449, { m: 549, ph: 'chicken biryani', best: 1, rating: 4.6, count: 160, orders: 420, prep: 35 }),
        item('Veg Thali Combo', 299, { m: 359, v: 1, ph: 'thali', rating: 4.4, count: 110, orders: 310, prep: 30 }),
    ]],
];

const BANNERS = [
    ['Flat 50% off your first order', 'Use code FIRST50', 'banner dessert', 'FIRST50', true],
    ['Biryani Fest', 'Dum biryani, slow cooked', 'chicken biryani', null],
    ['Free delivery above Rs 499', 'Order more, pay less', 'banner pizza', 'FLAT100'],
    ['Book a table for the weekend', 'Pick your own table', 'banner cafe', null],
];
const COUPONS = [
    ['FIRST50', '50% off on your first order, up to Rs 100', 'percent', 50, 100, 199, true],
    ['FLAT100', 'Rs 100 off on orders above Rs 499', 'flat', 100, null, 499, false],
    ['SAVE20', '20% off, up to Rs 80', 'percent', 20, 80, 299, false],
    ['WEEKEND75', 'Rs 75 off all weekend', 'flat', 75, null, 399, false],
];

const SETTINGS = {
    tabs: ['home', 'search', 'orders', 'profile'],
    home: {
        shopType: 'restaurant', foodMode: 'mixed', cardStyle: 'big',
        blocks: ['search', 'banner', 'categories', 'filters', 'offers', 'bestsellers', 'combos', 'new_arrivals', 'items'],
        filters: ['veg_only', 'egg_free', 'rating_4', 'offers', 'bestseller', 'new'],
        sortOptions: ['popularity', 'price_low', 'price_high', 'rating', 'prep_time', 'newest'],
        itemOptions: { sizes: true, addOns: true, spiceLevel: true, weightOptions: false },
    },
    features: { ratingBadge: true, prepTime: true, serves: false, calories: false, specialInstructions: true, scheduleOrder: true, reorder: true, favourites: true, guestBrowsing: true, couponField: true, tips: true, vegToggle: true, vegDot: true, directions: true, services: true, tableBooking: true, bulkOrders: true },
    menu: { outOfStock: 'dim', groupByCategory: true },
    orders: {
        types: ['delivery', 'pickup', 'dine_in'], payments: ['cod'], minOrder: 149, deliveryFee: { type: 'flat', amount: 40, freeAbove: 499 },
        packagingCharge: 10, gst: { mode: 'inclusive', percent: 5 }, tipOptions: [10, 20, 30], prepTimeMin: 30, acceptingOrders: true,
        dineIn: { enabled: true, tableCount: 8 }, staff: { kitchenOn: true, waiterOn: true, max: 10 },
    },
    offers: { couponsEnabled: true, showOnHome: true, showInCart: true },
    labels: { addButton: 'Add', orderButton: 'Place order', emptyCart: 'Your cart is empty', emptySearch: 'No dishes found', closedMessage: 'We are closed right now' },
};

function buildSettings() {
    const asObjects = { ...SETTINGS, home: { ...SETTINGS.home, blocks: SETTINGS.home.blocks.map((type) => ({ type, enabled: true })) } };
    for (const s of [SETTINGS, asObjects]) { if (validateSettings(s).ok) return s; }
    throw new Error(`Demo settings rejected: ${validateSettings(asObjects).errors.join('; ')}`);
}

/* ---------------------------------------------------------------- helpers */
const CONTENT_MODELS = () => [Category, Product, Banner, Coupon, Collection, Order, Review, Favourite, Address, ShopService, TableBookingConfig, BulkSettings, LoyaltyAccount,
    require('../models/ServiceInquiry'), require('../models/TableBooking'), require('../models/BulkOrder'), require('../models/Complaint'), require('../models/Notification'),
    require('../models/Cart'), require('../models/ChatMessage')];

async function wipeContent(tenantId) {
    const f = { tenantId };
    await Promise.all(CONTENT_MODELS().map((M) => M.deleteMany(f).catch(() => { })));
    await Counter.deleteOne({ _id: `order:${tenantId}` }).catch(() => { });
}

async function makeCustomer(tenant, phone, name) {
    return User.findOneAndUpdate({ tenantId: tenant._id, phone },
        { $set: { name, role: 'customer', phoneHash: hashPhone(tenant._id, phone) } }, { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true });
}

async function seedMenu(tenant) {
    const tid = tenant._id;
    const products = {};
    let co = 0;
    for (const [name, phKey, items] of MENU) {
        const cat = await Category.create({ tenantId: tid, name, sortOrder: co++, image: photo(phKey) });
        let i = 0;
        for (const { name: pname, price, o } of items) {
            const p = await Product.create({
                tenantId: tid, categoryId: cat._id, name: pname, price, mrp: o.m, description: `${pname}, made fresh to order.`, image: photo(o.ph),
                isVeg: !!o.v, isEggless: !!o.egg, isSugarFree: !!o.sugarFree, isJain: !!o.jain, spiceLevel: o.spice || 'none',
                isBestseller: !!o.best, isNewArrival: !!o.new, prepTimeMin: o.prep, optionGroups: o.groups || [],
                rating: o.rating || 0, ratingCount: o.count || 0, orderCount: o.orders || 0, isAvailable: !o.out, sortOrder: i++,
            });
            products[pname] = p;
        }
    }
    return products;
}

async function seedOffers(tenant, products) {
    const tid = tenant._id;
    let bo = 0;
    for (const [title, subtitle, ph, couponCode, firstOrderOnly] of BANNERS) {
        await Banner.create({ tenantId: tid, title, subtitle, image: photo(ph), couponCode: couponCode || undefined, firstOrderOnly: !!firstOrderOnly, sortOrder: bo++ });
    }
    for (const [code, description, discountType, discountValue, maxDiscount, minOrder, firstOrderOnly] of COUPONS) {
        await Coupon.create({ tenantId: tid, code, description, discountType, discountValue, maxDiscount: maxDiscount || undefined, minOrder, firstOrderOnly, usageLimitPerUser: 5, startsAt: new Date(Date.now() - DAY), endsAt: new Date(Date.now() + 3650 * DAY) });
    }
    await Collection.create({ tenantId: tid, kind: 'combo', title: 'Meal Deals', subtitle: 'Complete meals, better prices', image: photo('thali'), productIds: [products['Biryani Feast Combo']._id, products['Veg Thali Combo']._id] });
}

async function seedServices(tenant) {
    const tid = tenant._id;
    const shopServices = require('./shopServices');
    const qs = (kind) => { try { return (shopServices.recommendedFor(kind) || []).slice(0, 8); } catch (e) { return []; } };
    const defs = [
        { kind: 'party', name: 'Party catering', icon: 'balloon-outline', description: 'Food for your birthday, kitty party or office lunch, cooked fresh and delivered hot.', priceType: 'per_plate', price: 350, minGuests: 15, noticeHours: 48, bullets: ['Veg and non-veg menus', 'Live counters on request', 'Staff and serving on request'], quickTexts: ['I want to plan a birthday party', 'Please send the menu and price'] },
        { kind: 'tiffin', name: 'Monthly tiffin', icon: 'restaurant-outline', description: 'Home style lunch and dinner at your door every day.', priceType: 'per_month', price: 3200, noticeHours: 24, bullets: ['Lunch, dinner or both', 'Change the menu weekly'], quickTexts: ['Is there a trial day?', 'Do you deliver near me?'] },
        { kind: 'custom', name: 'Corporate lunch boxes', icon: 'briefcase-outline', description: 'Neat lunch boxes for your team, with a bill for your company.', priceType: 'from', price: 180, minGuests: 10, noticeHours: 24, bullets: ['GST bill', 'Daily or weekly plans'], quickTexts: ['We are 25 people', 'Please call me'] },
    ];
    let so = 0;
    for (const d of defs) await ShopService.create({ tenantId: tid, ...d, questions: qs(d.kind), sortOrder: so++ });
}

async function seedBooking(tenant) {
    const tid = tenant._id;
    const tables = Array.from({ length: 8 }, (_, i) => ({ no: String(i + 1), seats: i < 4 ? 2 : i < 7 ? 4 : 6, bookable: true }));
    await TableBookingConfig.create({
        tenantId: tid, enabled: true, windows: [{ days: [], open: '12:00', close: '23:00' }], slotMinutes: 90, tables, seatsPerSlot: 30, minParty: 1, maxParty: 8,
        advanceDays: 14, minNoticeMinutes: 60, depositType: 'per_person', depositAmount: 50, depositMode: 'adjust', refundHours: 2, holdMinutes: 10, autoAllow: true, maxActive: 3,
    });
    await BulkSettings.create({ tenantId: tid, enabled: true, minOrderAmount: 3000, noticeHours: 24, maxQtyPerDish: 200, pickup: true, delivery: true, deliveryFee: { type: 'free' }, packagingCharge: 0 });
}

async function seedTeam(tenant) {
    const tid = tenant._id;
    const mk = async (phone, name, role) => User.findOneAndUpdate({ tenantId: tid, phone },
        { $set: { name, role, phoneHash: hashPhone(tid, phone) } }, { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true });
    for (const [phone, name, role] of [['6000000011', 'Anita (cook)', 'kitchen'], ['6000000012', 'Rohit (waiter)', 'waiter']]) {
        const u = await mk(phone, name, role);
        await Staff.updateOne({ tenantId: tid, userId: u._id }, { $setOnInsert: { role, name, isActive: true } }, { upsert: true });
    }
    for (const [phone, name, online] of [['6000000031', 'Imran (rider)', true], ['6000000032', 'Deepak (rider)', false]]) {
        const u = await mk(phone, name, 'rider');
        await Rider.updateOne({ tenantId: tid, userId: u._id }, { $setOnInsert: { name, isActive: true, isOnline: online, vehicle: { type: 'Bike', number: 'UP78 AB 1234' }, ratingAvg: 4.6, ratingCount: 40, deliveryCount: 120 } }, { upsert: true });
    }
    await Rider.updateOne({ tenantId: tid, userId: (await User.findOne({ tenantId: tid, phone: demoTenant.PEOPLE.rider.phone }))?._id }, { $set: { ratingAvg: 4.8, ratingCount: 64, deliveryCount: 210 } });
}

const NAMES = ['Priya Sharma', 'Rahul Verma', 'Sneha Gupta', 'Amit Singh', 'Kavya Nair', 'Vikram Rao'];

async function seedPeopleAndHistory(tenant, products) {
    const tid = tenant._id;
    const demoCust = await makeCustomer(tenant, demoTenant.PEOPLE.customer.phone, demoTenant.PEOPLE.customer.name);
    const people = [demoCust];
    for (let i = 0; i < NAMES.length; i += 1) people.push(await makeCustomer(tenant, `60000001${String(i).padStart(2, '0')}`.slice(0, 10), NAMES[i]));
    const home = { label: 'Home', line1: 'B-14, Sunrise Apartments', line2: 'Near City Mall', landmark: 'Opposite the park', city: 'Kanpur', pincode: '208001', latitude: LAT + 0.012, longitude: LNG + 0.01 };
    const addrOf = {};
    for (const u of people) {
        addrOf[String(u._id)] = await Address.create({ tenantId: tid, userId: u._id, name: u.name, phone: u.phone, ...home });
    }
    const list = Object.values(products);
    for (const p of list.filter((x) => x.isBestseller).slice(0, 3)) await Favourite.create({ tenantId: tid, userId: demoCust._id, productId: p._id });

    const riderUser = await User.findOne({ tenantId: tid, phone: demoTenant.PEOPLE.rider.phone });
    const COMMENTS = ['Loved it, will order again!', 'Hot and tasty, on time.', 'Good food, a bit late.', 'Best in town.', ''];
    const FLOW = ['placed', 'accepted', 'preparing', 'out_for_delivery', 'delivered'];
    let no = 0;
    const rounds = 26;
    for (let k = 0; k < rounds; k += 1) {
        no += 1;
        const user = people[k % people.length];
        const when = new Date(Date.now() - (rounds - k) * 1.1 * DAY - ((k * 37) % 600) * MIN);
        const picks = [list[(k * 3) % list.length], list[(k * 5 + 2) % list.length]].filter((p) => p.isAvailable);
        const items = picks.map((p, i) => ({ productId: p._id, name: p.name, image: p.image, isVeg: p.isVeg, quantity: 1 + ((k + i) % 2), unitPrice: p.price, lineTotal: p.price * (1 + ((k + i) % 2)), selections: [] }));
        const subtotal = items.reduce((a, l) => a + l.lineTotal, 0);
        const deliveryFee = subtotal >= 499 ? 0 : 40;
        const total = subtotal + deliveryFee + 10;
        const a = addrOf[String(user._id)];
        const cancelled = k % 11 === 7;
        const steps = cancelled ? ['placed', 'cancelled'] : FLOW;
        const order = await Order.create({
            tenantId: tid, userId: user._id, orderNo: no, status: cancelled ? 'cancelled' : 'delivered', orderType: 'delivery', items,
            pricing: { subtotal, discount: 0, deliveryFee, packagingCharge: 10, tax: 0, taxMode: 'inclusive', tip: 0, total },
            seller: { name: tenant.name }, payment: { method: 'cod', status: cancelled ? 'pending' : 'paid' },
            customer: { name: user.name, phone: user.phone, phoneHash: hashPhone(tid, user.phone) },
            address: { label: a.label, name: a.name, phone: a.phone, line1: a.line1, line2: a.line2, landmark: a.landmark, city: a.city, pincode: a.pincode, latitude: a.latitude, longitude: a.longitude },
            etaMin: 35, statusHistory: steps.map((status, i) => ({ status, at: new Date(+when + i * 10 * MIN) })),
            cancelReason: cancelled ? 'Changed my mind' : undefined, cancelledBy: cancelled ? 'customer' : undefined,
            deliveredAt: cancelled ? undefined : new Date(+when + 45 * MIN), ratedAt: cancelled ? undefined : new Date(+when + 90 * MIN),
            ...(riderUser && !cancelled ? { riderId: riderUser._id } : {}),
            createdAt: when, updatedAt: when,
        });
        if (!cancelled) {
            const stars = [5, 4, 5, 3, 5][k % 5];
            await Review.create({ tenantId: tid, userId: user._id, orderId: order._id, productId: items[0].productId, rating: stars, ...(COMMENTS[k % 5] ? { comment: COMMENTS[k % 5] } : {}) }).catch(() => { });
        }
    }
    await Counter.findOneAndUpdate({ _id: `order:${tid}` }, { seq: no }, { upsert: true });
    await LoyaltyAccount.create({ tenantId: tid, userId: demoCust._id, balance: 240, lifetime: 640 });
    return demoCust;
}

// the demo brand: the demo shop and two more branches that carry the same menu
async function seedBranches(tenant, products) {
    const brand = (await Brand.findOne({ mainTenantId: tenant._id })) || (await Brand.create({ name: 'Demo Kitchens', mainTenantId: tenant._id, ownerPhones: [demoTenant.PEOPLE.admin.phone], locations: { includedBranches: 2 } }));
    await Tenant.updateOne({ _id: tenant._id }, { $set: { brandId: brand._id, branchCity: 'Kanpur Civil Lines' } });
    for (const [slug, name, city] of [['demo-city', 'Demo Shop - City Centre', 'Kanpur City Centre'], ['demo-mall', 'Demo Shop - Mall Road', 'Kanpur Mall Road']]) {
        let b = await Tenant.findOne({ slug });
        if (!b) {
            b = await Tenant.create({
                slug, name, isDemo: true, tagline: tenant.tagline, brandId: brand._id, branchCity: city, phone: tenant.phone, address: { ...(tenant.address || {}), line: city },
                colors: tenant.colors, settings: tenant.settings, delivery: tenant.delivery, billing: { state: 'active', isLive: false },
                plan: { id: 'pro', startedAt: new Date(), endsAt: new Date('2099-12-31') },
            });
        }
        await wipeContent(b._id);
        const cats = {};
        for (const c of await Category.find({ tenantId: tenant._id }).sort({ sortOrder: 1 }).lean()) {
            const { _id, tenantId, createdAt, updatedAt, __v, ...rest } = c;
            cats[String(_id)] = (await Category.create({ ...rest, tenantId: b._id }))._id;
        }
        for (const p of Object.values(products)) {
            const { _id, tenantId, createdAt, updatedAt, __v, ...rest } = p.toObject();
            await Product.create({ ...rest, tenantId: b._id, categoryId: cats[String(p.categoryId)] });
        }
        for (const [code, description, discountType, discountValue, maxDiscount, minOrder, firstOrderOnly] of COUPONS) {
            await Coupon.create({ tenantId: b._id, code, description, discountType, discountValue, maxDiscount: maxDiscount || undefined, minOrder, firstOrderOnly, startsAt: new Date(Date.now() - DAY), endsAt: new Date(Date.now() + 3650 * DAY) });
        }
    }
}

async function seed() {
    let t = await demoTenant.ensureTenant();
    const heroImages = [photo('chicken biryani'), photo('banner dessert'), photo('banner pizza')].filter(Boolean);
    await Tenant.updateOne({ _id: t._id }, {
        $set: {
            name: 'Demo Shop', tagline: 'A shop to try the app', phone: '6000000001',
            colors: { primary: '#E23744', primaryLight: '#EE4B58', primaryDark: '#D42A38', background: '#FFFFFF', text: '#1C1C1C', error: '#C62828' },
            address: { line: '12 Civil Lines', city: 'Kanpur', state: 'Uttar Pradesh', pincode: '208001' },
            delivery: { latitude: LAT, longitude: LNG, radiusKm: 8, minOrder: 149 },
            heroImages, settings: buildSettings(), isDemo: true, status: 'active',
        },
    });
    await wipeContent(t._id);
    const products = await seedMenu(t);
    await seedOffers(t, products);
    await seedServices(t);
    await seedBooking(t);
    await seedTeam(t);
    await seedPeopleAndHistory(t, products);
    t = await Tenant.findById(t._id);
    await seedBranches(t, products);
    require('../middlewares/tenantRecognizer').invalidateTenant(t.slug);
    for (const s of ['demo-city', 'demo-mall']) require('../middlewares/tenantRecognizer').invalidateTenant(s);
    return { products: Object.keys(products).length, categories: MENU.length };
}

module.exports = { seed, wipeContent, MENU, COUPONS };
