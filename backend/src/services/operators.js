// The companies that run the platform, and the "Switch operator" button.
//
//   profile   a company: legal name, address, GSTIN, PAN, state, SAC, invoice prefix, "Powered by", Razorpay keys, and how its
//             money is shared (settlementMode)
//   live      PlatformSettings.business / .payments / .settlement.mode: what invoices, mails and payments read right now
//   switch    copies the chosen profile into live, starts the new invoice numbering (the prefix), tells the shops, and writes it down
//
// Old invoices are never touched: each one keeps the seller details it was made with.
const mongoose = require('mongoose');
const Operator = require('../models/Operator');
const OperatorSwitch = require('../models/OperatorSwitch');
const PlatformSettings = require('../models/PlatformSettings');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const SmsWallet = require('../models/SmsWallet');
const SmsTopup = require('../models/SmsTopup');
const SettlementEntry = require('../models/SettlementEntry');
const LegalDocument = require('../models/LegalDocument');
const Counter = require('../models/Counter');
const Tenant = require('../models/Tenant');
const secretBox = require('../utils/secretBox');
const gstSplit = require('./gstSplit');
const platformPayments = require('./platformPayments');
const { httpError } = require('../middlewares/apiErrors');

const BUSINESS_FIELDS = ['legalName', 'address', 'gstin', 'pan', 'state', 'stateCode', 'sacCode', 'invoicePrefix', 'poweredBy', 'contactPhone', 'email', 'phone', 'paymentInstructions', 'appName', 'brandColor', 'logoUrl'];
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const KEY_ID_RE = /^rzp_(test|live)_[A-Za-z0-9]{6,40}$/;

const rawLive = async () => PlatformSettings.collection.findOne({ _id: 'main' }, { projection: { business: 1, payments: 1, settlement: 1, activeOperatorId: 1 } });

