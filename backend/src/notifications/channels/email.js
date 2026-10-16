// Turns an event into a mail and puts it in the queue. Never throws.
// Who gets it:  ctx.emailTo (a fixed list) > ctx.userId's email > the shop's billing email > the emails of the shop owners.
const Tenant = require('../../models/Tenant');
const User = require('../../models/User');
const PlatformSettings = require('../../models/PlatformSettings');
const email = require('../../services/adapters/email');
const emailQueue = require('../../services/emailQueue');
const registry = require('../templates/email');

const unique = (list) => [...new Set(list.map((e) => String(e).trim().toLowerCase()).filter(Boolean))];

async function recipients(ctx, tenant) {
    if (Array.isArray(ctx.emailTo) && ctx.emailTo.length) return unique(ctx.emailTo);
    if (ctx.userId) {
        const u = await User.findOne({ _id: ctx.userId, tenantId: tenant._id }).select('email').lean();
        return u?.email ? [u.email] : [];   // a customer without an email gets no mail
    }
    if (tenant.contact?.billingEmail) return [tenant.contact.billingEmail];
    const owners = await User.find({
        tenantId: tenant._id, role: 'admin', isBlocked: { $ne: true }, email: { $exists: true, $nin: [null, ''] },
    }).select('email').lean();
    return unique(owners.map((o) => o.email));
}

// the look of the mail: the platform's brand for bills, the shop's brand for mails to its customers
function baseCtx(tenant, platform, audience) {
    const biz = platform?.business || {};
    const brand = audience === 'shop'
        ? { name: tenant.name, color: tenant.colors?.primary, logoUrl: tenant.logo }
        : { name: biz.appName || biz.legalName || 'Platform', color: biz.brandColor, logoUrl: biz.logoUrl };
    return {
        brand,
        footer: { legalName: biz.legalName, address: biz.address, gstin: biz.gstin },
        support: { email: biz.email, phone: biz.phone },
        panelUrl: process.env.PANEL_URL || '',
    };
}

async function queue({ def, ctx }) {
    try {
        if (!def.email || !email.enabled()) return { queued: 0 };
        const entry = registry.get(def.email);
        if (!entry) return { queued: 0 };

        const [tenant, platform] = await Promise.all([
            Tenant.findById(ctx.tenantId).select('name logo colors contact').lean(),
            PlatformSettings.findById('main').lean(),
        ]);
        if (!tenant) return { queued: 0 };
        const to = await recipients(ctx, tenant);
        if (!to.length) return { queued: 0 };

        const vars = { shopName: tenant.name, ...(ctx.data || {}), ...(ctx.vars || {}) };
        const extra = entry.load ? await entry.load({ tenant, vars }) : {};
        if (entry.needs === 'invoice' && !extra.invoice) return { queued: 0 };

        const mail = entry.build({ ...vars, ...extra, ctx: baseCtx(tenant, platform, vars.audience || entry.audience) });
        for (const address of to) {
            await emailQueue.enqueue({
                tenantId: tenant._id, to: address, subject: mail.subject, html: mail.html, text: mail.text,
                attachments: extra.attachments, priority: entry.priority || 2, kind: def.email,
            });
        }
        return { queued: to.length };
    } catch (e) {
        console.error(`Email channel (${def?.email}) error:`, e.message);
        return { queued: 0, error: true };
    }
}

// One mail to one address, not tied to an event (e.g. the verification code). -> { queued: 0 | 1 }
async function sendDirect({ tenantId, to, key, vars = {} }) {
    try {
        if (!email.enabled()) return { queued: 0 };
        const entry = registry.get(key);
        if (!entry) return { queued: 0 };
        const [tenant, platform] = await Promise.all([
            Tenant.findById(tenantId).select('name logo colors contact').lean(),
            PlatformSettings.findById('main').lean(),
        ]);
        if (!tenant) return { queued: 0 };
        const all = { shopName: tenant.name, ...vars };
        const extra = entry.load ? await entry.load({ tenant, vars: all }) : {};
        const mail = entry.build({ ...all, ...extra, ctx: baseCtx(tenant, platform, entry.audience) });
        const job = await emailQueue.enqueue({
            tenantId: tenant._id, to, subject: mail.subject, html: mail.html, text: mail.text,
            attachments: extra.attachments, priority: entry.priority || 2, kind: key,
        });
        return { queued: job ? 1 : 0 };
    } catch (e) {
        console.error(`Email channel direct (${key}) error:`, e.message);
        return { queued: 0, error: true };
    }
}

module.exports = { queue, sendDirect };