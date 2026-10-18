// The list of every text that has to be translated, and a check of the translations.
//
//   node scripts/i18nKeys.js            writes scripts/i18n-keys.json and prints how many texts each language still lacks
//   node scripts/i18nKeys.js --check    fails (exit 1) when a translation lost a {placeholder} or a language has a key that is not used
//
// Sources: tr('...') in the app, the rider's text table, the texts of module-level lists (found by scanning), and the short
// messages the server sends (scripts/i18n-server.json, made by backend/scripts/i18nServerMessages.js).
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const SRC = path.resolve(__dirname, '../src');
const CHECK = process.argv.includes('--check');
const LANG_CODES = ['hi', 'bho', 'mr', 'gu', 'bn'];
const SKIP_LISTS = /(kit\.jsx|typography|motion|SheetPortal|LanguageSheet|[\\/]i18n[\\/]|socket|client\.js|cache\.js|greetings\.js|soundbox\.js|upiApps\.js|LiveOrderHost|riderText)/;

const keys = new Set();
const addKey = (s) => { if (typeof s === 'string' && s.trim()) keys.add(s); };
const files = [];
const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(jsx|js)$/.test(e.name)) files.push(p);
    }
};
walk(SRC);

const hasLetters = (s) => /[A-Za-z]/.test(s);
for (const f of files) {
    const rel = f.split(path.sep).join('/');
    if (/\/i18n\/locales\//.test(rel)) continue;
    let ast;
    try { ast = parser.parse(fs.readFileSync(f, 'utf8'), { sourceType: 'module', plugins: ['jsx'] }); } catch (e) { continue; }
    const isRiderText = /riderText\.js$/.test(rel);
    const lists = !SKIP_LISTS.test(rel) || isRiderText;
    traverse(ast, {
        CallExpression(p) {
            const c = p.node.callee;
            if (c.type !== 'Identifier' || (c.name !== 'tr' && c.name !== 'tl')) return;
            const a = p.node.arguments[0];
            if (a && a.type === 'StringLiteral') addKey(a.value);
            else if (a && a.type === 'TemplateLiteral' && !a.expressions.length) addKey(a.quasis[0].value.cooked);
        },
        StringLiteral(p) {
            // texts in module-level lists (outside functions), which the net in textPatch.js translates when drawn
            if (!lists) return;
            const v = p.node.value;
            if (p.findParent((x) => x.isFunction() && !isRiderText) || p.findParent((x) => x.isImportDeclaration() || x.isJSXAttribute() || (x.isCallExpression() && x.node.callee.name === 'tr'))) return;
            if (isRiderText && p.findParent((x) => x.isArrowFunctionExpression())) return;
            if (!hasLetters(v) || v.length < 3 || /^https?:|^#[0-9a-f]{3,8}$|^\//.test(v) || /^[a-z][a-zA-Z0-9_.:-]*$/.test(v) || /^[A-Z0-9_]+$/.test(v) || /^[A-Z][a-z]+[A-Z]/.test(v)) return;
            if (!/^[A-Z]/.test(v) && !/ /.test(v)) return;
            const par = p.parent;
            if (par.type === 'ObjectProperty' && par.key === p.node) return;
            if (par.type === 'ObjectProperty' && par.key && /^(color|bg|font|style|icon|name|type|key|id|route|screen|path|url|kind|mode|look|uri|src|testID|source|sound|channel)/i.test(par.key.name || par.key.value || '')) return;
            addKey(v);
        },
    });
}

// short messages from the server (screens show them as they come; the net translates the ones that match exactly)
const serverFile = path.join(__dirname, 'i18n-server.json');
let serverCount = 0;
if (fs.existsSync(serverFile)) for (const m of JSON.parse(fs.readFileSync(serverFile, 'utf8'))) { addKey(m); serverCount += 1; }

const sorted = [...keys].sort();
fs.writeFileSync(path.join(__dirname, 'i18n-keys.json'), JSON.stringify(sorted, null, 1));

// the translations
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
let problems = 0;
console.log(`${sorted.length} texts to translate (${serverCount} from the server)`);
for (const code of LANG_CODES) {
    const file = path.join(SRC, 'i18n/locales', `${code}.js`);
    const text = fs.readFileSync(file, 'utf8').replace(/^export default /m, 'module.exports = ');
    const m = { exports: {} };
    new Function('module', 'exports', text)(m, m.exports);   // eslint-disable-line no-new-func
    const book = m.exports;
    const missing = sorted.filter((k) => typeof book[k] !== 'string' || !book[k].trim());
    const extra = Object.keys(book).filter((k) => !keys.has(k));
    const broken = sorted.filter((k) => typeof book[k] === 'string' && placeholders(book[k]) !== placeholders(k));
    console.log(`${code}: ${sorted.length - missing.length}/${sorted.length} translated, ${missing.length} missing, ${broken.length} with changed {placeholders}, ${extra.length} not used`);
    for (const k of broken.slice(0, 5)) console.log(`   PLACEHOLDERS  ${JSON.stringify(k)} -> ${JSON.stringify(book[k])}`);
    if (CHECK) { problems += broken.length; }
}
if (CHECK && problems) process.exit(1);
