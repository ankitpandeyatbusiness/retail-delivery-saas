// Terms, agreements and the privacy policy.
//
//   Six documents (services/legalTemplates.js). The supreme admin edits a DRAFT and presses "Send new version"; that freezes a copy
//   (names filled in) and asks everybody in that audience to agree:
//     team      every other superadmin (not the supreme one) -> team_terms
//     owner     shop owners (role admin)                     -> owner_terms
//     rider     riders: they only READ rider_terms, customer_terms and privacy; nothing to agree to
//     customer  customers: they only READ customer_terms and privacy; nothing to agree to
//
//   WHEN the agree screen shows: on the person's SECOND visit after the version was sent (a visit = opening the app after at least
//   30 minutes away), never at the first. A document sent as askWhen "free_ends" waits for the shop's free period to end.
const LegalDocument = require('../models/LegalDocument');
const LegalAcceptance = require('../models/LegalAcceptance');
const LegalVisit = require('../models/LegalVisit');
const PlatformSettings = require('../models/PlatformSettings');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const SuperAdmin = require('../models/SuperAdmin');
const { DOCS } = require('./legalTemplates');
const { PHONE: SUPREME_PHONE } = require('../config/supreme');
const settlement = require('./settlement');
const { httpError } = require('../middlewares/apiErrors');

const VISIT_GAP_MS = 30 * 60000;
const KEYS = Object.keys(DOCS);
const GATE_DOC = { team: 'team_terms', owner: ['owner_terms', 'owner_privacy'] };
const READ_ONLY_DOC = { rider: 'rider_terms' };   // riders only read their terms, nothing to agree to
const PUBLIC_KEYS = ['customer_terms', 'privacy', 'about_us'];

/* ------------------------------ the text ------------------------------ */
async function variables() {
    const p = await PlatformSettings.findById('main').select('business settlement').lean();
    const b = p?.business || {};
    const cfg = await settlement.getConfig();
    const contact = b.contactPhone || b.phone;
    const day = new Date(Date.now() + 330 * 60000).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    return {
        platformName: b.appName || 'the platform',
        operatorName: b.legalName || '[operator name]',
        operatorAddress: b.address || '[operator address]',
        operatorGstin: b.gstin ? ` (GSTIN ${b.gstin})` : '',
        ownerName: cfg.ownerName, partnerName: cfg.partnerName, payDays: cfg.payDays, royaltyPct: cfg.royaltyPct,
        ownerPctPartnerBrought: cfg.ownerPctPartnerBrought, partnerPctPartnerBrought: 100 - cfg.ownerPctPartnerBrought,
        ownerPctOwnerBrought: cfg.ownerPctOwnerBrought, partnerPctOwnerBrought: 100 - cfg.ownerPctOwnerBrought,
        costOwnerPct: cfg.costOwnerPct, costPartnerPct: 100 - cfg.costOwnerPct,
        effectiveDate: day,
        shopName: '{{shopName}}',   // kept as it is when a version is sent; filled with the shop's name each time a customer reads it
        supportLine: contact ? `For any question call ${contact}${b.email ? ` or write to ${b.email}` : ''}.` : (b.email ? `For any question write to ${b.email}.` : 'For any question, contact the support given in the app.'),
    };
}

const fill = (text, vars) => String(text || '').replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])));
const blanksIn = (text) => [...new Set(String(text).match(/\[[^\]\n]{2,}\]/g) || [])];
const unfilled = (text) => [...new Set(String(text).match(/\{\{\w+\}\}/g) || [])].filter((x) => x !== '{{shopName}}');

/* ------------------------------ the documents ------------------------------ */
async function ensureDocs() {
    for (const key of KEYS) {
        const d = DOCS[key];
        await LegalDocument.updateOne(
            { key },
            { $setOnInsert: { key, audience: d.audience, draft: { title: d.title, body: d.body, updatedAt: new Date(), updatedBy: 'system' }, currentVersion: 0, versions: [] } },
            { upsert: true },
        );
    }
}

async function loadDoc(key) {
    if (!DOCS[key]) throw httpError(404, 'Unknown document');
    await ensureDocs();
    return LegalDocument.findOne({ key });
}

