// The demo tutorial's stories (mobile/src/tutorial/stories.js): shape, circled buttons that really exist, and a translation for every text.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MOBILE = path.join(__dirname, '..', '..', 'mobile');
const read = (p) => fs.readFileSync(path.join(MOBILE, p), 'utf8');

function loadStories() {
    const src = read('src/tutorial/stories.js').replace(/export const /g, 'const ') + '\nmodule.exports = { STORIES, FULL_TOUR_ID };';
    const m = { exports: {} };
    vm.runInNewContext(src, { module: m });
    return m.exports;
}
function loadLocale(code) {
    const src = read(`src/i18n/locales/${code}.js`).replace('export default', 'module.exports =');
    const m = { exports: {} };
    vm.runInNewContext(src, { module: m });
    return m.exports;
}

const { STORIES, FULL_TOUR_ID } = loadStories();
const PANELS = ['customer', 'owner', 'cook', 'waiter', 'rider'];

describe('demo tutorial stories', () => {
    test('there is a Full tour and several short stories, each with 4 to 8 short steps', () => {
        assert.ok(STORIES.length >= 10);
        assert.ok(STORIES.find((s) => s.id === FULL_TOUR_ID));
        assert.equal(new Set(STORIES.map((s) => s.id)).size, STORIES.length);
        for (const s of STORIES) {
            assert.ok(s.title && s.who && s.icon, s.id);
            assert.ok(PANELS.includes(s.panel), `${s.id} panel`);
            assert.ok(s.min >= 1 && s.min <= 3, `${s.id} minutes`);
            assert.ok(s.steps.length >= 4 && s.steps.length <= 8, `${s.id} has ${s.steps.length} steps`);
            for (const st of s.steps) assert.ok(st.text && st.text.length <= 200, `${s.id}: "${st.text}"`);
        }
    });

    test('every circled button exists in the app, and a story never uses a word the platform avoids', () => {
        const all = fs.readdirSync(path.join(MOBILE, 'src'), { recursive: true }).filter((f) => /\.jsx$/.test(f)).map((f) => read(path.join('src', f))).join('\n');
        for (const s of STORIES) {
            for (const st of s.steps) {
                if (st.target) assert.ok(all.includes(`<CoachTarget id="${st.target}"`), `${s.id}: no <CoachTarget id="${st.target}"> in the app`);
            }
        }
        const text = JSON.stringify(STORIES.map((s) => [s.title, s.who, s.steps.map((x) => x.text)]));   // (an icon may be called restaurant: that is not shown)
        assert.ok(!/restaurant/i.test(text), 'say "shop", not "restaurant"');
    });

    test('Hindi, Marathi, Gujarati and Bengali have every story text and every demo screen text', () => {
        const need = new Set(['Stories', 'Show me around', 'Start the demo', 'Reset the demo', 'Demo', 'Try a panel', 'Become the {panel}', 'Skip this step', 'Did you like the demo?', 'I liked it: talk to us', 'Call me', 'Thank you! We will call you soon.', 'Mobile number', 'Shop name']);
        for (const s of STORIES) { need.add(s.title); need.add(s.who); for (const st of s.steps) need.add(st.text); }
        for (const code of ['hi', 'mr', 'gu', 'bn']) {
            const book = loadLocale(code);
            const missing = [...need].filter((k) => !book[k]);
            assert.deepEqual(missing, [], `${code} lacks ${missing.length} texts, first: ${missing[0]}`);
        }
        // placeholders survive
        for (const code of ['hi', 'mr', 'gu', 'bn']) {
            const b = loadLocale(code);
            assert.ok(b['Become the {panel}'].includes('{panel}'));
            assert.ok(b['Try the {shop} app'].includes('{shop}'));
        }
    });
});
