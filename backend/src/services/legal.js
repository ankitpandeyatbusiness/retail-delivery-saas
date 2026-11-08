// Terms of service, privacy policies and About Us.
//   The built-in text is written in legalTemplates.js / legalTemplatesMain.js. The supreme admin can change any of them in the superadmin app
//   (models/LegalPage.js): edit a DRAFT, press PUBLISH, and the new text shows in every app and on every public web page at once.
//   Nothing is asked of the people who read them: using the app means accepting. Every published text is kept (history), and an old one can be
//   brought back as the draft and published again.
//   The names ({{platformName}}, the operator's details ...) are filled in from Platform business when a page is read.
//   GET /api/legal/public/:key (JSON, routes/legalRouter.js)     GET /legal/terms ... (web pages, routes/publicLegalRouter.js)     admin: routes/adminLegalPagesRouter.js
const PlatformSettings = require('../models/PlatformSettings');
const Tenant = require('../models/Tenant');
const LegalPage = require('../models/LegalPage');
const { httpError } = require('../middlewares/apiErrors');
const { DOCS, EFFECTIVE_DATE } = require('./legalTemplates');

const KEYS = Object.keys(DOCS);
const KEEP_VERSIONS = 50;

// 12 November 2026, in Indian time
const istDay = (d) => new Date(new Date(d).getTime() + 330 * 60000).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// the operator's details are saved in the superadmin app (Platform business). A missing one stays a visible blank in [square brackets].
async function variables() {
    const p = await PlatformSettings.findById('main').select('business').lean();
    const b = p?.business || {};
    const contact = b.contactPhone || b.phone;
    return {
        platformName: b.appName || 'Vivyaan',
        operatorName: b.legalName || '[operator name]',
        operatorAddress: b.address || '[operator address]',
        operatorGstin: b.gstin ? ` (GSTIN ${b.gstin})` : '',
        effectiveDate: EFFECTIVE_DATE,
        contactEmail: b.email || '[support email]',
        contactPhone: contact || '[support phone]',
        supportLine: contact ? `For any question call ${contact}${b.email ? ` or write to ${b.email}` : ''}.` : (b.email ? `For any question write to ${b.email}.` : 'For any question, contact the support given in the app.'),
    };
}

const fill = (text, vars) => String(text || '').replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])));
const blanksIn = (text) => [...new Set(String(text).match(/\[[^\]\n]{2,}\]/g) || [])];
const unknownNames = (text, vars) => [...new Set([...String(text).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))].filter((k) => vars[k] === undefined);

// the name of the shop whose app is open (from the x-tenant-slug header)
async function shopNameFor(slug) {
    const s = String(slug || '').trim().toLowerCase();
    if (!/^[a-z0-9-]{1,60}$/.test(s)) return null;
    const t = await Tenant.findOne({ slug: s }).select('name').lean();
    return t?.name || null;
}

const currentOf = (rec) => (rec?.currentNo ? rec.versions.find((v) => v.no === rec.currentNo) || null : null);

// what the apps and the web pages show: { key, title, body } with every name filled in, or null. The published text if there is one, else the built-in one.
async function readCurrent(key, { shopName } = {}) {
    const d = DOCS[key];
    if (!d) return null;
    const cur = currentOf(await LegalPage.findOne({ key }).select('versions currentNo').lean());
    const vars = { ...(await variables()), shopName: shopName || 'the shop' };
    if (cur) vars.effectiveDate = istDay(cur.publishedAt);
    return { key, title: cur?.title || d.title, body: fill(cur?.body || d.body, vars) };
}

/* ------------------------------ the superadmin editor ------------------------------ */
const known = (key) => { if (!DOCS[key]) throw httpError(404, 'Unknown document'); };

async function list() {
    const recs = await LegalPage.find({}).select('key draft versions currentNo').lean();
    return KEYS.map((key) => {
        const rec = recs.find((r) => r.key === key);
        const cur = currentOf(rec);
        return {
            key, title: cur?.title || DOCS[key].title, audience: DOCS[key].audience,
            currentNo: rec?.currentNo || 0, publishedAt: cur?.publishedAt || null, publishedBy: cur?.publishedBy || null,
            hasDraft: !!rec?.draft, versions: rec?.versions?.length || 0,
        };
    });
}