const current = (doc) => doc.versions.find((v) => v.no === doc.currentVersion) || null;
const versionView = (v, withBody = true) => v && ({ no: v.no, title: v.title, ...(withBody ? { body: v.body } : {}), summary: v.summary, askWhen: v.askWhen, publishedAt: v.publishedAt, operatorName: v.operatorName });

async function list() {
    await ensureDocs();
    const docs = await LegalDocument.find({}).lean();
    const vars = await variables();
    const out = [];
    for (const key of KEYS) {
        const d = docs.find((x) => x.key === key);
        const cur = d.versions.find((v) => v.no === d.currentVersion);
        const stats = cur && GATE_DOC_AUDIENCES.includes(d.audience) ? await acceptanceCounts(key, cur.no, d.audience) : null;
        out.push({
            key, audience: d.audience, title: cur?.title || d.draft?.title || DOCS[key].title, currentVersion: d.currentVersion,
            publishedAt: cur?.publishedAt || null, summary: cur?.summary || null, draftChanged: !cur || fill(d.draft?.body, vars) !== cur.body,
            versions: d.versions.length, stats,
        });
    }
    return out;
}
const GATE_DOC_AUDIENCES = ['team', 'owner'];

async function getFull(key) {
    const doc = await loadDoc(key);
    const v = await variables();
    const cur = current(doc);
    return {
        key, audience: doc.audience, currentVersion: doc.currentVersion,
        draft: { title: doc.draft?.title, body: doc.draft?.body, updatedAt: doc.draft?.updatedAt, updatedBy: doc.draft?.updatedBy },
        current: versionView(cur),
        versions: doc.versions.map((x) => versionView(x, false)),
        variables: v,
        blanks: blanksIn(fill(doc.draft?.body, v)),
    };
}

async function saveDraft(key, { title, body }, by) {
    const doc = await loadDoc(key);
    const t = String(title ?? doc.draft?.title ?? '').trim();
    const b = String(body ?? doc.draft?.body ?? '');
    if (!t || t.length > 120) throw httpError(400, 'The title is needed (up to 120 letters)');
    if (b.trim().length < 20 || b.length > 60000) throw httpError(400, 'The text is needed (up to 60,000 letters)');
    doc.draft = { title: t, body: b, updatedAt: new Date(), updatedBy: by };
    await doc.save();
    return getFull(key);
}

// "Send new version": freezes the draft with the names filled in, and asks the audience to agree on their second visit
async function publish(key, { summary, askWhen, allowBlanks }, by) {
    const doc = await loadDoc(key);
    if (askWhen !== undefined && !['now', 'free_ends'].includes(askWhen)) throw httpError(400, 'askWhen must be "now" or "free_ends"');
    const text = fill(doc.draft?.body, await variables());
    const open = unfilled(text);
    if (open.length) throw httpError(400, `These names are not set yet: ${open.join(', ')}. Fill the company details first.`);
    const blanks = blanksIn(text);
    if (blanks.length && !allowBlanks) {
        const e = httpError(400, `Fill in the blanks first: ${blanks.slice(0, 5).join(', ')}${blanks.length > 5 ? ' ...' : ''}`);
        e.blanks = blanks;
        throw e;
    }
    const p = await PlatformSettings.findById('main').select('business.legalName').lean();
    const no = doc.currentVersion + 1;
    doc.versions.push({
        no, title: doc.draft.title, body: text, summary: String(summary || '').trim().slice(0, 300) || undefined,
        askWhen: doc.audience === 'owner' && askWhen === 'free_ends' ? 'free_ends' : 'now', publishedAt: new Date(), publishedBy: by, operatorName: p?.business?.legalName,
    });
    doc.currentVersion = no;
    await doc.save();
    return getFull(key);
}

// the name of the shop whose app is open (from the x-tenant-slug header), for the {{shopName}} in the customer pages
async function shopNameFor(slug) {
    const s = String(slug || '').trim().toLowerCase();
    if (!/^[a-z0-9-]{1,60}$/.test(s)) return null;
    const t = await Tenant.findOne({ slug: s }).select('name').lean();
    return t?.name || null;
}

async function readCurrent(key, { shopName } = {}) {
    const d = await readRaw(key);
    return d && typeof d.body === 'string' ? { ...d, body: fill(d.body, { shopName: shopName || 'the shop' }) } : d;
}

