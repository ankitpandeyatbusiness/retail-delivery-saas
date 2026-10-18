// Wraps the on-screen texts of the app screens in tr('...') so they can be translated (see src/i18n/index.js).
//
//   node scripts/i18nWrap.js            dry run: says what it would change, writes nothing
//   node scripts/i18nWrap.js --write    changes the files
//   node scripts/i18nWrap.js --dirs screens/riders,components/riders   only these folders (under src/)
//
// It changes only texts INSIDE functions (what a screen draws): JSX text, the usual text props (title, label, placeholder, hint...),
// the texts of showToast / themedAlert / ask / Alert.alert, option lists like options={[['a', 'Label']]}, and template texts with
// ${...} (turned into {name} placeholders). A line of text with values in the middle ("Paid {n} orders") is joined into ONE sentence,
// so it can be translated as a whole. Texts in module-level lists are left for the hand pass (tl('...')).
// The edits are made on the original text, so the files keep their formatting and comments.
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const SRC = path.resolve(__dirname, '../src');
const DIRS = process.argv.includes('--dirs')
    ? process.argv[process.argv.indexOf('--dirs') + 1].split(',')
    : ['screens/customers', 'screens/owners', 'screens/common', 'components/customers', 'components/owners', 'components/common'];
const WRITE = process.argv.includes('--write');

const ATTRS = new Set(['title', 'label', 'placeholder', 'subtitle', 'hint', 'message', 'description', 'caption', 'header', 'heading',
    'confirmLabel', 'cancelLabel', 'emptyText', 'emptyTitle', 'text', 'suffix', 'accessibilityLabel', 'alt', 'tagline',
    'sub', 'note', 'action', 'intro', 'submitLabel', 'k', 'sameText', 'textLabel']);
const LIST_ATTRS = new Set(['options', 'choices']);
const TOAST_FUNCS = new Set(['showToast', 'setErr', 'setError']);
const SKIP_FILES = new Set(['kit.jsx', 'typography.js', 'motion.jsx', 'SheetPortal.jsx', 'LanguageSheet.jsx']);

const hasLetters = (s) => /[A-Za-z]/.test(s);
const identifierLike = (s) => /^[a-z][a-z0-9_.-]*$/.test(s);
const quote = (s) => `'${s.split('\\').join('\\\\').split("'").join("\\'").split('\n').join('\\n')}'`;

// the way JSX itself cleans text: every line is trimmed, empty lines are dropped, the rest is joined with one space
const cleanJsxText = (value) => {
    const lines = value.split('\n');
    const kept = [];
    lines.forEach((line, i) => {
        let l = line.split('\t').join(' ');
        if (i !== 0) l = l.replace(/^ +/, '');
        if (i !== lines.length - 1) l = l.replace(/ +$/, '');
        if (l) kept.push(l);
    });
    return kept.join(' ');
};

const files = [];
const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(jsx|js)$/.test(e.name) && !SKIP_FILES.has(e.name)) files.push(p);
    }
};
for (const d of DIRS) if (fs.existsSync(path.join(SRC, d))) walk(path.join(SRC, d));

let totalEdits = 0;
const allKeys = new Set();
const report = [];

