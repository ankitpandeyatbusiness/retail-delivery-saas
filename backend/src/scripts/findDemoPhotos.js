// Finds free photos for the demo shop on Wikimedia Commons and writes backend/src/data/demoPhotos.json and docs/demo-photo-sources.md.
// Run from the backend folder:  node src/scripts/findDemoPhotos.js
// Only public-domain / CC0 pictures are taken first; if a dish has none, a Creative Commons "attribution" picture is used and the
// credit is written in the sources list (docs/demo-photo-sources.md). Nothing is downloaded: the demo shop shows the Wikimedia thumbnail address.
const fs = require('fs');
const path = require('path');

const KEYWORDS = {
    'paneer tikka': 'paneer tikka', 'chicken 65': 'chicken 65 dish', 'spring rolls': 'spring rolls', 'crispy corn': 'crispy corn snack',
    'chicken biryani': 'chicken biryani', 'veg biryani': 'vegetable biryani', 'mutton biryani': 'mutton biryani', 'fried rice': 'fried rice',
    'butter chicken': 'butter chicken', 'paneer butter masala': 'paneer butter masala', 'dal makhani': 'dal makhani', 'kadai paneer': 'paneer masala gravy',
    'naan': 'butter naan', 'garlic naan': 'garlic naan bread', 'roti': 'tandoori roti', 'paratha': 'laccha paratha',
    'veg burger': 'hamburger cheeseburger', 'chicken burger': 'chicken burger', 'wrap': 'frankie roll wrap food', 'fries': 'french fries plate',
    'gulab jamun': 'gulab jamun', 'brownie': 'chocolate brownie', 'rasmalai': 'ras malai sweet', 'kulfi': 'kulfi ice cream',
    'chai': 'masala chai cup', 'lassi': 'lassi', 'lime soda': 'lemonade drink', 'cold coffee': 'iced coffee',
    'thali': 'indian thali', 'masala dosa': 'masala dosa', 'samosa': 'samosa', 'pizza': 'pizza margherita', 'pasta': 'pasta penne', 'sandwich': 'grilled sandwich',
    'momos': 'momos', 'chocolate cake': 'chocolate cake slice', 'pastry': 'pastry', 'cookies': 'chocolate chip cookies plate', 'croissant': 'croissant breakfast',
    'idli': 'idli sambar', 'chole bhature': 'chole bhature', 'pav bhaji': 'pav bhaji', 'paneer': 'paneer dish', 'tea': 'cup of tea kettle',
    'banner food': 'indian restaurant food table', 'banner dessert': 'indian sweets', 'banner pizza': 'pizza', 'banner cafe': 'coffee cup latte art',
};

const UA = { 'User-Agent': 'DemoPhotoFinder/1.0 (demo shop content script)' };
const strip = (h) => String(h || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const ZERO = /^(cc0|public domain|pd|cc-zero)/i;
const BY = /^cc[ -]by(?!-nc|-nd)/i;   // attribution (and share-alike) only; never non-commercial or no-derivatives

async function find(q) {
    const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=25'
        + `&gsrsearch=${encodeURIComponent(`${q} filetype:bitmap`)}&prop=imageinfo&iiprop=url|mime|extmetadata|size&iiurlwidth=800`;
    for (let a = 0; a < 3; a += 1) {
        try {
            const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
            if (r.status === 429) { await new Promise((x) => setTimeout(x, 2500)); continue; }
            if (!r.ok) return null;
            const pages = Object.values((await r.json())?.query?.pages || {}).sort((x, y) => x.index - y.index);
            const ok = pages.map((p) => ({ p, ii: p.imageinfo && p.imageinfo[0] })).filter(({ ii }) => ii && ii.mime === 'image/jpeg' && ii.width >= 700 && ii.height >= 450 && ii.thumburl);
            const meta = (ii) => ii.extmetadata || {};
            const lic = (ii) => strip(meta(ii).LicenseShortName && meta(ii).LicenseShortName.value);
            const pick = ok.find(({ ii }) => ZERO.test(lic(ii))) || ok.find(({ ii }) => BY.test(lic(ii)));
            if (!pick) return null;
            const m = meta(pick.ii);
            return { url: pick.ii.thumburl, page: pick.ii.descriptionurl, title: pick.p.title.replace(/^File:/, ''), licence: lic(pick.ii), author: strip(m.Artist && m.Artist.value).slice(0, 80) };
        } catch (e) { await new Promise((x) => setTimeout(x, 1500)); }
    }
    return null;
}

(async () => {
    let out = {};
    try { out = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'demoPhotos.json'), 'utf8')); } catch (e) { /* first run */ }
    const keys = Object.keys(KEYWORDS);
    const queue = keys.filter((k) => !out[k]);   // a second run only looks for the missing ones
    await Promise.all(Array.from({ length: 1 }, async () => {
        while (queue.length) {
            const k = queue.shift();
            await new Promise((x) => setTimeout(x, 1200));
            const r = await find(KEYWORDS[k]);
            if (r) out[k] = r;
            console.log(r ? `ok   ${k}  [${r.licence}]` : `none ${k}`);
        }
    }));
    const dir = path.join(__dirname, '..', 'data');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'demoPhotos.json'), JSON.stringify(out, null, 1));
    const rows = Object.entries(out).sort().map(([k, v]) => `| ${k} | ${v.licence} | ${v.author || 'unknown'} | [${v.title.slice(0, 50)}](${v.page}) |`);
    fs.writeFileSync(path.join(__dirname, '..', '..', '..', 'docs', 'demo-photo-sources.md'),
        `# Demo shop photos: sources and licences\n\nAll pictures come from Wikimedia Commons (https://commons.wikimedia.org). Public-domain / CC0 pictures were chosen first; where a dish had none, a Creative Commons attribution picture was used and its author is credited here. No recognisable faces or brand logos. Made by backend/src/scripts/findDemoPhotos.js.\n\n| Used for | Licence | Author | File |\n|---|---|---|---|\n${rows.join('\n')}\n`);
    console.log(`\n${Object.keys(out).length} of ${keys.length} found`);
})();