async function readRaw(key) {
    const doc = await loadDoc(key);
    const cur = current(doc);
    if (!cur) {
        // nothing has been sent yet: a public page still shows the draft with the names filled in, so a store listing never has a blank link
        if (PUBLIC_KEYS.includes(key)) return { key, no: 0, title: doc.draft?.title, body: fill(doc.draft?.body, await variables()), publishedAt: null, draft: true };
        return null;
    }
    return { key, ...versionView(cur) };
}

/* ------------------------------ who gets which document ------------------------------ */
const isSupremeAdmin = (admin) => Array.isArray(admin?.phones) && admin.phones.includes(SUPREME_PHONE);

// the documents a person must agree to (owners: the terms and the privacy policy), or []
function gateKeysFor({ who, role, admin }) {
    if (who === 'admin') return isSupremeAdmin(admin) ? [] : [GATE_DOC.team];
    if (role === 'admin') return GATE_DOC.owner;
    return [];   // customers and riders only read
}
const gateKeyFor = (x) => gateKeysFor(x)[0] || null;

// Called when the app opens. Counts the visit and says whether the agree screen must show now.
// When several documents wait (owners), they are asked together: `docs` lists them, the first one is also at the top level.
async function status({ who, userId, role, admin, tenant, now = new Date() }) {
    const keys = gateKeysFor({ who, role, admin });
    if (!keys.length) return { required: false };
    const pending = [];
    let lastSeen = null;
    for (const key of keys) {
        const doc = await loadDoc(key);
        const cur = current(doc);
        if (!cur) continue;
        lastSeen = { key, version: cur.no };
        const accepted = await LegalAcceptance.exists({ who, userId, docKey: key, version: cur.no });
        if (!accepted) pending.push({ key, cur });
    }
    if (!pending.length) return lastSeen ? { required: false, ...lastSeen, agreed: true } : { required: false };

    const { key, cur } = pending[0];
    // counting starts when the version was sent (no handover step)
    const from = new Date(Math.max(...pending.map((x) => new Date(x.cur.publishedAt).getTime())));
    let visit = await LegalVisit.findOne({ who, userId, docKey: key });
    if (!visit || visit.version !== cur.no || !visit.lastVisitAt || new Date(visit.lastVisitAt) < new Date(cur.publishedAt)) {
        visit = await LegalVisit.findOneAndUpdate({ who, userId, docKey: key }, { $set: { version: cur.no, visits: 0, lastVisitAt: null } }, { upsert: true, returnDocument: 'after' });
    }
    if (!visit.lastVisitAt || now.getTime() - new Date(visit.lastVisitAt).getTime() >= VISIT_GAP_MS) {
        visit = await LegalVisit.findOneAndUpdate({ _id: visit._id }, { $inc: { visits: 1 }, $set: { lastVisitAt: now } }, { returnDocument: 'after' });
    }
    // a document that waits for the end of the free period (owners)
    if (cur.askWhen === 'free_ends' && who === 'user' && role === 'admin' && (tenant?.billing?.state || 'free') === 'free') {
        return { required: false, key, version: cur.no, waiting: 'free_period' };
    }
    void from;
    const view = (x) => ({ key: x.key, version: x.cur.no, title: x.cur.title, body: x.cur.body, summary: x.cur.summary, publishedAt: x.cur.publishedAt });
    return visit.visits >= 2
        ? { required: true, ...view(pending[0]), visits: visit.visits, docs: pending.map(view) }
        : { required: false, key, version: cur.no, visits: visit.visits };
}

async function accept({ who, userId, role, admin, tenant, key, version, name, phone }) {
    const need = gateKeysFor({ who, role, admin });
    if (!need.includes(key)) throw httpError(400, 'This is not a document for you');
    const doc = await loadDoc(key);
    if (Number(version) !== doc.currentVersion || !doc.currentVersion) throw httpError(409, 'There is a newer version. Please read it first.');
    const cur = current(doc);
    try {
        await LegalAcceptance.create({ who, userId, tenantId: tenant?._id, docKey: key, version: cur.no, name, phone, operatorName: cur.operatorName });
    } catch (e) { if (e.code !== 11000) throw e; }   // already agreed
    return { ok: true, key, version: cur.no };
}

