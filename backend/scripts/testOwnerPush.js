// Sends a shop owner's phone a REAL new-order alert without placing an order. For checking a phone, a build or the
// server's push setup. It goes through the same code a real order uses (the loud channel, the "New order received" clip,
// the silent message that lets the app read the order out), and sends nothing else: no order, no inbox row, no SMS.
//
//   node scripts/testOwnerPush.js savera              every owner phone of the shop
//   node scripts/testOwnerPush.js savera 6498         only the owner whose phone number ends in 6498
//   node scripts/testOwnerPush.js savera --dry        show which phones would get it, send nothing
//
// Run it from the backend folder. It stays about 6 seconds, because the silent "read the order" message is sent a few
// seconds after the notification (see docs/owner-soundbox.md). Lock the phone first to test the screen-off behaviour.
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/database/database');
const Tenant = require('../src/models/Tenant');
const User = require('../src/models/User');
const DeviceToken = require('../src/models/DeviceToken');
const pushChannel = require('../src/notifications/channels/push');
const { NEW_ORDER_CHANNEL } = require('../src/notifications/events');
const { orderSpeech, orderSpeechHi } = require('../src/utils/orderSpeech');

const SAMPLE = {
    orderType: 'delivery', pricing: { total: 540 }, payment: { method: 'cod' },
    items: [
        { name: 'Butter Naan', quantity: 2 }, { name: 'Laccha Paratha', quantity: 1 },
        { name: 'Paneer Butter Masala', quantity: 1, selections: [{ name: 'Full' }] },
    ],
};

(async () => {
    const args = process.argv.slice(2);
    const dry = args.includes('--dry');
    const [slug, last4] = args.filter((a) => !a.startsWith('--'));
    if (!slug) { console.error('Usage: node scripts/testOwnerPush.js <shop-slug> [last 4 digits of the owner phone] [--dry]'); process.exit(1); }

    await connectDB();
    const tenant = await Tenant.findOne({ slug: slug.toLowerCase() }).select('_id name').lean();
    if (!tenant) throw new Error(`No shop with the slug "${slug}"`);

    let owners = await User.find({ tenantId: tenant._id, role: 'admin' }).select('_id phone').lean();
    if (last4) owners = owners.filter((o) => String(o.phone).endsWith(last4));
    if (!owners.length) throw new Error('No owner found' + (last4 ? ` with a phone ending in ${last4}` : ''));

    for (const o of owners) {
        const phones = await DeviceToken.find({ tenantId: tenant._id, userId: o._id }).select('loudAlerts lastSeenAt').lean();
        console.log(`Owner ...${String(o.phone).slice(-4)}: ${phones.length} phone(s)` +
            phones.map((p) => ` [Soundbox ${p.loudAlerts === false ? 'OFF' : 'on'}, seen ${new Date(p.lastSeenAt).toLocaleString('en-IN')}]`).join(''));
        if (!phones.length) console.log('   (this owner has not opened the app yet, so there is nowhere to send)');
    }
    if (dry) { console.log('Dry run: nothing sent.'); return; }

    for (const o of owners) {
        const r = await pushChannel.send({
            tenantId: tenant._id,
            userId: o._id,
            title: 'New order (test)',
            body: 'This is a test of your new-order alert',
            data: { type: 'order_new', test: '1', orderNo: 'TEST', speech: orderSpeech(SAMPLE), speechHi: orderSpeechHi(SAMPLE) },
            channelId: NEW_ORDER_CHANNEL,
            sound: 'new_order',
        });
        console.log(`Owner ...${String(o.phone).slice(-4)}: notification sent to ${r.sent} of ${r.tokens} phone(s)`);
    }
    const wait = Number(process.env.SPEECH_DELAY_MS ?? 3600) + 2500;
    console.log(`Waiting ${Math.round(wait / 1000)} s for the silent "read the order" message...`);
    await new Promise((res) => setTimeout(res, wait));
    console.log('Done.');
})()
    .catch((e) => { console.error('Failed:', e.message); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
