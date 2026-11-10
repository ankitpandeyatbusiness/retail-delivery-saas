// Push to the phones of one person, or of every owner of the shop.
// Returns { sent, tokens }: sent 0 means "nobody could be reached", so the next step (SMS) may start.
const DeviceToken = require('../../models/DeviceToken');
const User = require('../../models/User');
const adapter = require('../../services/adapters/push');
const webAdapter = require('../../services/adapters/webPush');
const Tenant = require('../../models/Tenant');
const { brandingIcon } = require('../../services/tenantConfigService');
const alertGroups = require('../alertGroups');
const i18n = require('../i18n');
const brandNotify = require('../../services/brandNotify');

// channelId / sound: an Android notification channel the app created (the owner's loud "new_orders" channel).
// A phone that switched Soundbox off (loudAlerts false) does not get it: its push goes to the app's normal channel,
// so "off" means no loud new-order sound from that phone, on screen or off.
// tag: a later push with the same tag REPLACES the earlier one on the lock screen (the live-delivery update).
// quietChannel: send everything on that channel (a silent one) instead of the loud/normal split.
async function send({ tenantId, userId, title, body, data, channelId, sound, tag, quietChannel }) {
    const userIds = userId
        ? [userId]
        : (await User.find({ tenantId, role: 'admin' }).select('_id').lean()).map((u) => u._id);
    if (!userIds.length) return { sent: 0, tokens: 0 };

    let rows = await DeviceToken.find({ tenantId, userId: { $in: userIds } }).select('token loudAlerts userId platform webKeys').lean();
    // each person's own choices for this kind of alert (Alerts screen): off = nothing reaches the phone; sound off = a silent push, no voice
    const quiet = new Set();
    if (data?.type) {
        const people = await User.find({ _id: { $in: userIds } }).select('role alertPrefs').lean();
        const mute = new Set();
        for (const u of people) {
            const grp = alertGroups.groupOf(u.role, data.type);
            if (!grp) continue;
            const p = alertGroups.prefOf(u.alertPrefs, grp);
            if (!p.n) mute.add(String(u._id)); else if (!p.s && grp.can.s) quiet.add(String(u._id));
        }
        if (mute.size) rows = rows.filter((r) => !mute.has(String(r.userId)));
    }
    // a BRAND OWNER hears only the branches he chose (services/brandNotify.js), and every alert of his names its branch
    const gate = await brandNotify.gate({ tenantId, userIds, type: data && data.type });
    if (gate.drop.size) rows = rows.filter((r) => !gate.drop.has(String(r.userId)));
    // BROWSERS are kept apart: a browser's address is not a phone token (the phone sender would throw it away as invalid).
    // The phone app has priority: a browser is only told when the person switched on "Also notify me on this browser", or has no phone at all.
    const webAll = rows.filter((r) => r.platform === 'web');
    rows = rows.filter((r) => r.platform !== 'web');
    const webRows = await eligibleBrowsers(webAll, rows);
    if (!rows.length && !webRows.length) return { sent: 0, tokens: 0 };
    const labelOf = new Map(rows.map((r) => [r.token, gate.label.get(String(r.userId)) || '']));

    // [tokens, channel, sound]: loud phones get the loud channel, quiet phones get none (the app's default one)
    const calm = rows.filter((r) => quiet.has(String(r.userId)));   // chose "no sound" for this alert
    const heard = rows.filter((r) => !quiet.has(String(r.userId)));
    const groups = quietChannel
        ? [[rows.map((r) => r.token), quietChannel, undefined]]
        : channelId
        ? [
            [heard.filter((r) => r.loudAlerts !== false).map((r) => r.token), channelId, sound],
            [heard.filter((r) => r.loudAlerts === false).map((r) => r.token), undefined, undefined],
            [calm.map((r) => r.token), 'live_trip', undefined, false],
        ]
        : [[heard.map((r) => r.token), undefined, undefined], [calm.map((r) => r.token), 'live_trip', undefined, false]];

    // each phone gets the push in its person's language (User.language, set from the app); English when not set
    const langOf = new Map((await User.find({ _id: { $in: [...new Set(rows.map((r) => String(r.userId)))] } }).select('language').lean())
        .map((u) => [String(u._id), u.language || 'en']));
    const tokenLang = new Map(rows.map((r) => [r.token, langOf.get(String(r.userId)) || 'en']));

    let sent = 0;
    const invalid = [];
    for (const [tokens, ch, snd] of groups) {
        if (!tokens.length) continue;
        const byLang = new Map();   // language + branch label: a brand owner's alert is worded with the branch in front
        for (const t of tokens) { const k = `${tokenLang.get(t) || 'en'}|${labelOf.get(t) || ''}`; if (!byLang.has(k)) byLang.set(k, []); byLang.get(k).push(t); }
        for (const [key, list] of byLang) {
            const sep = key.indexOf('|');
            const lang = key.slice(0, sep);
            const label = key.slice(sep + 1);
            const heading = label ? `${label} · ${i18n.translate(title, lang)}` : i18n.translate(title, lang);
            const extra = label ? { ...(data || {}), branch: label, ...(data && data.speech ? { speech: `${label}. ${data.speech}` } : {}), ...(data && data.speechHi ? { speechHi: `${label}. ${data.speechHi}` } : {}) } : data;
            const res = await adapter.send({ tokens: list, title: heading, body: i18n.translate(body, lang), data: extra, channelId: ch, sound: snd, tag });
            sent += res?.sent || 0;
            if (res?.invalidTokens?.length) invalid.push(...res.invalidTokens);
        }
    }
    if (invalid.length) await DeviceToken.deleteMany({ token: { $in: invalid } });

    let webCount = 0;
    if (webRows.length) {
        const w = await sendToBrowsers({ tenantId, webRows, title, body, data, tag, quiet });
        sent += w.sent; webCount = webRows.length;
    }
    return { sent, tokens: rows.length + webCount };
}

