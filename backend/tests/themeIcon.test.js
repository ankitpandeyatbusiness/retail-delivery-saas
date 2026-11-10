require('./helpers/env');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const Tenant = require('../src/models/Tenant');
const tenantRecognizer = require('../src/middlewares/tenantRecognizer');
const { makeTenant } = require('./helpers/factory');

describe('the theme carries the shop icon (the website tab icon)', () => {
    before(() => db.connect());
    after(() => db.disconnect());

    test('icon is the shop\'s app icon on the media storage; logo stays the owner\'s own logo', async () => {
        const old = process.env.MEDIA_CDN_URL;
        process.env.MEDIA_CDN_URL = 'https://cdn.example.com/';
        try {
            const t = await makeTenant('icon-shop');
            await Tenant.updateOne({ _id: t._id }, { $set: { logo: 'https://cdn.example.com/own-logo.png' } });
            tenantRecognizer.invalidateTenant(t.slug);
            const r = await request(app).get('/api/tenants/theme').set('x-tenant-slug', t.slug);
            assert.equal(r.status, 200);
            assert.equal(r.body.icon, 'https://cdn.example.com/tenants/icon-shop/branding/icon.png');
            assert.equal(r.body.logo, 'https://cdn.example.com/own-logo.png');
        } finally { if (old === undefined) delete process.env.MEDIA_CDN_URL; else process.env.MEDIA_CDN_URL = old; }
    });

    test('with no media storage set up the icon is null, never a broken address', async () => {
        const old = { a: process.env.MEDIA_CDN_URL, b: process.env.R2_PUBLIC_URL };
        delete process.env.MEDIA_CDN_URL; delete process.env.R2_PUBLIC_URL;
        try {
            const t = await makeTenant('no-icon-shop');
            const r = await request(app).get('/api/tenants/theme').set('x-tenant-slug', t.slug);
            assert.equal(r.status, 200);
            assert.equal(r.body.icon, null);
        } finally {
            if (old.a !== undefined) process.env.MEDIA_CDN_URL = old.a;
            if (old.b !== undefined) process.env.R2_PUBLIC_URL = old.b;
        }
    });
});
