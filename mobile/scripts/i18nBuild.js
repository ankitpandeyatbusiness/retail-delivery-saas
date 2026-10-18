// Builds the language files (src/i18n/locales/*.js) from the translation batches in scripts/i18n-chunks/*.js.
// A batch is a list of rows: [English, Hindi, Bhojpuri, Marathi, Gujarati, Bengali]. An empty or identical cell is left out
// (the app then shows English, or Hindi for Bhojpuri). Run: node scripts/i18nBuild.js
const fs = require('fs');
const path = require('path');

const CODES = ['hi', 'bho', 'mr', 'gu', 'bn'];
const NAMES = { hi: 'Hindi', bho: 'Bhojpuri (Beta)', mr: 'Marathi', gu: 'Gujarati', bn: 'Bengali' };
const dir = path.join(__dirname, 'i18n-chunks');
const keys = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n-keys.json'), 'utf8')));
const books = Object.fromEntries(CODES.map((c) => [c, {}]));
let rows = 0; let unknown = 0;

for (const f of fs.readdirSync(dir).filter((x) => /\.js$/.test(x)).sort()) {
    const list = require(path.join(dir, f));   // eslint-disable-line global-require, import/no-dynamic-require
    for (const row of list) {
        const en = row[0];
        if (!keys.has(en)) { unknown += 1; console.log(`  not a used text (${f}): ${JSON.stringify(en).slice(0, 80)}`); continue; }
        rows += 1;
        CODES.forEach((c, i) => {
            const v = row[i + 1];
            if (typeof v === 'string' && v.trim() && v !== en) books[c][en] = v;
        });
    }
}
for (const c of CODES) {
    const body = Object.keys(books[c]).sort().map((k) => `    ${JSON.stringify(k)}: ${JSON.stringify(books[c][k])},`).join('\n');
    fs.writeFileSync(path.join(__dirname, '../src/i18n/locales', `${c}.js`),
        `// Translations into ${NAMES[c]}. The key is the English text exactly as written in the code; the value is the translation.\n`
        + `// {name} placeholders stay as they are. A missing key shows English${c === 'bho' ? ' (Bhojpuri: Hindi)' : ''}. Made by scripts/i18nBuild.js from scripts/i18n-chunks/ (do not edit by hand).\n`
        + `export default {\n${body}\n};\n`);
    console.log(`${c}: ${Object.keys(books[c]).length} texts`);
}
console.log(`${rows} rows, ${unknown} not used`);
