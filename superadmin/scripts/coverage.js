#!/usr/bin/env node
/*
 * COVERAGE CHECK: does every superadmin route of the backend have a place in the app?
 *
 *   npm run coverage            (from superadmin/)
 *
 * 1. It loads the backend app (fake test settings, no database, nothing is started) and records every route
 *    that is reachable under /api/admin, including the shop routes mounted at /tenants/:tid/shop.
 * 2. It reads every request the app can make from src/api/*.js.
 * 3. It prints three lists:
 *      COVERED   a route the app calls
 *      ALLOWED   a route that is deliberately not in the app (see coverage.allow.js, each with a reason)
 *      MISSING   a route nothing in the app calls and nobody allowed  -> exit code 1
 *    and a fourth, UNKNOWN CALLS: the app calls something the backend does not have (a typo or a removed route).
 *
 * Params are compared by shape only (/tenants/:p/orders/:p/assign), so names do not matter.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const backend = path.resolve(root, '..', 'backend');

/* ------------------------------ 1. backend routes ------------------------------ */
process.chdir(backend);
require(path.join(backend, 'tests', 'helpers', 'env.js'));   // fake settings, the real .env is never read

const Router = require(require.resolve('router', { paths: [path.join(backend, 'node_modules', 'express')] }));
const mounts = new Map();   // router -> [{ prefix, child }]
const routes = new Map();   // router -> [{ path, route }]
const add = (map, key, v) => { if (!map.has(key)) map.set(key, []); map.get(key).push(v); };

const proto = Router.prototype;
const origUse = proto.use;
proto.use = function use(...args) {
    let prefixes = [''];
    if (typeof args[0] === 'string') prefixes = [args[0]];
    else if (Array.isArray(args[0]) && args[0].every((x) => typeof x === 'string')) prefixes = args[0];
    for (const fn of args.flat(Infinity)) {
        if (typeof fn === 'function' && Array.isArray(fn.stack)) for (const p of prefixes) add(mounts, this, { prefix: p, child: fn });
    }
    return origUse.apply(this, args);
};
const origRoute = proto.route;
proto.route = function route(p) {
    const r = origRoute.call(this, p);
    if (typeof p === 'string') add(routes, this, { path: p, route: r });
    return r;
};

const appModule = require(path.join(backend, 'src', 'server', 'app.js'));
const app = appModule.app || appModule;
const appRouter = app.router;

const norm = (p) => ('/' + String(p).split('/').filter(Boolean).map((s) => (s.startsWith(':') ? ':p' : s)).join('/')).replace(/\/$/, '') || '/';
const found = new Map();   // "GET /api/admin/..." -> true
function walk(router, prefix, depth = 0) {
    if (depth > 12) return;   // a router mounted inside itself would never end
    for (const { path: p, route } of routes.get(router) || []) {
        for (const m of Object.keys(route.methods || {})) {
            if (m === '_all') continue;
            found.set(`${m.toUpperCase()} ${norm(prefix + p)}`, true);
        }
        if (route.methods?._all) found.set(`ALL ${norm(prefix + p)}`, true);
    }
    for (const { prefix: mp, child } of mounts.get(router) || []) walk(child, prefix + mp, depth + 1);
}
walk(appRouter, '');
const backendRoutes = [...found.keys()].filter((k) => / \/api\/admin(\/|$)/.test(k)).sort();