/* ------------------------------ checking what is typed ------------------------------ */
function cleanBusiness(input = {}) {
    const out = {};
    for (const f of BUSINESS_FIELDS) {
        if (input[f] === undefined) continue;
        if (typeof input[f] !== 'string') throw httpError(400, `${f} must be text`);
        out[f] = input[f].trim();
    }
    if (out.gstin !== undefined) { out.gstin = out.gstin.toUpperCase(); if (out.gstin && !GSTIN_RE.test(out.gstin)) throw httpError(400, 'GST number must be 15 characters, like 22AAAAA0000A1Z5'); }
    if (out.pan !== undefined) { out.pan = out.pan.toUpperCase(); if (out.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(out.pan)) throw httpError(400, 'PAN must look like ABCDE1234F'); }
    if (out.invoicePrefix !== undefined) { out.invoicePrefix = out.invoicePrefix.toUpperCase(); if (!/^[A-Z0-9-]{0,12}$/.test(out.invoicePrefix)) throw httpError(400, 'Prefix: letters, digits and - only (up to 12)'); }
    if (out.stateCode !== undefined && out.stateCode && !/^\d{2}$/.test(out.stateCode)) throw httpError(400, 'State code is 2 digits, like 09');
    if (out.state) {
        const code = gstSplit.codeFromName(out.state);
        if (!code) throw httpError(400, 'Enter an Indian state name, like Uttar Pradesh');
        out.state = gstSplit.nameOf(code);
        if (!out.stateCode) out.stateCode = code;
    }
    if (out.brandColor && !/^#[0-9a-fA-F]{6}$/.test(out.brandColor)) throw httpError(400, 'Colour must look like #1D4ED8');
    if (out.logoUrl && !/^https:\/\/\S+$/.test(out.logoUrl)) throw httpError(400, 'The logo link must start with https://');
    return out;
}

// invoice numbers with this prefix already exist: the prefix can no longer be changed (it would mix two series)
async function prefixUsed(prefix) {
    const p = String(prefix || '').toUpperCase();
    const re = p ? new RegExp(`^(subinv|topinv|cnote):${p}:`) : /^(subinv|topinv|cnote):\d{4}-\d{2}$/;
    return !!(await Counter.exists({ _id: re }));
}

/* ------------------------------ the profiles ------------------------------ */
const view = (o, activeId, keyOn) => ({
    id: o._id, label: o.label, active: String(o._id) === String(activeId), business: o.business || {}, settlementMode: o.settlementMode, notes: o.notes || '',
    hasKeys: !!keyOn, keyId: o.payments?.keyId || null, createdAt: o.createdAt,
});

async function list() {
    const live = await rawLive();
    const activeId = live?.activeOperatorId || null;
    const items = await Operator.find({}).select('+payments.keySecretEnc').sort({ createdAt: 1 }).lean();
    const out = [];
    for (const o of items) {
        const v = view(o, activeId, o.payments?.keyId && o.payments?.keySecretEnc);
        v.prefixLocked = await prefixUsed(o.business?.invoicePrefix);
        out.push(v);
    }
    const history = await OperatorSwitch.find({}).sort({ at: -1 }).limit(20).lean();
    return { items: out, activeId, history: history.map((h) => ({ id: h._id, from: h.fromLabel, to: h.toLabel, at: h.at, by: h.by, note: h.note })) };
}

// "Save what is live now as a profile": the first step, so the current company (with its keys) is kept before anything changes
async function saveLive(label, by) {
    const live = await rawLive();
    const b = live?.business || {};
    if (!b.legalName) throw httpError(400, 'Fill the business details first (Money, Business details)');
    const business = {};
    for (const f of BUSINESS_FIELDS) if (b[f] !== undefined) business[f] = b[f];
    const o = await Operator.create({
        label: String(label || b.legalName).trim().slice(0, 80), business,
        payments: { keyId: live?.payments?.keyId, keySecretEnc: live?.payments?.keySecretEnc, webhookSecretEnc: live?.payments?.webhookSecretEnc },
        settlementMode: live?.settlement?.mode === 'owner_only' ? 'owner_only' : 'split', createdBy: by,
    });
    if (!live?.activeOperatorId) await PlatformSettings.collection.updateOne({ _id: 'main' }, { $set: { activeOperatorId: o._id } }, { upsert: true });
    return o.toObject();
}

async function create({ label, business, settlementMode, notes }, by) {
    const name = String(label || '').trim();
    if (!name) throw httpError(400, 'Give the company a short name');
    if (settlementMode !== undefined && !['split', 'owner_only'].includes(settlementMode)) throw httpError(400, 'settlementMode must be "split" or "owner_only"');
    const o = await Operator.create({ label: name.slice(0, 80), business: cleanBusiness(business), settlementMode: settlementMode || 'split', notes: String(notes || '').slice(0, 300), createdBy: by });
    return o.toObject();
}

async function loadOne(id) {
    if (!mongoose.isValidObjectId(id)) throw httpError(404, 'Company not found');
    const o = await Operator.findById(id).select('+payments.keySecretEnc +payments.webhookSecretEnc');
    if (!o) throw httpError(404, 'Company not found');
    return o;
}

async function update(id, { label, business, settlementMode, notes }) {
    const o = await loadOne(id);
    if (label !== undefined) { const l = String(label).trim(); if (!l) throw httpError(400, 'Give the company a short name'); o.label = l.slice(0, 80); }
    if (notes !== undefined) o.notes = String(notes).slice(0, 300);
    if (settlementMode !== undefined) { if (!['split', 'owner_only'].includes(settlementMode)) throw httpError(400, 'settlementMode must be "split" or "owner_only"'); o.settlementMode = settlementMode; }
    if (business !== undefined) {
        const clean = cleanBusiness(business);
        if (clean.invoicePrefix !== undefined && clean.invoicePrefix !== (o.business?.invoicePrefix || '') && await prefixUsed(o.business?.invoicePrefix)) {
            throw httpError(409, 'Bills with this prefix have already been issued, so the prefix is locked. Make a new company profile for a new numbering.');
        }
        o.business = { ...(o.business?.toObject?.() || o.business || {}), ...clean };
    }
    await o.save();
    const live = await rawLive();
    // the company that is live also updates live (its keys stay as they are)
    if (String(live?.activeOperatorId) === String(o._id)) await applyBusiness(o);
    return o.toObject();
}

async function setKeys(id, { keyId, keySecret, webhookSecret }) {
    const o = await loadOne(id);
    const kid = typeof keyId === 'string' ? keyId.trim() : '';
    const sec = typeof keySecret === 'string' ? keySecret.trim() : '';
    if (!KEY_ID_RE.test(kid)) throw httpError(400, 'Key ID must look like rzp_test_xxxx or rzp_live_xxxx');
    if (sec.length < 10 || sec.length > 80) throw httpError(400, 'The key secret is missing or too short');
    o.payments = { keyId: kid, keySecretEnc: secretBox.encrypt(sec), webhookSecretEnc: webhookSecret ? secretBox.encrypt(String(webhookSecret).trim()) : o.payments?.webhookSecretEnc };
    await o.save();
    const live = await rawLive();
    if (String(live?.activeOperatorId) === String(o._id)) await applyKeys(o);
    return { ok: true, keyId: kid };
}

async function remove(id) {
    const o = await loadOne(id);
    const live = await rawLive();
    if (String(live?.activeOperatorId) === String(o._id)) throw httpError(409, 'This company is the active one. Switch to another first.');
    await Operator.deleteOne({ _id: o._id });
    return { ok: true };
}

/* ------------------------------ writing a profile into live ------------------------------ */
async function applyBusiness(o) {
    const business = {};
    for (const f of BUSINESS_FIELDS) business[f] = o.business?.[f] ?? undefined;
    Object.keys(business).forEach((k) => business[k] === undefined && delete business[k]);
    await PlatformSettings.collection.updateOne({ _id: 'main' }, { $set: { business, 'settlement.mode': o.settlementMode, activeOperatorId: o._id } }, { upsert: true });
}

async function applyKeys(o) {
    const p = o.payments || {};
    const set = {};
    const unset = { 'payments.verifiedAt': 1, 'payments.lastWebhookAt': 1 };   // the new account must be tested again
    if (p.keyId && p.keySecretEnc) { set['payments.keyId'] = p.keyId; set['payments.keySecretEnc'] = p.keySecretEnc; } else { unset['payments.keyId'] = 1; unset['payments.keySecretEnc'] = 1; }
    if (p.webhookSecretEnc) set['payments.webhookSecretEnc'] = p.webhookSecretEnc; else unset['payments.webhookSecretEnc'] = 1;
    await PlatformSettings.collection.updateOne({ _id: 'main' }, { ...(Object.keys(set).length ? { $set: set } : {}), $unset: unset }, { upsert: true });
    await platformPayments.load();
}

// The live settings (Money, Business details and My Razorpay) are always the ACTIVE company. When they are edited the active
// company's saved copy follows, so the two never drift apart and a later switch back never brings old details back.
async function syncActiveFromLive() {
    const live = await rawLive();
    if (!live?.activeOperatorId) return;
    const o = await Operator.findById(live.activeOperatorId).select('+payments.keySecretEnc +payments.webhookSecretEnc');
    if (!o) return;
    const business = {};
    for (const f of BUSINESS_FIELDS) if (live.business?.[f] !== undefined) business[f] = live.business[f];
    o.business = business;
    o.payments = { keyId: live.payments?.keyId, keySecretEnc: live.payments?.keySecretEnc, webhookSecretEnc: live.payments?.webhookSecretEnc };
    await o.save();
}

/* ------------------------------ the checklist and the switch ------------------------------ */
async function checklist(toId) {
    const to = toId ? await loadOne(toId) : null;
    const live = await rawLive();
    const b = to?.business || {};
    const [openBills, prepaid, openRows, docs, shops] = await Promise.all([
        SubscriptionInvoice.aggregate([{ $match: { status: 'pending' } }, { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$total' } } }]),
        SmsWallet.aggregate([{ $match: { balancePaise: { $gt: 0 } } }, { $group: { _id: null, shops: { $sum: 1 }, paise: { $sum: '$balancePaise' } } }]),
        SettlementEntry.aggregate([{ $match: { voided: { $ne: true }, status: { $in: ['pending', 'partial'] }, owes: { $ne: null } } }, { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: { $subtract: ['$dueAmount', '$paidAmount'] } } } }]),
        LegalDocument.find({ key: { $in: ['owner_terms', 'rider_terms', 'customer_terms', 'privacy'] } }).select('key currentVersion versions.publishedAt versions.operatorName').lean(),
        Tenant.countDocuments({ status: { $ne: 'suspended' } }),
    ]);
    const sameCompany = to && String(live?.activeOperatorId) === String(to._id);
    const items = [];
    const add = (id, label, ok, detail, blocking = false) => items.push({ id, label, ok: !!ok, detail, blocking });
    if (to) {
        add('details', 'Company details are complete (name, address, state)', b.legalName && b.address && b.state, b.legalName ? undefined : 'The legal name is missing', true);
        add('gst', 'GST number is saved (needed to charge GST)', !!b.gstin, b.gstin ? undefined : 'Without it no GST is charged on bills and top-ups');
        add('keys', 'Razorpay keys are saved for this company', to.payments?.keyId && to.payments?.keySecretEnc, 'Add the keys on this company’s page', true);
        add('prefix', 'The invoice prefix starts a new numbering', (b.invoicePrefix || '') !== (live?.business?.invoicePrefix || ''), 'Same prefix as now: the numbers would carry on from the old company’s series. Use a new prefix if the GST number is new.');
        add('sms', 'Sender name and templates are approved for this company', false, 'Check this yourself with your SMS provider (not something the app can see)');
    }
    add('bills', 'No open bills left in the old company’s name', !(openBills[0]?.count), openBills[0]?.count ? `${openBills[0].count} open bill(s), ${Math.round(openBills[0].amount)} rupees. They stay in the old company’s name; agree who collects them.` : undefined);
    add('settlement', 'Nothing left unsettled on the common sheet', !(openRows[0]?.count), openRows[0]?.count ? `${openRows[0].count} row(s), ${Math.round(openRows[0].amount)} rupees still to settle. Close the sheet first.` : undefined);
    add('sms_balance', 'Prepaid SMS balances are agreed', !(prepaid[0]?.shops), prepaid[0]?.shops ? `${prepaid[0].shops} shop(s) hold ${(prepaid[0].paise / 100).toFixed(2)} rupees of SMS balance. Agree who honours it.` : undefined);
    add('terms', 'Terms and privacy are sent in the new company’s name', docs.every((d) => d.currentVersion > 0), 'Send them again after the switch so the shops see the new company', false);
    return {
        to: to ? { id: to._id, label: to.label } : null, sameCompany: !!sameCompany, shops,
        items, canSwitch: !sameCompany && items.filter((i) => i.blocking).every((i) => i.ok),
        numbers: { openBills: openBills[0] || { count: 0, amount: 0 }, openSettlementRows: openRows[0] || { count: 0, amount: 0 }, prepaidSms: prepaid[0] || { shops: 0, paise: 0 } },
    };
}

async function switchTo(id, { note, notify = true } = {}, admin, sendNotice) {
    const to = await loadOne(id);
    const live = await rawLive();
    if (String(live?.activeOperatorId) === String(to._id)) throw httpError(409, 'This company is already the active one');
    const check = await checklist(id);
    if (!check.canSwitch) throw httpError(409, `Not ready: ${check.items.filter((i) => i.blocking && !i.ok).map((i) => i.label).join('; ')}`);
    const from = live?.activeOperatorId ? await Operator.findById(live.activeOperatorId).select('label').lean() : null;

    await applyBusiness(to);
    await applyKeys(to);

    let noticeSent = false;
    if (notify && typeof sendNotice === 'function') {
        try {
            await sendNotice({
                title: `From now ${to.business.legalName || to.label} provides your service`,
                body: `The company that provides ${to.business.appName || 'the app'} to your shop has changed to ${to.business.legalName || to.label}. Your bills and receipts will come in its name. Please read the updated terms when the app asks you.`,
            });
            noticeSent = true;
        } catch (e) { console.error('Operator notice error:', e.message); }
    }
    const rec = await OperatorSwitch.create({
        fromId: from ? live.activeOperatorId : undefined, fromLabel: from?.label, toId: to._id, toLabel: to.label, by: admin.name || admin.email, note: String(note || '').slice(0, 300) || undefined,
        checklist: check.items.map((i) => ({ id: i.id, ok: i.ok })), noticeSent,
    });
    return { ok: true, from: from?.label || null, to: to.label, noticeSent, switchId: rec._id };
}

module.exports = { syncActiveFromLive, BUSINESS_FIELDS, list, saveLive, create, update, setKeys, remove, checklist, switchTo, prefixUsed, cleanBusiness };