async function getFull(key) {
    known(key);
    const rec = await LegalPage.findOne({ key }).lean();
    const cur = currentOf(rec);
    const vars = { ...(await variables()), shopName: 'the shop' };
    // the draft starts as what is shown now (the published text, else the built-in one)
    const base = { title: cur?.title || DOCS[key].title, body: cur?.body || DOCS[key].body };
    const draft = rec?.draft ? { title: rec.draft.title, body: rec.draft.body, updatedAt: rec.draft.updatedAt, updatedBy: rec.draft.updatedBy, changed: true } : { ...base, changed: false };
    const previewVars = { ...vars, effectiveDate: istDay(new Date()) };
    return {
        key, audience: DOCS[key].audience, currentNo: rec?.currentNo || 0,
        current: cur ? { no: cur.no, title: cur.title, body: cur.body, publishedAt: cur.publishedAt, publishedBy: cur.publishedBy } : null,
        builtIn: { title: DOCS[key].title, body: DOCS[key].body },
        draft,
        versions: (rec?.versions || []).map((v) => ({ no: v.no, title: v.title, publishedAt: v.publishedAt, publishedBy: v.publishedBy })).reverse(),
        names: Object.keys(vars),                              // the {{names}} that can be used in the text
        blanks: blanksIn(fill(draft.body, previewVars)),       // [blanks] that are still open (the operator's details in Platform business)
        preview: fill(draft.body, previewVars),
    };
}

function checkText({ title, body }) {
    const t = String(title ?? '').trim();
    const b = String(body ?? '');
    if (!t || t.length > 120) throw httpError(400, 'The title is needed (up to 120 letters)');
    if (b.trim().length < 20 || b.length > 60000) throw httpError(400, 'The text is needed (up to 60,000 letters)');
    return { title: t, body: b };
}

async function saveDraft(key, input, by) {
    known(key);
    const rec = await LegalPage.findOne({ key }).lean();
    const cur = currentOf(rec);
    const { title, body } = checkText({ title: input?.title ?? rec?.draft?.title ?? cur?.title ?? DOCS[key].title, body: input?.body ?? rec?.draft?.body ?? cur?.body ?? DOCS[key].body });
    await LegalPage.updateOne({ key }, { $set: { draft: { title, body, updatedAt: new Date(), updatedBy: by } } }, { upsert: true });
    return getFull(key);
}

async function discardDraft(key) {
    known(key);
    await LegalPage.updateOne({ key }, { $unset: { draft: 1 } });
    return getFull(key);
}

// PUBLISH: the draft becomes the text everybody sees, at once. A new version is kept in the history.
async function publish(key, by) {
    known(key);
    const rec = await LegalPage.findOne({ key }).lean();
    if (!rec?.draft) throw httpError(409, 'There is nothing to publish: change the text and save it first');
    const { title, body } = checkText(rec.draft);
    const vars = { ...(await variables()), shopName: 'the shop' };
    const bad = unknownNames(body, vars);
    if (bad.length) throw httpError(400, `These names are not known: ${bad.map((x) => `{{${x}}}`).join(', ')}. Use only: ${Object.keys(vars).map((x) => `{{${x}}}`).join(', ')}`);
    const blanks = blanksIn(fill(body, vars));
    if (blanks.length) throw Object.assign(httpError(400, `Fill in the blanks first: ${blanks.slice(0, 5).join(', ')}${blanks.length > 5 ? ' ...' : ''}. The operator's details are saved in Platform business.`), { blanks });
    const no = Math.max(0, ...(rec.versions || []).map((v) => v.no)) + 1;
    await LegalPage.updateOne({ key }, {
        $push: { versions: { $each: [{ no, title, body, publishedAt: new Date(), publishedBy: by }], $slice: -KEEP_VERSIONS } },
        $set: { currentNo: no },
        $unset: { draft: 1 },
    });
    return getFull(key);
}

async function version(key, no) {
    known(key);
    const rec = await LegalPage.findOne({ key }).lean();
    const v = (rec?.versions || []).find((x) => x.no === Number(no));
    if (!v) throw httpError(404, 'That version does not exist');
    return { no: v.no, title: v.title, body: v.body, publishedAt: v.publishedAt, publishedBy: v.publishedBy };
}

// bring an old version back as the DRAFT (press Publish to make it current again)
async function restore(key, no, by) {
    const v = await version(key, no);
    await LegalPage.updateOne({ key }, { $set: { draft: { title: v.title, body: v.body, updatedAt: new Date(), updatedBy: by } } }, { upsert: true });
    return getFull(key);
}

module.exports = { KEYS, variables, fill, shopNameFor, readCurrent, list, getFull, saveDraft, discardDraft, publish, version, restore };
