// Builds the website for hosting:  cd mobile && WEB_API_URL=https://<your-render-app>.onrender.com/api npm run build:web
// Output: mobile/dist-web (deploy/cloudflare/wrangler.toml serves it). It refuses to build for the wrong API, so a website that talks to localhost is never shipped.
//   WEB_API_URL      required: the API on Render, https, WITH /api at the end
//   MEDIA_CDN_URL    required: the public address of the media storage (the shop pictures); the same value as in eas.json
//   EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY   the browser map key (mobile/.env is read when it is not in the environment)
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const fail = (m) => { console.error(`\nBuild stopped: ${m}\n`); process.exit(1); };

const api = String(process.env.WEB_API_URL || '').replace(/\/+$/, '');
if (!/^https:\/\/[^/]+\/api$/i.test(api)) fail('set WEB_API_URL to the API address with https and /api at the end, for example https://my-app.onrender.com/api');
const cdn = String(process.env.MEDIA_CDN_URL || '').replace(/\/+$/, '');
if (!/^https:\/\//i.test(cdn)) fail('set MEDIA_CDN_URL to the public https address of the media storage (see eas.json)');

const envFile = fs.existsSync(path.join(root, '.env')) ? fs.readFileSync(path.join(root, '.env'), 'utf8') : '';
if (!process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY && !/^EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY=.+/m.test(envFile)) {
    console.warn('Warning: EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY is not set: maps on the website will show "Map is not available".');
}

const out = path.join(root, 'dist-web');
fs.rmSync(out, { recursive: true, force: true });
console.log(`Building the website for API ${api} ...`);
const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['expo', 'export', '--platform', 'web', '--output-dir', 'dist-web', '--clear'], {
    cwd: root, stdio: 'inherit', shell: process.platform === 'win32',
    env: { ...process.env, EXPO_PUBLIC_BASE_URL: api, MEDIA_CDN_URL: cdn },   // a value in the environment wins over mobile/.env
});
if (r.status !== 0) fail('the Expo web export failed (see above)');

const need = ['index.html', 'sw.js', 'manifest.webmanifest', path.join('icons', 'icon-1024.png')];
const missing = need.filter((f) => !fs.existsSync(path.join(out, f)));
if (missing.length) fail(`the build is missing ${missing.join(', ')}`);
const js = fs.readdirSync(path.join(out, '_expo', 'static', 'js', 'web')).filter((f) => f.endsWith('.js'));
const bundle = fs.readFileSync(path.join(out, '_expo', 'static', 'js', 'web', js.sort((a, b) => fs.statSync(path.join(out, '_expo', 'static', 'js', 'web', b)).size - fs.statSync(path.join(out, '_expo', 'static', 'js', 'web', a)).size)[0]), 'utf8');
if (/localhost:5000/.test(bundle) && !api.includes('localhost')) fail('the build still points at localhost:5000');
if (!bundle.includes(api)) fail('the built website does not contain the API address you gave (check WEB_API_URL)');
console.log(`\nDone: ${out}\nNext: cd ../deploy/cloudflare && npx wrangler deploy   (docs/web-hosting.md)`);
