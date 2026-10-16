require('./helpers/env');
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

// Push silently sent nothing for a long time because the Firebase library was upgraded and the old way of starting it
// (admin.apps, admin.credential) no longer exists. This test starts it the way the server does, with a made-up
// service account, so that kind of break shows up here and not as "no notification arrived".
describe('push setup', () => {
    test('the installed firebase-admin starts and gives a messaging client with the methods the server uses', () => {
        const { privateKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
            publicKeyEncoding: { type: 'spki', format: 'pem' },
        });
        const account = {
            type: 'service_account',
            project_id: 'test-project',
            private_key_id: 'abc123',
            private_key: privateKey,
            client_email: 'firebase-adminsdk@test-project.iam.gserviceaccount.com',
            client_id: '1',
        };
        const saved = process.env.FCM_SERVICE_ACCOUNT_B64;
        process.env.FCM_SERVICE_ACCOUNT_B64 = Buffer.from(JSON.stringify(account)).toString('base64');
        try {
            delete require.cache[require.resolve('../src/services/adapters/push')];
            const adapter = require('../src/services/adapters/push');
            const m = adapter._messaging();
            assert.ok(m, 'no messaging client');
            assert.equal(typeof m.sendEachForMulticast, 'function');
            assert.equal(typeof m.send, 'function');
        } finally {
            if (saved === undefined) delete process.env.FCM_SERVICE_ACCOUNT_B64; else process.env.FCM_SERVICE_ACCOUNT_B64 = saved;
        }
    });

    test('without a service account push is simply off, not an error', () => {
        const saved = process.env.FCM_SERVICE_ACCOUNT_B64;
        delete process.env.FCM_SERVICE_ACCOUNT_B64;
        try {
            delete require.cache[require.resolve('../src/services/adapters/push')];
            assert.equal(require('../src/services/adapters/push')._messaging(), null);
        } finally {
            if (saved !== undefined) process.env.FCM_SERVICE_ACCOUNT_B64 = saved;
        }
    });
});