// the browsers that should hear this: a subscription with keys, whose person switched the browser on, or who has no phone
async function eligibleBrowsers(webAll, phoneRows) {
    if (!webAll.length) return [];
    const hasPhone = new Set(phoneRows.map((r) => String(r.userId)));
    const people = await User.find({ _id: { $in: [...new Set(webAll.map((r) => String(r.userId)))] } }).select('alsoWebPush language').lean();
    const info = new Map(people.map((u) => [String(u._id), u]));
    return webAll.filter((r) => r.webKeys && r.webKeys.p256dh && r.webKeys.auth
        && (hasPhone.has(String(r.userId)) ? !!(info.get(String(r.userId)) || {}).alsoWebPush : true))
        .map((r) => ({ ...r, lang: (info.get(String(r.userId)) || {}).language || 'en' }));
}

async function sendToBrowsers({ tenantId, webRows, title, body, data, tag, quiet }) {
    const tenant = await Tenant.findById(tenantId).select('slug logo').lean();
    const icon = (tenant && (brandingIcon(tenant.slug) || tenant.logo)) || undefined;
    const byLang = new Map();
    for (const r of webRows) { const k = r.lang + (quiet.has(String(r.userId)) ? '|quiet' : '|loud'); if (!byLang.has(k)) byLang.set(k, []); byLang.get(k).push(r); }
    let sent = 0;
    const gone = [];
    for (const [k, list] of byLang) {
        const lang = k.split('|')[0];
        const res = await webAdapter.send({
            subscriptions: list.map((r) => ({ endpoint: r.token, keys: r.webKeys })),
            title: i18n.translate(title, lang), body: i18n.translate(body, lang), data, tag, icon, silent: k.endsWith('|quiet'),
        });
        sent += res.sent || 0;
        if (res.invalidEndpoints && res.invalidEndpoints.length) gone.push(...res.invalidEndpoints);
    }
    if (gone.length) await DeviceToken.deleteMany({ token: { $in: gone }, platform: 'web' });
    return { sent };
}

module.exports = { send };
