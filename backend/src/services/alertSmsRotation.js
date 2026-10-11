// Sends an alert SMS to the superadmin's phone and decides WHO pays for it.
//   1. Shops are charged in turns (round robin, by shop id). The turn moves on after each SMS.
//   2. A shop is skipped if it would fall below its low-balance level, if it is suspended, or paused for unpaid rent.
//   3. If no shop can pay, the PLATFORM pays: a PlatformSmsCost row records it, so the panel can show it.
//   4. If the SMS provider fails, the shop is refunded and nothing is recorded.
// Mock SMS mode (wallet not charged) only prints the SMS.
const Tenant = require('../models/Tenant');
const SmsWallet = require('../models/SmsWallet');
const PlatformSettings = require('../models/PlatformSettings');
const PlatformSmsCost = require('../models/PlatformSmsCost');
const wallet = require('./smsWalletService');
const smsAdapter = require('./adapters/sms');

const PURPOSE = 'platform_alert';
const moveCursor = (tenantId) => PlatformSettings.updateOne(
    { _id: 'main' }, { $set: { 'alerts.rrCursor': tenantId } }, { upsert: true, setDefaultsOnInsert: true },
);

async function send({ phone, text, eventKey, tenantId }) {
    try {
        if (!wallet.shouldCharge()) {
            await smsAdapter.send({ to: phone, text, purpose: PURPOSE, tenant: null });
            return { mode: 'mock' };
        }
        await wallet.loadPlatform();

        const platform = await PlatformSettings.findById('main').select('alerts.rrCursor').lean();
        const cursor = platform?.alerts?.rrCursor ? String(platform.alerts.rrCursor) : null;
        const wallets = await SmsWallet.find({ balancePaise: { $gt: 0 } }).sort({ tenantId: 1 }).select('tenantId').lean();
        const ids = wallets.map((w) => String(w.tenantId));
        const start = cursor ? ids.findIndex((id) => id > cursor) : 0;   // ids have the same length, so text order = id order
        const order = start === -1 ? ids : [...ids.slice(start), ...ids.slice(0, start)];

        for (const id of order) {
            const shop = await Tenant.findOne({ _id: id, status: { $ne: 'suspended' }, 'billing.state': { $ne: 'paused' } }).select('_id').lean();
            if (!shop) continue;
            const s = await wallet.status(id);
            if (s.balancePaise - s.ratePerSmsPaise < s.lowBalancePaise) continue;   // keep every shop above its low level

            const debit = await wallet.debitForSms(id, { purpose: PURPOSE });
            if (!debit.ok || !(debit.chargedPaise > 0)) continue;
            try {
                const r = await smsAdapter.send({ to: phone, text, purpose: PURPOSE, tenant: null });
                await wallet.logSms({
                    tenantId: id, phone, purpose: PURPOSE, debit,
                    status: process.env.SMS_MOCK === 'true' ? 'mock' : 'sent', providerMessageId: r?.providerMessageId,
                }).catch(() => { });
                await moveCursor(id);
                return { mode: 'shop', tenantId: id, chargedPaise: debit.chargedPaise };
            } catch (e) {
                await wallet.refund(debit.txnId).catch(() => { });   // the shop does not pay for an SMS that was not sent
                await wallet.logSms({ tenantId: id, phone, purpose: PURPOSE, debit, status: 'failed' }).catch(() => { });
                console.error('Alert SMS failed:', e.message);
                return { mode: 'failed', error: e.message };
            }
        }

        // nobody can pay: the platform pays
        try {
            await smsAdapter.send({ to: phone, text, purpose: PURPOSE, tenant: null });
        } catch (e) {
            console.error('Alert SMS failed:', e.message);
            return { mode: 'failed', error: e.message };
        }
        await PlatformSmsCost.create({
            eventKey, tenantId, costPaise: wallet.DEFAULTS.costPerSmsPaise, phoneMasked: wallet.mask(phone),
        });
        return { mode: 'platform' };
    } catch (e) {
        console.error('Alert SMS rotation error:', e.message);
        return { mode: 'failed', error: e.message };
    }
}

module.exports = { send };