/* ------------------------------ 2. what the app can call ------------------------------ */
const RESOURCES = ['categories', 'products', 'collections', 'banners', 'coupons'];
const apiDir = path.join(root, 'src', 'api');
const calls = new Set();
const resolve = (tpl) => {
    let s = tpl
        .replace(/\$\{T\([^)]*\)\}/g, '/admin/tenants/:p')
        .replace(/\$\{S\([^)]*\)\}/g, '/admin/tenants/:p/shop')
        .replace(/\$\{base\([^)]*\)\}/g, '/admin/tenants/:p/shop/@RES@')
        .replace(/\$\{[^}]*\}/g, ':p');
    s = s.split('?')[0];
    if (!s.includes('@RES@')) return [s];
    return (/\/stock$/.test(s) ? ['products'] : RESOURCES).map((r) => s.replace('@RES@', r));
};
for (const file of fs.readdirSync(apiDir).filter((f) => f.endsWith('.js') && f !== 'adminClient.js')) {
    const src = fs.readFileSync(path.join(apiDir, file), 'utf8');
    const re = /api\.(get|post|put|patch|delete)\(\s*([`'"])((?:\\.|(?!\2)[\s\S])*)\2/g;
    let m;
    while ((m = re.exec(src))) {
        for (const p of resolve(m[3])) calls.add(`${m[1].toUpperCase()} ${norm(`/api${p.startsWith('/') ? '' : '/'}${p}`)}`);
    }
    // calls that pass a helper directly: api.get(T(id)), api.put(T(id), body), api.post(base(shopId, resource), body)
    for (const h of src.matchAll(/api\.(get|post|put|patch|delete)\(\s*(T|S|base)\(/g)) {
        const tpl = { T: '${T(x)}', S: '${S(x)}', base: '${base(x)}' }[h[2]];
        for (const p of resolve(tpl)) calls.add(`${h[1].toUpperCase()} ${norm(`/api${p}`)}`);
    }
    // a url kept in a variable and passed as api.get(url, ...)
    const vre = /const url = [^;]*;/g;
    while ((m = vre.exec(src))) {
        for (const lit of m[0].matchAll(/([`'])((?:\\.|(?!\1)[\s\S])*)\1/g)) {
            if (!lit[2].includes('/')) continue;
            for (const p of resolve(lit[2])) calls.add(`GET ${norm(`/api${p}`)}`);
        }
    }
    // a fetch() made with the token (raw uploads)
    for (const lit of src.matchAll(/fetch\(\s*`\$\{baseURL\}([^`?]*)/g)) {
        for (const p of resolve(lit[1].replace(/\$\{apply[\s\S]*$/, ''))) calls.add(`POST ${norm(`/api${p}`)}`);
    }
}

/* ------------------------------ 3. compare ------------------------------ */
const allow = require('./coverage.allow.js');
const allowed = (route) => allow.find((a) => a.match.test(route));
const covered = [];
const allowedList = [];
const missing = [];
for (const r of backendRoutes) {
    if (calls.has(r)) covered.push(r);
    else if (allowed(r)) allowedList.push([r, allowed(r).why]);
    else missing.push(r);
}
const known = new Set(backendRoutes);
const unknownCalls = [...calls].filter((c) => !known.has(c)).sort();

// API functions that exist but no screen, store, hook or util ever calls: dead code, or a feature that is half-wired
const walkSrc = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? walkSrc(p) : [p];
});
const users = [...walkSrc(path.join(root, 'src')), path.join(root, 'App.js')].filter((f) => /\.jsx?$/.test(f));
const userText = users.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const unusedFns = [];
for (const file of fs.readdirSync(apiDir).filter((f) => f.endsWith('.js') && f !== 'adminClient.js')) {
    const src = fs.readFileSync(path.join(apiDir, file), 'utf8');
    for (const m of src.matchAll(/export (?:const|async function|function) (\w+)/g)) {
        const name = m[1];
        const uses = (userText.match(new RegExp(`\\b${name}\\b`, 'g')) || []).length;
        const inOwnFile = (src.match(new RegExp(`\\b${name}\\b`, 'g')) || []).length;
        // once for its own definition; any other mention in another file (screen, store, hook, util) counts as a use
        const otherUses = users.filter((f) => !f.startsWith(apiDir) && new RegExp(`\\b${name}\\b`).test(fs.readFileSync(f, 'utf8'))).length;
        if (!otherUses) unusedFns.push(`${file}: ${name}`);
    }
}

const line = (s) => console.log(s);
line(`\nBackend routes under /api/admin: ${backendRoutes.length}`);
line(`App calls found:                 ${calls.size}\n`);
line(`COVERED  ${covered.length}`);
line(`ALLOWED  ${allowedList.length}  (on purpose, with a reason)`);
line(`MISSING  ${missing.length}`);
line(`UNKNOWN CALLS  ${unknownCalls.length}`);
line(`UNUSED API FUNCTIONS  ${unusedFns.length}\n`);

if (process.argv.includes('--verbose')) {
    line('--- covered');
    covered.forEach((r) => line(`  ok       ${r}`));
}
if (allowedList.length) {
    line('--- allowed');
    allowedList.forEach(([r, why]) => line(`  allowed  ${r}\n           ${why}`));
}
if (missing.length) {
    line('\n--- MISSING: no screen calls these and nobody allowed them');
    missing.forEach((r) => line(`  MISSING  ${r}`));
}
if (unknownCalls.length) {
    line('\n--- UNKNOWN CALLS: the app calls a route the backend does not have');
    unknownCalls.forEach((r) => line(`  UNKNOWN  ${r}`));
}
if (unusedFns.length) {
    line('\n--- UNUSED API FUNCTIONS (a function exists but no screen calls it)');
    unusedFns.forEach((x) => line(`  unused   ${x}`));
}
line(missing.length || unknownCalls.length ? '\nRESULT: needs attention' : '\nRESULT: every superadmin route is covered or deliberately allowed');
process.exit(missing.length || unknownCalls.length ? 1 : 0);