// every document a person may read, with the version he agreed to
async function mine({ who, userId, role, admin }) {
    await ensureDocs();
    const own = gateKeysFor({ who, role, admin });
    const keys = [...new Set([...own, who === 'user' ? READ_ONLY_DOC[role] : null, 'customer_terms', 'privacy'].filter(Boolean))];
    const docs = await LegalDocument.find({ key: { $in: keys } }).lean();
    const acc = await LegalAcceptance.find({ who, userId, docKey: { $in: keys } }).sort({ version: -1 }).lean();
    return keys.map((key) => {
        const d = docs.find((x) => x.key === key);
        const cur = d?.versions.find((v) => v.no === d.currentVersion);
        const a = acc.find((x) => x.docKey === key);
        return {
            key, title: cur?.title || DOCS[key].title, version: d?.currentVersion || 0, publishedAt: cur?.publishedAt || null, mustAgree: own.includes(key),
            agreedVersion: a?.version || null, agreedAt: a?.acceptedAt || null, upToDate: !!a && a.version === d?.currentVersion,
        };
    });
}

/* ------------------------------ reports for the supreme admin ------------------------------ */
async function audienceCount(audience) {
    if (audience === 'owner') return User.countDocuments({ role: 'admin', tenantId: { $exists: true, $ne: null } });
    if (audience === 'rider') return User.countDocuments({ role: 'rider', tenantId: { $exists: true, $ne: null } });
    if (audience === 'partner') return SuperAdmin.countDocuments({ isActive: true, legalRole: 'partner', phones: { $ne: SUPREME_PHONE } });
    return SuperAdmin.countDocuments({ isActive: true, legalRole: { $ne: 'partner' }, phones: { $ne: SUPREME_PHONE } });
}

async function acceptanceCounts(key, version, audience) {
    const [total, agreed] = await Promise.all([audienceCount(audience), LegalAcceptance.countDocuments({ docKey: key, version })]);
    return { total, agreed, waiting: Math.max(0, total - agreed) };
}

// who agreed to the current version and who has not (the audience, for owners and riders: shops that were handed over)
async function acceptances(key) {
    const doc = await loadDoc(key);
    const cur = current(doc);
    if (!cur) return { version: 0, agreed: [], waiting: [] };
    const agreedRows = await LegalAcceptance.find({ docKey: key, version: cur.no }).sort({ acceptedAt: -1 }).lean();
    const done = new Set(agreedRows.map((r) => String(r.userId)));
    let people = [];
    if (doc.audience === 'owner' || doc.audience === 'rider') {
        const shops = await Tenant.find({}).select('name').lean();
        const names = new Map(shops.map((s) => [String(s._id), s.name]));
        const users = await User.find({ role: doc.audience === 'owner' ? 'admin' : 'rider', tenantId: { $in: shops.map((s) => s._id) } }).select('name phone tenantId').limit(1000).lean();
        people = users.map((u) => ({ id: String(u._id), name: u.name || '', phone: u.phone, shop: names.get(String(u.tenantId)) }));
    } else {
        const admins = await SuperAdmin.find({ isActive: true, phones: { $ne: SUPREME_PHONE }, ...(doc.audience === 'partner' ? { legalRole: 'partner' } : { legalRole: { $ne: 'partner' } }) }).select('name email phones').lean();
        people = admins.map((a) => ({ id: String(a._id), name: a.name || a.email, phone: a.phones?.[0] }));
    }
    return {
        version: cur.no,
        agreed: agreedRows.map((r) => ({ id: String(r.userId), name: r.name, phone: r.phone, at: r.acceptedAt, operatorName: r.operatorName })),
        waiting: people.filter((p) => !done.has(p.id)),
    };
}

async function markHandover(tenantId, on, by) {
    const set = on ? { handedOverAt: new Date(), handedOverBy: by } : null;
    const t = await Tenant.findByIdAndUpdate(tenantId, on ? { $set: set } : { $unset: { handedOverAt: '', handedOverBy: '' } }, { returnDocument: 'after' }).select('name handedOverAt').lean();
    if (!t) throw httpError(404, 'Shop not found');
    return { shop: t.name, handedOverAt: t.handedOverAt || null };
}

module.exports = {
    KEYS, PUBLIC_KEYS, GATE_DOC, READ_ONLY_DOC, gateKeysFor, ensureDocs, list, getFull, saveDraft, publish, readCurrent, status, accept, mine, acceptances, markHandover,
    variables, fill, blanksIn, shopNameFor, gateKeyFor, isSupremeAdmin, VISIT_GAP_MS,
};
