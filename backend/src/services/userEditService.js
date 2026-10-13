// Look at a person and edit his details. Used by the superadmin routes and the owner routes.
//   applyProfile  name, email, notes (never the phone)
//   changePhone   superadmin only: unique per shop, new phoneHash, logs him out everywhere
//   detail        order numbers, Cash on delivery strikes, rider profile
const User = require('../models/User');
const Rider = require('../models/Rider');
const Order = require('../models/Order');
const Session = require('../models/Session');
const CustomerRisk = require('../models/CustomerRisk');
const center = require('../notifications/center');
const cleanEmail = require('../utils/cleanEmail');
const { hashPhone } = require('../utils/phoneHash');
const { httpError } = require('../middlewares/apiErrors');

const PHONE_RE = /^[6-9]\d{9}$/;
const maskEmail = (e) => String(e).replace(/^(.).*(@.*)$/, '$1***$2');

const cleanText = (v, max, label) => {
    if (typeof v !== 'string') throw httpError(400, `${label} must be text`);
    const t = v.trim();
    if (t.length > max) throw httpError(400, `${label} can be up to ${max} characters`);
    return t;
};

// returns { set, unset }; an empty text clears the field
function parseProfile(body, phoneHint) {
    const b = body || {};
    if (b.phone !== undefined) throw httpError(400, phoneHint);
    const set = {};
    const unset = {};
    const put = (key, value) => { if (value) set[key] = value; else unset[key] = 1; };
    if (b.name !== undefined) put('name', cleanText(b.name, 80, 'Name'));
    if (b.email !== undefined) put('email', cleanEmail(b.email));
    if (b.notes !== undefined) put('notes', cleanText(b.notes, 300, 'Notes'));
    if (!Object.keys(set).length && !Object.keys(unset).length) throw httpError(400, 'Send name, email or notes');
    return { set, unset };
}

// the owner's login email changed: the OLD address is told, so a stolen panel cannot move the mail away in silence
async function tellOldEmail(tenantId, oldEmail, newEmail) {
    await center.notify('owner_email_changed', {
        tenantId,
        title: 'Owner email changed',
        body: `The login email of an owner was ${newEmail ? `changed to ${maskEmail(newEmail)}` : 'removed'} by the platform.`,
        emailTo: [oldEmail],
        vars: { newEmailMasked: newEmail ? maskEmail(newEmail) : '', when: new Date() },
    });
}

async function applyProfile({ tenantId, user, body, phoneHint = 'The phone number cannot be changed here' }) {
    const { set, unset } = parseProfile(body, phoneHint);
    const before = { name: user.name, email: user.email, notes: user.notes };
    const update = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;

    const after = await User.findOneAndUpdate({ _id: user._id, tenantId }, update, { returnDocument: 'after' }).lean();
    if (!after) throw httpError(404, 'User not found');

    if (user.role === 'rider' && (set.name || unset.name)) {   // the rider screen shows the rider name
        await Rider.updateOne({ tenantId, userId: user._id }, set.name ? { $set: { name: set.name } } : { $unset: { name: 1 } });
    }
    if (user.role === 'admin' && user.email && after.email !== user.email) {
        await tellOldEmail(tenantId, user.email, after.email);
    }
    return { before, user: after };
}

async function changePhone({ tenantId, user, phone, reason }) {
    phone = String(phone || '').trim();
    if (!PHONE_RE.test(phone)) throw httpError(400, 'Enter a valid 10-digit mobile number');
    reason = typeof reason === 'string' ? reason.trim() : '';
    if (reason.length < 3 || reason.length > 200) throw httpError(400, 'Write the reason (3 to 200 characters)');
    if (phone === user.phone) throw httpError(409, 'This is already his number');
    if (await User.exists({ tenantId, phone })) throw httpError(409, 'This number is already used in this shop');

    let after;
    try {
        after = await User.findOneAndUpdate(
            { _id: user._id, tenantId },
            { $set: { phone, phoneHash: hashPhone(tenantId, phone) } },
            { returnDocument: 'after' },
        ).lean();
    } catch (e) {
        if (e.code === 11000) throw httpError(409, 'This number is already used in this shop');
        throw e;
    }
    if (!after) throw httpError(404, 'User not found');
    await Session.deleteMany({ userId: user._id, tenantId });   // he signs in again with the new number
    return { before: { phone: user.phone, reason }, user: after };
}

async function detail(tenantId, user) {
    const [agg, risk, rider] = await Promise.all([
        Order.aggregate([
            { $match: { tenantId, userId: user._id } },
            {
                $group: {
                    _id: null,
                    orders: { $sum: 1 },
                    delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
                    cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
                    spent: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, { $ifNull: ['$pricing.total', 0] }, 0] } },
                    lastOrderAt: { $max: '$createdAt' },
                }
            },
        ]),
        user.role === 'customer'
            ? CustomerRisk.findOne({ tenantId, phoneHash: user.phoneHash || hashPhone(tenantId, user.phone) }).select('strikes codBlocked').lean()
            : null,
        user.role === 'rider'
            ? Rider.findOne({ tenantId, userId: user._id }).select('name isActive isOnline activeOrderCount ratingAvg ratingCount').lean()
            : null,
    ]);
    const a = agg[0] || {};
    return {
        stats: {
            orders: a.orders || 0, delivered: a.delivered || 0, cancelled: a.cancelled || 0,
            spentTotal: a.spent || 0, lastOrderAt: a.lastOrderAt || null,
        },
        ...(user.role === 'customer' ? { cod: { strikes: risk?.strikes || 0, blocked: !!risk?.codBlocked } } : {}),
        ...(rider ? { rider } : {}),
    };
}

// what the owner sees (his own people, so the full phone)
const profileView = (u) => ({
    id: u._id, phone: u.phone, name: u.name || null, email: u.email || null, notes: u.notes || null,
    role: u.role, lastLoginAt: u.lastLoginAt || null, createdAt: u.createdAt,
});

module.exports = { applyProfile, changePhone, detail, profileView };