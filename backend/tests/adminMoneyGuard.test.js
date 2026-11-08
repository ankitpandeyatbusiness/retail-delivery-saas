// The supreme-only "money guard" is a block list (src/middlewares/supremeAdmin.js MONEY).
// A block list forgets new routes, so this test lists EVERY superadmin write route and fails when one is not decided on.
//   - a write route whose path sounds like money must be in MONEY, or be in REVIEWED below with a reason
//   - a write route this test has never seen fails until you add it to KNOWN (it makes you stop and think: does it touch money?)
require('./helpers/env');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// record which router is mounted where (Express does not keep the mount path)
let P = express.Router();
while (P && !Object.getOwnPropertyNames(P).includes('use')) P = Object.getPrototypeOf(P);
const mounts = new Map();
const origUse = P.use;
P.use = function patched(...args) {
    const fns = args.flat(Infinity);
    const prefix = typeof fns[0] === 'string' ? fns[0] : '';
    for (const f of fns) if (f && f.stack) mounts.set(f, { parent: this, prefix });
    return origUse.apply(this, args);
};
require('../src/server/app');
P.use = origUse;
const { MONEY } = require('../src/middlewares/supremeAdmin');

const adminRouter = [...mounts.entries()].find(([, m]) => m.prefix === '/api/admin')[0];
const found = new Set();
(function walk(router, prefix) {
    for (const l of router.stack) {
        if (!l.route) continue;
        const p = Array.isArray(l.route.path) ? l.route.path[0] : l.route.path;
        for (const m of Object.keys(l.route.methods)) if (m !== 'get' && m !== 'head') found.add(`${m.toUpperCase()} ${prefix}${p}`);
    }
    for (const [child, m] of mounts) if (m.parent === router) walk(child, prefix + (m.prefix || ''));
}(adminRouter, ''));

const SOUNDS_LIKE_MONEY = /bill|invoice|pay|refund|wallet|price|fee|rent|commission|settle|payout|subscri|tax|gst|ledger|expense|credit|cash|topup|sms|money|finance|plan|agreement|discount|waive|balance|charge/i;

// Money-sounding routes that are deliberately open to every superadmin (or guarded inside their own router). Say WHY.
const REVIEWED = {
    'POST /refunds/:id/retry': 'sends a failed refund again with the same key: the customer cannot be paid twice, a support task',
    'POST /brands/:id/bulk/waive-late-fees': 'the brands router blocks every non-GET except owners/move for non-supreme admins',
    'POST /maintenance/plans': 'the handler refuses scope "all" for non-supreme admins',
    'POST /maintenance/plans/:id/cancel': 'the handler refuses a scope "all" plan for non-supreme admins',
    'PUT /maintenance/plans/:id': 'the handler refuses a scope "all" plan for non-supreme admins',
    'POST /tenants/:tid/riders/:rid/orders/:id/door-pay': 'only starts a QR for the customer to pay; moves no money by itself',
};

// Every superadmin write route that exists today. A route not listed here makes the test fail: decide first, then add it.
const KNOWN = new Set(require('./fixtures/adminWriteRoutes.json'));

const guarded = (path) => MONEY.some((re) => re.test(path));

test('every superadmin write route that sounds like money is supreme-only or reviewed', () => {
    const bad = [...found].filter((r) => {
        const path = r.split(' ')[1];
        return SOUNDS_LIKE_MONEY.test(path) && !guarded(path) && !REVIEWED[r];
    });
    assert.deepEqual(bad, [], `These admin routes sound like money but any superadmin can call them. Add them to MONEY in src/middlewares/supremeAdmin.js, or to REVIEWED in this test with a reason:\n${bad.join('\n')}`);
});

test('no new superadmin write route without a decision', () => {
    const fresh = [...found].filter((r) => !KNOWN.has(r));
    assert.deepEqual(fresh, [], `New admin write routes. Does any of them touch money? If yes, add it to MONEY in src/middlewares/supremeAdmin.js. Then add it to tests/fixtures/adminWriteRoutes.json:\n${fresh.join('\n')}`);
});

test('REVIEWED entries still exist (no stale excuses)', () => {
    const stale = Object.keys(REVIEWED).filter((r) => !found.has(r));
    assert.deepEqual(stale, []);
});

if (process.env.WRITE_ADMIN_ROUTES) {
    require('node:fs').writeFileSync(require('node:path').join(__dirname, 'fixtures', 'adminWriteRoutes.json'), `${JSON.stringify([...found].sort(), null, 1)}\n`);
}
