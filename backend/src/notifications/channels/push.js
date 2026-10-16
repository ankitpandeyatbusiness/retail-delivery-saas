// Push to the phones of one person, or of every owner of the shop.
// Returns { sent, tokens }: sent 0 means "nobody could be reached", so the next step (SMS) may start.
const DeviceToken = require('../../models/DeviceToken');
const User = require('../../models/User');
const adapter = require('../../services/adapters/push');

// channelId / sound: an Android notification channel the app created (the owner's loud "new_orders" channel).
// A phone that switched Soundbox off (loudAlerts false) does not get it: its push goes to the app's normal channel,
// so "off" means no loud new-order sound from that phone, on screen or off.
async function send({ tenantId, userId, title, body, data, channelId, sound }) {
    const userIds = userId
        ? [userId]
        : (await User.find({ tenantId, role: 'admin' }).select('_id').lean()).map((u) => u._id);
    if (!userIds.length) return { sent: 0, tokens: 0 };

    const rows = await DeviceToken.find({ tenantId, userId: { $in: userIds } }).select('token loudAlerts').lean();
    if (!rows.length) return { sent: 0, tokens: 0 };

    // [tokens, channel, sound]: loud phones get the loud channel, quiet phones get none (the app's default one)
    const groups = channelId
        ? [
            [rows.filter((r) => r.loudAlerts !== false).map((r) => r.token), channelId, sound],
            [rows.filter((r) => r.loudAlerts === false).map((r) => r.token), undefined, undefined],
        ]
        : [[rows.map((r) => r.token), undefined, undefined]];

    let sent = 0;
    const invalid = [];
    for (const [tokens, ch, snd] of groups) {
        if (!tokens.length) continue;
        const res = await adapter.send({ tokens, title, body, data, channelId: ch, sound: snd });
        sent += res?.sent || 0;
        if (res?.invalidTokens?.length) invalid.push(...res.invalidTokens);

        // A new order (loud phones only): besides the notification with the bundled clip, a second SILENT data message.
        // With the screen off it wakes the owner's app for a few seconds, which reads the order out with the phone's own
        // voice. It is an extra: if the phone does not allow it, the clip has already rung.
        // It is sent a moment AFTER the notification, so the voice follows the clip (3.5 s) and does not talk over it. The wait
        // is done here, on the server, on purpose: the phone's own timers stop while its screen is off, so a wait on the phone
        // only finished when the owner woke it. SPEECH_DELAY_MS=0 sends it at once.
        if (ch && data?.speech) {
            const silent = async () => {
                try {
                    await adapter.send({ tokens, dataOnly: true, data: { ...data, speakOnly: '1' } });
                } catch (e) { /* never let the extra message get in the way of the notification */ }
            };
            const wait = Number(process.env.SPEECH_DELAY_MS ?? 3600);
            if (wait > 0) setTimeout(silent, wait).unref?.();
            else await silent();
        }
    }
    if (invalid.length) await DeviceToken.deleteMany({ token: { $in: invalid } });
    return { sent, tokens: rows.length };
}

module.exports = { send };
