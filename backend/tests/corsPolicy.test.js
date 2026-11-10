require('./helpers/env');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('./helpers/db');
const app = require('../src/server/app');
const { isAllowedOrigin } = require('../src/middlewares/corsPolicy');

const withEnv = (vars, fn) => {
    const old = {};
    for (const k of Object.keys(vars)) { old[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
    try { return fn(); } finally { for (const k of Object.keys(old)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } }
};

describe('which websites may call the API', () => {
    before(() => db.connect());
    after(() => db.disconnect());

    test('shop addresses and the platform domain are allowed; strangers are not', () => {
        withEnv({ NODE_ENV: 'production', CORS_ORIGINS: undefined, CORS_ALLOW_LOCAL: undefined }, () => {
            assert.equal(isAllowedOrigin(undefined), true, 'the phone apps send no Origin');
            assert.equal(isAllowedOrigin('https://savera.vivyaan.co.in'), true);
            assert.equal(isAllowedOrigin('https://vivyaan.co.in'), true);
            assert.equal(isAllowedOrigin('https://evil.example.com'), false);
            assert.equal(isAllowedOrigin('https://vivyaan.co.in.evil.com'), false, 'a look-alike address');
            assert.equal(isAllowedOrigin('https://notvivyaan.co.in'), false);
            assert.equal(isAllowedOrigin('http://savera.vivyaan.co.in'), false, 'plain http is not a shop address');
            assert.equal(isAllowedOrigin('http://localhost:8081'), false, 'localhost is for development only');
            assert.equal(isAllowedOrigin('null'), false);
        });
    });

    test('while developing, localhost and the local network are allowed', () => {
        withEnv({ NODE_ENV: 'development', CORS_ORIGINS: undefined }, () => {
            assert.equal(isAllowedOrigin('http://localhost:8081'), true);
            assert.equal(isAllowedOrigin('http://192.168.1.12:8081'), true);
            assert.equal(isAllowedOrigin('http://evil.example.com'), false);
        });
    });

    test('a custom domain can be listed in CORS_ORIGINS', () => {
        withEnv({ NODE_ENV: 'production', CORS_ORIGINS: 'https://order.mybrand.com, https://eat.other.in/' }, () => {
            assert.equal(isAllowedOrigin('https://order.mybrand.com'), true);
            assert.equal(isAllowedOrigin('https://eat.other.in'), true);
            assert.equal(isAllowedOrigin('https://mybrand.com'), false);
        });
    });

    test('the server answers a shop website with CORS headers and a stranger without', async () => {
        await withEnv({ NODE_ENV: 'production', CORS_ORIGINS: undefined }, async () => {
            const ok = await request(app).get('/health').set('Origin', 'https://savera.vivyaan.co.in');
            assert.equal(ok.headers['access-control-allow-origin'], 'https://savera.vivyaan.co.in');
            const bad = await request(app).get('/health').set('Origin', 'https://evil.example.com');
            assert.equal(bad.headers['access-control-allow-origin'], undefined);
            const pre = await request(app).options('/api/auth/sessions').set('Origin', 'https://savera.vivyaan.co.in')
                .set('Access-Control-Request-Method', 'GET').set('Access-Control-Request-Headers', 'authorization,x-tenant-slug,x-client-platform');
            assert.ok(pre.status === 204 || pre.status === 200);
            assert.match(String(pre.headers['access-control-allow-headers']).toLowerCase(), /x-client-platform/);
        });
    });
});
