// "Did you like the demo?" leads: made from the public demo website, listed for the supreme admin to call.
const crypto = require('crypto');
const DemoLead = require('../models/DemoLead');
const { httpError } = require('../middlewares/apiErrors');

const PHONE_RE = /^[6-9]\d{9}$/;
const STORY_RE = /^[a-z0-9-]{1,30}$/;
const LANGS = ['en', 'hi', 'bho', 'mr', 'gu', 'bn'];
const clean = (v, n) => String(v || '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// body: { name, shopName, phone, language?, stories?, website? }   `website` is a hidden field: a person never fills it, a robot does
async function create({ body = {}, ip }) {
    if (clean(body.website, 5)) return { ok: true, ignored: true };   // a robot: answer "thanks" and keep nothing
    const name = clean(body.name, 80);
    const shopName = clean(body.shopName, 80);
    const phone = String(body.phone || '').replace(/\D/g, '').slice(-10);
    if (name.length < 2) throw httpError(400, 'Please tell us your name');
    if (shopName.length < 2) throw httpError(400, 'Please tell us the name of your shop');
    if (!PHONE_RE.test(phone)) throw httpError(400, 'Enter a 10 digit mobile number');
    const language = LANGS.includes(body.language) ? body.language : 'en';
    const stories = (Array.isArray(body.stories) ? body.stories : []).map(String).filter((s) => STORY_RE.test(s)).slice(0, 20);
    const ipHash = crypto.createHash('sha256').update(String(ip || '')).digest('hex').slice(0, 24);

    // the same number again within a day is one lead, asked again
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const same = await DemoLead.findOne({ phone, createdAt: { $gte: since } });
    let lead;
    if (same) {
        same.times += 1;
        same.name = name; same.shopName = shopName; same.language = language;
        same.stories = [...new Set([...same.stories, ...stories])];
        if (same.status === 'called') same.status = 'new';   // they wrote again: it needs a look
        lead = await same.save();
    } else {
        lead = await DemoLead.create({ name, shopName, phone, language, stories, ipHash });
    }
    // the supreme admin is told (inbox and push). A failure never stops the visitor from seeing "thanks".
    try {
        await require('./adminAlerts').alert('admin_demo_lead', { supremeOnly: true, vars: { name, shopName, phone }, data: { kind: 'demo_lead', leadId: String(lead._id) } });
    } catch (e) { /* the lead is saved */ }
    return { ok: true };
}

async function list({ status, q, page = 1, limit = 30 }) {
    const f = {};
    if (['new', 'called'].includes(status)) f.status = status;
    if (q) {
        const rx = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 40), 'i');
        f.$or = [{ name: rx }, { shopName: rx }, { phone: rx }];
    }
    const [items, total, fresh] = await Promise.all([
        DemoLead.find(f).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit + 1).lean(),
        DemoLead.countDocuments(f),
        DemoLead.countDocuments({ status: 'new' }),
    ]);
    return { items: items.slice(0, limit).map(view), hasMore: items.length > limit, total, new: fresh, page };
}

const view = (l) => ({
    id: l._id, name: l.name, shopName: l.shopName, phone: l.phone, language: l.language, stories: l.stories || [], status: l.status,
    calledAt: l.calledAt || null, note: l.note || '', times: l.times || 1, createdAt: l.createdAt,
});

async function update(id, body = {}) {
    const set = {};
    if (body.status !== undefined) {
        if (!['new', 'called'].includes(body.status)) throw httpError(400, 'Status must be new or called');
        set.status = body.status;
        set.calledAt = body.status === 'called' ? new Date() : null;
    }
    if (body.note !== undefined) set.note = clean(body.note, 500);
    if (!Object.keys(set).length) throw httpError(400, 'Nothing to change');
    const l = await DemoLead.findByIdAndUpdate(id, { $set: set }, { returnDocument: 'after' }).lean();
    if (!l) throw httpError(404, 'Lead not found');
    return view(l);
}

async function remove(id) {
    const r = await DemoLead.deleteOne({ _id: id });
    if (!r.deletedCount) throw httpError(404, 'Lead not found');
    return { ok: true };
}

module.exports = { create, list, update, remove };
