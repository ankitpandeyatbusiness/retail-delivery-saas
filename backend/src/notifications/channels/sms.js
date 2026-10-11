// A key-event SMS, paid from the shop's SMS wallet at the normal price.
// Returns { sent } (true if at least one SMS went out). It never throws.
const Tenant = require('../../models/Tenant');
const User = require('../../models/User');
const wallet = require('../../services/smsWalletService');
const smsAdapter = require('../../services/adapters/sms');
const smsTemplates = require('../templates/sms');

async function phonesFor(ctx) {
    if (ctx.userId) {
        const u = await User.findOne({ _id: ctx.userId, tenantId: ctx.tenantId }).select('phone isBlocked').lean();
        return u && !u.isBlocked ? [u.phone] : [];
    }
    const owners = await User.find({ tenantId: ctx.tenantId, role: 'admin', isBlocked: { $ne: true } }).select('phone').lean();
    return owners.map((o) => o.phone);
}

async function send({ eventKey, ctx }) {
    try {
        const tenant = await Tenant.findById(ctx.tenantId).select('name settings.notifications').lean();
        if (!tenant) return { sent: false, reason: 'no_shop' };
        // the owner's switch: off = no key-event SMS for the owner and the customers of this shop
        if (tenant.settings?.notifications?.smsAlerts === false) return { sent: false, reason: 'switched_off' };

        const tpl = smsTemplates.build(eventKey, { ...(ctx.data || {}), ...(ctx.vars || {}), shop: tenant.name });
        if (!tpl) return { sent: false, reason: 'no_template' };

        const phones = await phonesFor(ctx);
        let sent = 0;
        for (const phone of phones) {
            const debit = await wallet.debitForSms(ctx.tenantId, { purpose: tpl.purpose });
            if (!debit.ok) continue;   // no balance: no SMS
            try {
                const r = await smsAdapter.send({ to: phone, text: tpl.text, purpose: tpl.purpose, tenant, templateKey: tpl.key });
                await wallet.logSms({
                    tenantId: ctx.tenantId, phone, purpose: tpl.purpose, debit,
                    status: process.env.SMS_MOCK === 'true' ? 'mock' : 'sent', providerMessageId: r?.providerMessageId,
                }).catch(() => { });
                sent += 1;
            } catch (e) {
                console.error(`SMS (${eventKey}) failed:`, e.message);
                await wallet.refund(debit.txnId).catch(() => { });   // the shop does not pay for a failed SMS
                await wallet.logSms({ tenantId: ctx.tenantId, phone, purpose: tpl.purpose, debit, status: 'failed' }).catch(() => { });
            }
        }
        return { sent: sent > 0 };
    } catch (e) {
        console.error('SMS channel error:', e.message);
        return { sent: false, reason: 'error' };
    }
}

module.exports = { send };