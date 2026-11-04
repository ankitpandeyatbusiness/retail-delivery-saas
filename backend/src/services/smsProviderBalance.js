// How much SMS money is left in YOUR account at the SMS provider (MSG91), so a login OTP never fails because it ran dry.
//   1. Asked from the provider every 30 minutes (the balance call; the address can be changed with SMS_BALANCE_URL).
//   2. If the provider cannot be asked, an ESTIMATE: what you last told us you had ("I added Rs 2000 on this day") minus what the SMS sent since cost you.
//   3. Two lines you set: LOW (warn) and RESERVE (almost empty). Below the reserve, every SMS except login OTPs and your own alerts is paused,
//      so the last credits go to OTPs. Shops that use their OWN provider account are never touched.
// Kept in PlatformSettings.smsProvider.
const PlatformSettings = require('../models/PlatformSettings');
const SmsLog = require('../models/SmsLog');
const { httpError } = require('../middlewares/apiErrors');

const DEFAULTS = { lowPaise: 50000, reservePaise: 10000, unit: 'rupees', protectOtp: true };
const PROTECTED = ['otp', 'platform_alert'];   // purposes that keep going when the balance is almost empty
const FRESH_MS = 3 * 3600 * 1000;
const REALERT_MS = 6 * 3600 * 1000;

const settingsOf = (row) => ({ ...DEFAULTS, ...Object.fromEntries(Object.entries(row?.smsProvider || {}).filter(([k]) => k in DEFAULTS)) });

async function load() {
    const row = await PlatformSettings.findById('main').select('smsProvider sms.costPerSmsPaise').lean();
    return { row, s: settingsOf(row), sp: row?.smsProvider || {}, costPerSms: row?.sms?.costPerSmsPaise ?? 20 };
}

// the provider's answer: a plain number ("1234.50") or JSON with balance / credits / data.balance
function parseBalance(text) {
    const t = String(text || '').trim();
    if (!t) throw new Error('Empty answer');
    let n = Number(t);
    if (!Number.isFinite(n)) {
        try {
            const j = JSON.parse(t);
            const v = j.balance ?? j.credits ?? j.data?.balance ?? j.data?.credits ?? j.result?.balance;
            n = Number(v);
        } catch (e) { n = NaN; }
    }
    if (!Number.isFinite(n) || n < 0) throw new Error(`Could not read a balance from: ${t.slice(0, 80)}`);
    return n;
}

async function fetchFromProvider() {
    const key = (await require('./smsPlatformSetup').effective()).authKey;
    if (!key) throw new Error('No SMS auth key yet. Save it in SMS and DLT setup');
    const url = (process.env.SMS_BALANCE_URL || 'https://control.msg91.com/api/balance.php?authkey={authkey}&type=4').replace('{authkey}', encodeURIComponent(key));
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const text = (await res.text()).trim();
    if (!res.ok) throw new Error(`The provider answered ${res.status}: ${text.slice(0, 80)}`);
    return { value: parseBalance(text), raw: text.slice(0, 80) };
}

// the best number we have right now: { paise, source: 'provider' | 'estimate' | null, at, level: ok | low | empty | unknown }
async function current(now = Date.now()) {
    const { s, sp, costPerSms } = await load();
    let paise = null; let source = null; let at = null;
    if (sp.balance?.ok && sp.balance.at && now - new Date(sp.balance.at).getTime() < FRESH_MS) {
        paise = sp.balance.paise; source = 'provider'; at = sp.balance.at;
    } else if (sp.manual?.at) {
        const used = await SmsLog.aggregate([{ $match: { status: 'sent', own: { $ne: true }, createdAt: { $gte: new Date(sp.manual.at) } } }, { $group: { _id: null, c: { $sum: '$costPaise' } } }]);
        paise = Math.max(0, sp.manual.paise - (used[0]?.c || 0)); source = 'estimate'; at = sp.manual.at;
    }
    const level = paise === null ? 'unknown' : paise <= s.reservePaise ? 'empty' : paise <= s.lowPaise ? 'low' : 'ok';
    return { paise, source, at, level, ...s, costPerSmsPaise: costPerSms, lastCheck: sp.balance || null, manual: sp.manual || null };
}

// ask the provider, keep the answer, and tell the superadmin when it crosses a line (once per change, then every 6 hours while it is empty)
async function check({ now = Date.now() } = {}) {
    if (process.env.SMS_MOCK === 'true') return { skipped: 'mock' };
    const { s, sp, costPerSms } = await load();
    let result;
    try {
        const { value, raw } = await fetchFromProvider();
        const paise = s.unit === 'sms' ? Math.round(value * costPerSms) : Math.round(value * 100);
        result = { ok: true, paise, raw, at: new Date(now) };
    } catch (e) {
        result = { ok: false, error: String(e.message).slice(0, 160), at: new Date(now), paise: sp.balance?.paise };
    }
    await PlatformSettings.updateOne({ _id: 'main' }, { $set: { 'smsProvider.balance': result } }, { upsert: true });
    const cur = await current(now);
    await alertIfNeeded(cur, now);
    return { ...result, level: cur.level, source: cur.source };
}

