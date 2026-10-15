#!/usr/bin/env node
// The only safe way to build or publish a shop's app. It sets the shop and the channel TOGETHER, so one cannot
// be right while the other is wrong, and it stops before anything is sent if something does not match.
//
//   npm run release:build  -- <slug>
//   npm run release:update -- <slug> "what changed"
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const tenants = require(path.join(root, 'tenants.js'));
const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));

const [mode, slug, ...rest] = process.argv.slice(2);
const message = rest.filter((a) => a !== '--yes').join(' ').trim();
const yes = process.argv.includes('--yes');
const stop = (m) => { console.error(`\nSTOPPED: ${m}\n`); process.exit(1); };

if (!['build', 'update'].includes(mode) || !slug) stop('use: npm run release:build -- <slug>   or   npm run release:update -- <slug> "message"');
if (slug === 'default') stop('"default" is the platform app, not a shop. Release it by hand.');
if (!tenants[slug]) stop(`"${slug}" is not in mobile/tenants.js. Known shops: ${Object.keys(tenants).filter((k) => k !== 'default').join(', ')}`);

const profileName = `${slug}-preview`;
const profile = eas.build?.[profileName];
if (!profile) stop(`eas.json has no "${profileName}" profile. Add one for this shop (copy savera-preview).`);
if (profile.env?.APP_TENANT !== slug) stop(`eas.json "${profileName}" builds APP_TENANT="${profile.env?.APP_TENANT}", not "${slug}".`);
if (profile.channel !== slug) stop(`eas.json "${profileName}" uses channel "${profile.channel}", it must be "${slug}", or its updates reach another shop.`);
if (mode === 'update' && !message) stop('give a message: npm run release:update -- savera "what changed"');

// a profile of this shop must not carry another shop's package name by mistake
const t = tenants[slug];
if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(t.bundleId)) stop(`the package name "${t.bundleId}" in tenants.js is not valid.`);
const clash = Object.entries(tenants).find(([k, v]) => k !== slug && v.bundleId === t.bundleId);
if (clash) stop(`"${slug}" and "${clash[0]}" have the same package name ${t.bundleId}.`);

const args = mode === 'build'
  ? ['build', '--platform', 'android', '--profile', profileName]
  : ['update', '--channel', slug, '--environment', profile.environment || 'preview', '--message', message];

console.log('\n  Shop        :', `${t.name} (${slug})`);
console.log('  Package     :', t.bundleId);
console.log('  Action      :', mode === 'build' ? `new build, profile ${profileName}` : `OTA update to channel "${slug}"`);
if (mode === 'update') console.log('  Message     :', message);
console.log('  Command     : eas', args.join(' '), '\n');

const run = () => {
  const r = spawnSync('npx', ['eas-cli', ...args], {
    cwd: root, stdio: 'inherit', shell: true,
    // the profile's own env too (MEDIA_CDN_URL): eas-cli does not read .env when it loads an EAS environment
    env: { ...process.env, ...(profile.env || {}), APP_TENANT: slug, RELEASE_GUARD: '1', RELEASE_SLUG: slug },
  });
  process.exit(r.status ?? 1);
};

if (yes) run();
else {
  if (!process.stdin.isTTY) stop('not an interactive terminal: add --yes to confirm.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(`Type the shop slug "${slug}" to confirm: `, (a) => {
    rl.close();
    if (a.trim() !== slug) stop('that did not match. Nothing was sent.');
    run();
  });
}
