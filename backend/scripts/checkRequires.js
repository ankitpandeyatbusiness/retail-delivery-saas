// Finds every relative require() in src and checks the file name case EXACTLY.
// Windows ignores case, Linux (your Render server) does not. Run before every deploy:
//   npm run check:requires
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const RE = /require\(\s*['"](\.{1,2}\/[^'"]*)['"]\s*\)/g;

function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (e.name.endsWith('.js')) out.push(p);
    }
    return out;
}

// true only if every part of the path matches the name on disk, letter by letter
function existsExact(full) {
    const rel = path.relative(SRC, full);
    if (rel.startsWith('..')) return fs.existsSync(full);   // outside src: plain check
    let dir = SRC;
    for (const seg of rel.split(path.sep)) {
        if (!fs.existsSync(dir) || !fs.readdirSync(dir).includes(seg)) return false;
        dir = path.join(dir, seg);
    }
    return true;
}

function check() {
    const problems = [];
    for (const file of walk(SRC)) {
        const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
        lines.forEach((line, i) => {
            const t = line.trim();
            if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;   // comments
            for (const m of line.matchAll(RE)) {
                const full = path.resolve(path.dirname(file), m[1]);
                const options = [full, `${full}.js`, `${full}.json`, path.join(full, 'index.js')];
                if (options.some(existsExact)) continue;
                const label = options.some((o) => fs.existsSync(o)) ? 'CASE MISMATCH' : 'MISSING FILE';
                problems.push(`${path.relative(SRC, file)}:${i + 1}  require('${m[1]}')  ${label}`);
            }
        });
    }
    return problems;
}

module.exports = { check };

if (require.main === module) {
    const problems = check();
    if (problems.length) {
        console.error(`${problems.length} problem(s):\n${problems.join('\n')}`);
        process.exit(1);
    }
    console.log('All require() paths are correct (case checked).');
}