require('./helpers/env');
const { describe, test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const sharp = require('sharp');
const db = require('./helpers/db');
const f = require('./helpers/factory');
const appModule = require('../src/server/app');
const app = appModule.app || appModule;
const qr = require('../src/services/qrCodes');
const Tenant = require('../src/models/Tenant');

let n = 0;
before(() => db.connect());
after(() => db.disconnect());
beforeEach(async () => { await db.clear(); });
afterEach(() => { mock.restoreAll(); delete process.env.QR_BASE_URL; delete process.env.DEMO_SITE_URL; });

const bin = (res, cb) => { res.buffer(true); res.parse((r, done) => { const parts = []; r.on('data', (c) => parts.push(c)); r.on('end', () => done(null, Buffer.concat(parts))); }); return cb ? res.then(cb) : res; };
async function dineShop(tables = 4) {
    const t = await f.makeTenant(`qr-shop-${++n}-${Date.now()}`, { logo: 'https://cdn.example.com/logo.png' });
    await Tenant.updateOne({ _id: t._id }, { $set: { 'settings.orders.dineIn': { enabled: true, tableCount: tables } } });
    return t;
}
const adminH = async (phones) => ({ Authorization: `Bearer ${(await f.makeSuperAdmin(`qr${++n}@test.com`, phones ? { phones } : undefined)).token}` });
const get = (url, h) => bin(request(app).get(url).set(h));

describe('the short permanent addresses', () => {
    test('/q/demo leads to the demo website, and the destination can change without reprinting', async () => {
        let r = await request(app).get('/q/demo').redirects(0);
        assert.equal(r.status, 302);
        assert.equal(r.headers.location, 'https://demo.vivyaan.co.in');
        assert.match(r.headers['cache-control'], /no-store/);
        process.env.DEMO_SITE_URL = 'https://tryit.example.com/';
        r = await request(app).get('/q/demo').redirects(0);
        assert.equal(r.headers.location, 'https://tryit.example.com');
    });

    test('/q/t/<shop>/<table> leads to that table, and refuses a table that does not exist', async () => {
        const t = await dineShop(4);
        const ok = await request(app).get(`/q/t/${t.slug}/3`).redirects(0);
        assert.equal(ok.status, 302);
        assert.match(ok.headers.location, new RegExp(`/api/dinein/t/${t.slug}/3\\?k=`));
        assert.equal((await request(app).get(`/q/t/${t.slug}/5`).redirects(0)).status, 404);
        assert.equal((await request(app).get(`/q/t/${t.slug}/0`).redirects(0)).status, 404);
        assert.equal((await request(app).get('/q/t/no-such-shop/1').redirects(0)).status, 404);
    });
});

describe('QR downloads for the superadmin', () => {
    test('they need a login', async () => {
        assert.equal((await request(app).get('/api/admin/qr/demo')).status, 401);
    });

    test('info: a temporary address warns "do not print", our own https domain does not', async () => {
        const h = await adminH();
        let r = await request(app).get('/api/admin/qr/info').set(h);
        assert.equal(r.body.permanent, false);
        assert.match(r.body.warning, /Do NOT print/);
        process.env.QR_BASE_URL = 'https://vivyaan.co.in';
        r = await request(app).get('/api/admin/qr/info').set(h);
        assert.equal(r.body.permanent, true);
        assert.equal(r.body.warning, null);
        assert.equal(r.body.demo.link, 'https://vivyaan.co.in/q/demo');
    });

    test('the demo code: SVG is vector with a quiet zone and never a logo; the code holds only the short address', async () => {
        process.env.QR_BASE_URL = 'https://vivyaan.co.in';
        const h = await adminH();
        const r = await get('/api/admin/qr/demo?format=svg&logo=1', h);
        assert.equal(r.status, 200);
        assert.match(r.headers['content-type'], /image\/svg\+xml/);
        assert.match(r.headers['content-disposition'], /demo-qr\.svg/);
        assert.equal(r.headers['x-qr-link'], 'https://vivyaan.co.in/q/demo');
        const svg = r.body.toString();
        assert.ok(svg.startsWith('<svg'));
        assert.ok(!svg.includes('<image'), 'the demo code never carries a logo');
        const { n } = qr.matrixOf('https://vivyaan.co.in/q/demo');
        assert.ok(svg.includes(`viewBox="0 0 ${n + 8} ${n + 8}"`), 'a 4 square quiet zone on every side');
    });

    test('PNG comes at the size and the DPI asked for', async () => {
        const h = await adminH();
        const r = await get('/api/admin/qr/demo?format=png&sizePx=1500&dpi=600', h);
        assert.equal(r.status, 200);
        assert.equal(r.body.subarray(1, 4).toString(), 'PNG');
        const meta = await sharp(r.body).metadata();
        assert.equal(meta.width, 1500);
        assert.equal(meta.height, 1500);
        assert.ok(Math.abs(meta.density - 600) <= 1, `dpi ${meta.density}`);
    });

    test('PDF is vector at the physical size asked for (a 200 mm banner code)', async () => {
        const h = await adminH();
        const r = await get('/api/admin/qr/demo?format=pdf&sizeMm=200', h);
        assert.equal(r.status, 200);
        assert.equal(r.body.subarray(0, 4).toString(), '%PDF');
        const media = /MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(r.body.toString('latin1'));
        assert.ok(media, 'a page size');
        assert.ok(Math.abs(Number(media[1]) - 200 * 72 / 25.4) < 1);
    });

    test('bad options are refused', async () => {
        const h = await adminH();
        assert.equal((await request(app).get('/api/admin/qr/demo?format=gif').set(h)).status, 400);
        assert.equal((await request(app).get('/api/admin/qr/demo?format=png&sizePx=10').set(h)).status, 400);
        assert.equal((await request(app).get('/api/admin/qr/demo?format=pdf&sizeMm=99999').set(h)).status, 400);
    });

    test('a table code: no logo by default, the shop logo in the middle only when asked', async () => {
        const t = await dineShop(4);
        const h = await adminH();
        const png = await sharp({ create: { width: 200, height: 100, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } }).png().toBuffer();
        mock.method(global, 'fetch', async () => ({ ok: true, arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.length) }));
        const plain = await get(`/api/admin/qr/tables/${t._id}?table=2&format=svg`, h);
        assert.equal(plain.status, 200);
        assert.ok(!plain.body.toString().includes('<image'));
        assert.equal(plain.headers['x-qr-link'], `${plain.headers['x-qr-link'].split('/q/')[0]}/q/t/${t.slug}/2`);
        const withLogo = await get(`/api/admin/qr/tables/${t._id}?table=2&format=svg&logo=1`, h);
        assert.ok(withLogo.body.toString().includes('<image'), 'the logo is in the middle');
        const { n } = qr.matrixOf(plain.headers['x-qr-link']);
        assert.ok(Math.floor(n * 0.2) / (n + 8) < 0.2, 'the logo is smaller than a fifth of the code');
        const asPng = await get(`/api/admin/qr/tables/${t._id}?table=2&format=png&logo=1&sizePx=800`, h);
        assert.equal((await sharp(asPng.body).metadata()).width, 800);
    });

    test('all tables: one PDF sheet with every table; svg or png for all is refused; a table that does not exist is refused', async () => {
        const t = await dineShop(8);
        const h = await adminH();
        const sheet = await get(`/api/admin/qr/tables/${t._id}?table=all&format=pdf`, h);
        assert.equal(sheet.status, 200);
        assert.equal(sheet.body.subarray(0, 4).toString(), '%PDF');
        const pages = (sheet.body.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
        assert.equal(pages, 2, '8 tables at 6 to a page is 2 pages');
        assert.match(sheet.headers['content-disposition'], /table-qr-sheet\.pdf/);
        assert.equal((await request(app).get(`/api/admin/qr/tables/${t._id}?table=all&format=png`).set(h)).status, 400);
        assert.equal((await request(app).get(`/api/admin/qr/tables/${t._id}?table=9&format=svg`).set(h)).status, 400);
    });

    test('a shop without dine in has no table codes', async () => {
        const t = await f.makeTenant(`qr-nodine-${++n}-${Date.now()}`);
        const h = await adminH();
        assert.equal((await request(app).get(`/api/admin/qr/tables/${t._id}?table=1&format=svg`).set(h)).status, 409);
        assert.equal((await request(app).get('/api/admin/qr/tables/nonsense?table=1').set(h)).status, 404);
    });
});

describe('the drawn code is the real code', () => {
    test('rendering the SVG gives exactly the squares of the QR matrix (so a phone camera reads it)', async () => {
        const text = 'https://vivyaan.co.in/q/t/savera/12';
        const { n, dark } = qr.matrixOf(text);
        const px = 10;
        const raw = await sharp(Buffer.from(qr.svgOf(text)), { density: 72 * px }).resize((n + 8) * px, (n + 8) * px, { kernel: 'nearest' }).greyscale().raw().toBuffer();
        const W = (n + 8) * px;
        let wrong = 0;
        for (let r = 0; r < n; r += 1) {
            for (let c = 0; c < n; c += 1) {
                const v = raw[(((r + 4) * px) + px / 2) * W + ((c + 4) * px) + px / 2];
                if ((v < 128) !== dark(r, c)) wrong += 1;
            }
        }
        assert.equal(wrong, 0);
        assert.equal(raw[2 * W + 2], 255, 'the quiet zone is white');
    });
});

describe('the owner printable stickers', () => {
    test('hold the same short permanent address as the superadmin downloads', async () => {
        const QRCode = require('qrcode');
        const tableQr = require('../src/services/tableQr');
        const t = await dineShop(3);
        const req = { protocol: 'https', get: () => 'api.example.com' };
        const html = await tableQr.printHtml(req, await Tenant.findById(t._id).lean(), false, 'small');
        const want = await QRCode.toString(qr.tableLink(req, t.slug, 1), { type: 'svg', margin: 1, errorCorrectionLevel: 'H', width: 220 });
        assert.ok(html.includes(want), 'sticker 1 holds /q/t/<shop>/1');
        assert.ok(html.includes('Table 3'));
    });
});
