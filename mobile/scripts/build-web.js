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
// The shop's own name, colour and icon for "Add to Home Screen" / "Install app" (the installed website takes them from the manifest, and iPhones from the
// apple-touch-icon). On Cloudflare the Worker answers /manifest.webmanifest per shop; on a host without it (Netlify: ONE site = ONE shop, APP_TENANT) the
// same answer is fetched from the API now, while building, and written into the site. If the API cannot be reached the generic one stays, with a warning.
async function shopIdentity() {
    const slug = String(process.env.APP_TENANT || ((envFile.match(/^APP_TENANT=(.+)$/m) || [])[1] || '')).trim().replace(/^["']|["']$/g, '').toLowerCase();
    if (!slug || slug === 'default') { console.warn('Warning: APP_TENANT is not set to a shop: the installed website keeps the generic name and icon.'); return; }
    try {
        const res = await fetch(`${api}/tenants/manifest`, { headers: { 'x-tenant-slug': slug } });
        if (!res.ok) throw new Error(`the API answered ${res.status}`);
        const manifest = await res.json();
        if (!manifest || !manifest.name || !Array.isArray(manifest.icons) || !manifest.icons.length) throw new Error('the answer has no name or icon');
        fs.writeFileSync(path.join(out, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));
        const icon = manifest.icons[0].src;
        const file = path.join(out, 'index.html');
        let html = fs.readFileSync(file, 'utf8');
        const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
        html = html
            .replace(/(<link rel="icon" href=")[^"]*(")/, (m, a, b) => a + esc(icon) + b)
            .replace(/(<link rel="apple-touch-icon" href=")[^"]*(")/, (m, a, b) => a + esc(icon) + b)
            .replace(/(<meta name="theme-color" content=")[^"]*(")/, (m, a, b) => a + esc(manifest.theme_color || '#111111') + b);
        if (!/apple-mobile-web-app-title/.test(html)) html = html.replace('</head>', () => '<meta name="apple-mobile-web-app-title" content="' + esc(manifest.short_name || manifest.name) + '" /></head>');
        fs.writeFileSync(file, html);
        console.log(`Installed-website identity for "${slug}": ${manifest.name}, icon ${icon}`);
    } catch (e) {
        console.warn(`Warning: could not get the shop's name and icon for "${slug}" (${e.message}): the installed website keeps the generic ones.`);
    }
}

shopIdentity().then(() => {
    console.log(`\nDone: ${out}\nNext: cd ../deploy/cloudflare && npx wrangler deploy   (docs/web-hosting.md), or push to Netlify (netlify.toml)`);
});