async function alertIfNeeded(cur, now = Date.now()) {
    const level = cur.level;
    if (level === 'unknown') return false;
    const sp = (await PlatformSettings.findById('main').select('smsProvider.alertedLevel smsProvider.alertedAt').lean())?.smsProvider || {};
    const prev = sp.alertedLevel || 'ok';
    const rank = { ok: 0, low: 1, empty: 2 };
    const worse = rank[level] > rank[prev];
    const again = level === 'empty' && prev === 'empty' && sp.alertedAt && now - new Date(sp.alertedAt).getTime() > REALERT_MS;
    if (level === 'ok' || !(worse || again)) {
        if (level === 'ok' && prev !== 'ok') await PlatformSettings.updateOne({ _id: 'main' }, { $set: { 'smsProvider.alertedLevel': 'ok' } });
        return false;
    }
    // claim the right to alert in one update, so two servers do not both send
    const r = await PlatformSettings.updateOne(
        { _id: 'main', $or: [{ 'smsProvider.alertedLevel': { $ne: level } }, { 'smsProvider.alertedAt': { $lte: new Date(now - REALERT_MS) } }] },
        { $set: { 'smsProvider.alertedLevel': level, 'smsProvider.alertedAt': new Date(now) } },
    );
    if (!r.modifiedCount) return false;
    await require('./adminAlerts').alert(level === 'empty' ? 'admin_sms_provider_empty' : 'admin_sms_provider_low', {
        vars: { amount: '₹' + Math.round((cur.paise || 0) / 100).toLocaleString('en-IN'), estimate: cur.source === 'estimate', reserve: '₹' + Math.round(cur.reservePaise / 100), protectOtp: cur.protectOtp },
        data: { kind: 'sms_balance' },
    });
    return true;
}

// "I added Rs 2000 to MSG91": the new starting point of the estimate
async function added(amountPaise, now = Date.now()) {
    if (!Number.isInteger(amountPaise) || amountPaise < 0 || amountPaise > 100000000) throw httpError(400, 'Enter the balance in whole rupees');
    await PlatformSettings.updateOne({ _id: 'main' }, { $set: { 'smsProvider.manual': { paise: amountPaise, at: new Date(now) } } }, { upsert: true });
    return current(now);
}

async function saveSettings(body) {
    const b = body || {};
    const set = {};
    if (b.lowPaise !== undefined) { if (!Number.isInteger(b.lowPaise) || b.lowPaise < 0) throw httpError(400, 'The low line must be a whole number of rupees'); set['smsProvider.lowPaise'] = b.lowPaise; }
    if (b.reservePaise !== undefined) { if (!Number.isInteger(b.reservePaise) || b.reservePaise < 0) throw httpError(400, 'The reserve line must be a whole number of rupees'); set['smsProvider.reservePaise'] = b.reservePaise; }
    if (b.unit !== undefined) { if (!['rupees', 'sms'].includes(b.unit)) throw httpError(400, 'unit must be rupees or sms'); set['smsProvider.unit'] = b.unit; }
    if (b.protectOtp !== undefined) { if (typeof b.protectOtp !== 'boolean') throw httpError(400, 'protectOtp must be true or false'); set['smsProvider.protectOtp'] = b.protectOtp; }
    if (!Object.keys(set).length) throw httpError(400, 'Nothing to change');
    const { s } = await load();
    const low = set['smsProvider.lowPaise'] ?? s.lowPaise;
    const reserve = set['smsProvider.reservePaise'] ?? s.reservePaise;
    if (reserve > low) throw httpError(400, 'The reserve line must be lower than the low line');
    await PlatformSettings.updateOne({ _id: 'main' }, { $set: set }, { upsert: true });
    cache = null;
    return current();
}

// the SMS adapter asks this before every send: is the balance almost empty, so only OTPs and your own alerts may go? (cached for a minute)
let cache = null;
async function pauseFor(purpose) {
    if (PROTECTED.includes(purpose)) return false;
    if (!cache || Date.now() - cache.at > 60000) {
        let on = false;
        try { const c = await current(); on = c.protectOtp && c.level === 'empty'; } catch (e) { on = false; }
        cache = { at: Date.now(), on };
    }
    return cache.on;
}
const resetCache = () => { cache = null; };

function startSmsBalanceScheduler() {
    const run = () => check().then((r) => { if (r && r.ok === false) console.error('SMS balance check:', r.error); }).catch((e) => console.error('SMS balance error:', e.message));
    setTimeout(run, 90 * 1000).unref?.();
    setInterval(run, 30 * 60 * 1000).unref?.();
}

module.exports = { current, check, added, saveSettings, pauseFor, resetCache, parseBalance, alertIfNeeded, startSmsBalanceScheduler, DEFAULTS, PROTECTED };
