// "Go-live checks" for the public demo and the QR banners: one list of what is ready and what still has to be done before the banners are printed and the
// link is handed out (superadmin app > More > Demo login). Each check is ok, warn (works, but look) or todo (do this first). Nothing here changes anything.
const Tenant = require('../models/Tenant');
const Product = require('../models/Product');
const PlatformSettings = require('../models/PlatformSettings');
const demoTenant = require('./demoTenant');
const demoMode = require('./demoMode');
const qr = require('./qrCodes');

const row = (key, label, status, detail) => ({ key, label, status, detail });

async function build(req) {
    const checks = [];

    // 1. the demo shop and its content
    const shop = await Tenant.findOne({ slug: demoTenant.SLUG, isDemo: true }).select('_id name').lean();
    const dishes = shop ? await Product.countDocuments({ tenantId: shop._id }) : 0;
    checks.push(shop && dishes >= 20
        ? row('shop', 'Demo shop', 'ok', `${dishes} dishes, ready.`)
        : row('shop', 'Demo shop', 'todo', 'The demo shop has no menu yet. It is built when the server starts, or run: npm run seed:demo'));

    // 2. the shop plays cook and rider by itself, and resets at night
    const engineOff = process.env.DEMO_ENGINE === 'off';
    checks.push(engineOff
        ? row('engine', 'Orders move by themselves', 'todo', 'DEMO_ENGINE is set to off on the server. Remove it so a visitor\'s order is accepted, cooked and delivered.')
        : row('engine', 'Orders move by themselves', 'ok', 'The demo shop accepts, cooks and delivers visitors\' orders, and resets every night at 4 AM.'));

    // 3. the company shown on the welcome screen
    const b = ((await PlatformSettings.findById('main').select('business').lean()) || {}).business || {};
    checks.push(b.legalName
        ? row('company', 'Company name on the welcome screen', 'ok', b.legalName)
        : row('company', 'Company name on the welcome screen', 'warn', `Not set, so the screen says "${demoTenant.DEFAULT_COMPANY}". Set the legal name in More > Business details if it should say something else.`));
    checks.push(b.logoUrl
        ? row('logo', 'Company logo on the welcome screen', 'ok', 'Set.')
        : row('logo', 'Company logo on the welcome screen', 'warn', 'Not set: the welcome screen shows the first letter of the company name instead.'));

    // 4. the addresses
    const base = qr.baseOf(req);
    checks.push(qr.isPermanent(base)
        ? row('qr', 'QR address', 'ok', `${base} (your own https address: printed codes will keep working).`)
        : row('qr', 'QR address', 'todo', `${base} is a temporary address. Set QR_BASE_URL on the server to your own domain BEFORE you print anything.`));
    const site = qr.demoDestination();
    const siteSet = !!process.env.DEMO_SITE_URL || !!process.env.PLATFORM_WEB_DOMAIN || !!process.env.WEB_BASE_DOMAIN;
    checks.push(siteSet
        ? row('site', 'Demo website address', 'ok', site)
        : row('site', 'Demo website address', 'todo', `The demo QR would lead to ${site}, a guess. Set DEMO_SITE_URL (or PLATFORM_WEB_DOMAIN) on the server, and connect the demo project to that address in Vercel.`));
    let origin = '';
    try { origin = new URL(site).origin; } catch (e) { origin = ''; }
    checks.push(origin && require('../middlewares/corsPolicy').isAllowedOrigin(origin)
        ? row('cors', 'Browser access', 'ok', `${origin} may call the server.`)
        : row('cors', 'Browser access', 'todo', `The server would refuse the demo website (${origin || 'no address'}). Add it to CORS_ORIGINS on the server.`));

    // 5. the server stays awake
    const prod = process.env.NODE_ENV === 'production';
    checks.push(prod && process.env.SERVER_URL
        ? row('awake', 'Server stays awake', 'warn', 'The server pings itself every 14 minutes, but a sleeping free server cannot wake itself. Use a paid Render plan, or a free pinger (for example UptimeRobot) that opens /health every 5 minutes, so the first visitor never waits a minute.')
        : row('awake', 'Server stays awake', 'todo', 'Set SERVER_URL and use a paid Render plan (or a pinger on /health every 5 minutes) so the demo opens at once.'));

    // 6. the private login for friends and Razorpay
    const d = await demoMode.status();
    checks.push(d.enabled
        ? row('login', 'Private demo login', 'ok', `Number ${d.phone} is on. Change the OTP when Razorpay gives you the live keys.`)
        : row('login', 'Private demo login', 'warn', 'Not set. Set a number and OTP below so friends and Razorpay\'s reviewers can open any shop as a new person.'));

    const todo = checks.filter((c) => c.status === 'todo').length;
    const warn = checks.filter((c) => c.status === 'warn').length;
    return { ready: todo === 0, todo, warn, checks };
}

module.exports = { build };