for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    const src = raw.split('\r\n').join('\n');
    let ast;
    try { ast = parser.parse(src, { sourceType: 'module', plugins: ['jsx'] }); } catch (e) { report.push(`SKIP (parse) ${path.relative(SRC, file)}: ${e.message.slice(0, 60)}`); continue; }

    const edits = [];
    const inFn = (p) => !!p.findParent((x) => x.isFunction());
    const add = (node, replacement, key) => { edits.push({ start: node.start, end: node.end, replacement }); if (key) allKeys.add(key); };

    // names for the {placeholders} of a text with values in it
    const makeNamer = () => {
        const used = new Set();
        return (e, i) => {
            let n = e.type === 'Identifier' ? e.name
                : e.type === 'MemberExpression' && !e.computed && e.property.type === 'Identifier' ? e.property.name
                    : e.type === 'CallExpression' && e.callee.type === 'Identifier' ? e.callee.name
                        : `v${i + 1}`;
            while (used.has(n)) n = `${n}${i + 1}`;
            used.add(n);
            return n;
        };
    };

    // a string / template / conditional / logical expression -> its wrapped form. Returns true when something was wrapped.
    const wrapExpr = (node) => {
        if (!node) return false;
        if (node.type === 'StringLiteral') {
            const v = node.value;
            if (!hasLetters(v) || v.trim().length < 2 || /^https?:\/\//.test(v) || /^#[0-9a-f]{3,8}$/i.test(v)) return false;
            add(node, `tr(${quote(v)})`, v);
            return true;
        }
        if (node.type === 'TemplateLiteral') {
            const plain = node.quasis.map((q) => q.value.cooked).join('');
            if (!hasLetters(plain)) return false;
            if (!node.expressions.length) { add(node, `tr(${quote(plain)})`, plain); return true; }
            const nameOf = makeNamer();
            let key = '';
            const vars = [];
            node.quasis.forEach((q, i) => {
                key += q.value.cooked;
                if (i < node.expressions.length) {
                    const e = node.expressions[i];
                    const n = nameOf(e, i);
                    key += `{${n}}`;
                    vars.push(`${n}: ${src.slice(e.start, e.end)}`);
                }
            });
            add(node, `tr(${quote(key)}, { ${vars.join(', ')} })`, key);
            return true;
        }
        if (node.type === 'ConditionalExpression') { const a = wrapExpr(node.consequent); const b = wrapExpr(node.alternate); return a || b; }
        if (node.type === 'LogicalExpression') return wrapExpr(node.right);
        return false;
    };

    const handled = new Set();
    traverse(ast, {
        JSXElement: {
            enter(p) {
                // text with values in the middle, and nothing else inside: ONE sentence ("Paid {n} orders")
                if (!inFn(p)) return;
                const kids = p.node.children;
                if (kids.length < 2) return;
                if (kids.some((k) => k.type !== 'JSXText' && k.type !== 'JSXExpressionContainer')) return;   // nested elements: left alone
                const exprs = kids.filter((k) => k.type === 'JSXExpressionContainer');
                if (!exprs.length || !kids.some((k) => k.type === 'JSXText' && hasLetters(k.value))) return;
                if (exprs.some((e) => ['JSXEmptyExpression', 'JSXElement', 'JSXFragment'].includes(e.expression.type))) return;
                const nameOf = makeNamer();
                let key = '';
                const vars = [];
                kids.forEach((k, i) => {
                    if (k.type === 'JSXText') {
                        let piece = cleanJsxText(k.value);
                        if (i > 0 && k.value.startsWith(' ')) piece = ` ${piece.replace(/^ +/, '')}`;           // a space next to a value stays
                        if (i < kids.length - 1 && k.value.endsWith(' ')) piece = `${piece.replace(/ +$/, '')} `;
                        key += piece;
                    } else {
                        const e = k.expression;
                        if (e.type === 'StringLiteral') { key += e.value; return; }
                        const n = nameOf(e, vars.length);
                        key += `{${n}}`;
                        vars.push(`${n}: ${src.slice(e.start, e.end)}`);
                    }
                });
                key = key.replace(/ {2,}/g, ' ').trim();
                if (!hasLetters(key.replace(/\{\w+\}/g, ''))) return;
                kids.forEach((k) => handled.add(k));
                edits.push({ start: kids[0].start, end: kids[kids.length - 1].end, replacement: `{tr(${quote(key)}${vars.length ? `, { ${vars.join(', ')} }` : ''})}` });
                allKeys.add(key);
            },
        },
        JSXText(p) {
            if (!inFn(p) || handled.has(p.node)) return;
            const norm = cleanJsxText(p.node.value).trim();
            if (norm.length < 2 || !hasLetters(norm)) return;
            const lead = /^\s*/.exec(p.node.value)[0];
            const trail = /\s*$/.exec(p.node.value)[0];
            edits.push({ start: p.node.start, end: p.node.end, replacement: `${lead}{tr(${quote(norm)})}${trail}` });
            allKeys.add(norm);
        },
        JSXAttribute(p) {
            if (!inFn(p)) return;
            const name = p.node.name.name;
            const v = p.node.value;
            if (!v || typeof name !== 'string') return;
            if (ATTRS.has(name)) {
                if (v.type === 'StringLiteral') {
                    if (!hasLetters(v.value) || v.value.trim().length < 2 || identifierLike(v.value)) return;
                    add(v, `{tr(${quote(v.value)})}`, v.value);
                } else if (v.type === 'JSXExpressionContainer') wrapExpr(v.expression);
            } else if (LIST_ATTRS.has(name) && v.type === 'JSXExpressionContainer' && v.expression.type === 'ArrayExpression') {
                for (const row of v.expression.elements) {
                    if (row && row.type === 'ArrayExpression' && row.elements.length >= 2) wrapExpr(row.elements[1]);
                }
            }
        },
        JSXExpressionContainer(p) {
            // {cond ? 'A' : 'B'}, {ok && 'Text'}, {`${n} items`} as a CHILD of an element
            if (!inFn(p) || handled.has(p.node)) return;
            if (p.parent.type !== 'JSXElement' && p.parent.type !== 'JSXFragment') return;
            wrapExpr(p.node.expression);
        },
        CallExpression(p) {
            if (!inFn(p)) return;
            const c = p.node.callee;
            const args = p.node.arguments;
            if (c.type === 'Identifier' && TOAST_FUNCS.has(c.name)) wrapExpr(args[0]);
            else if ((c.type === 'Identifier' && c.name === 'themedAlert') || (c.type === 'MemberExpression' && c.object.name === 'Alert' && c.property.name === 'alert')) {
                wrapExpr(args[0]); wrapExpr(args[1]);
                if (args[2] && args[2].type === 'ArrayExpression') {
                    for (const b of args[2].elements) {
                        if (b && b.type === 'ObjectExpression') for (const pr of b.properties) if (pr.key && pr.key.name === 'text' && pr.value) wrapExpr(pr.value);
                    }
                }
            } else if (c.type === 'Identifier' && c.name === 'ask' && args[0] && args[0].type === 'ObjectExpression') {
                for (const pr of args[0].properties) if (pr.key && ['title', 'message', 'confirmText', 'cancelText'].includes(pr.key.name) && pr.value) wrapExpr(pr.value);
            }
        },
    });

    // drop an edit that sits inside a bigger one, then apply from the end
    edits.sort((a, b) => a.start - b.start || b.end - a.end);
    const clean = [];
    for (const e of edits) {
        const last = clean[clean.length - 1];
        if (last && e.start >= last.start && e.end <= last.end) continue;
        clean.push(e);
    }
    if (!clean.length) continue;

    let out = src;
    for (const e of [...clean].reverse()) out = out.slice(0, e.start) + e.replacement + out.slice(e.end);

    // the import (once), after the last import line
    if (!/import\s*\{[^}]*\btr\b[^}]*\}\s*from\s*'[^']*i18n'/.test(out)) {
        let rel = path.relative(path.dirname(file), path.join(SRC, 'i18n')).split(path.sep).join('/');
        if (!rel.startsWith('.')) rel = `./${rel}`;
        const imports = [...out.matchAll(/^import[\s\S]*?;[ \t]*$/gm)];
        const at = imports.length ? imports[imports.length - 1].index + imports[imports.length - 1][0].length : 0;
        out = `${out.slice(0, at)}\nimport { tr } from '${rel}';${out.slice(at)}`;
    }
    totalEdits += clean.length;
    report.push(`${String(clean.length).padStart(4)}  ${path.relative(SRC, file).split(path.sep).join('/')}`);
    if (WRITE) fs.writeFileSync(file, raw.includes('\r\n') ? out.split('\n').join('\r\n') : out);
}

console.log(report.join('\n'));
console.log(`\n${WRITE ? 'CHANGED' : 'WOULD CHANGE'}: ${totalEdits} texts in ${report.filter((l) => /^\s*\d/.test(l)).length} files, ${allKeys.size} different texts`);
fs.writeFileSync(path.join(__dirname, '.i18n-keys.json'), JSON.stringify([...allKeys].sort(), null, 1));
