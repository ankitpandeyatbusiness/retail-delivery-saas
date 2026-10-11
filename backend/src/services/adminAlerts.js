// Alerts to the superadmin (the platform owner).  alert(eventKey, { tenantId, vars, data })
//   - always saved in his inbox (role superadmin)
//   - pushed to all his phones (AdminDevice)
//   - an SMS to his phone ONLY if he switched it on (PlatformSettings.alerts.smsToAdmin) and the alert is critical
//     (or alerts.allEvents is on). Who pays for that SMS: alertSmsRotation.
// The rules in the database can switch an alert off or change its channels (event keys start with admin_).
// It never throws.
const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const Notification = require('../models/Notification');
const AdminDevice = require('../models/AdminDevice');
const PlatformSettings = require('../models/PlatformSettings');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const rules = require('../notifications/rules');
const adminTexts = require('../notifications/templates/adminTexts');
const pushAdapter = require('./adapters/push');
const alertSmsRotation = require('./alertSmsRotation');

const day = (d) => new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });

// invoice number, amount and dates from the ids in `data`, so the callers do not have to send them
async function extraVars(tenantId, data) {
    const out = {};
    if (Number.isInteger(data?.amountPaise)) out.amount = (data.amountPaise / 100).toFixed(2);
    if (data?.invoiceId && mongoose.isValidObjectId(String(data.invoiceId))) {
        const inv = await SubscriptionInvoice
            .findOne({ _id: data.invoiceId, ...(tenantId && { tenantId }) }).select('invoiceNo total graceEndsAt').lean();
        if (inv) {
            out.invoiceNo = inv.invoiceNo;
            out.amount = String(inv.total);
            if (inv.graceEndsAt) out.graceDate = day(inv.graceEndsAt);
        }
    }
    return out;
}

async function pushToAdmins({ title, body, data }) {
    const rows = await AdminDevice.find({}).select('token').lean();
    const tokens = rows.map((r) => r.token);
    if (!tokens.length) return { sent: 0 };
    const res = await pushAdapter.send({ tokens, title, body, data });
    if (res?.invalidTokens?.length) await AdminDevice.deleteMany({ token: { $in: res.invalidTokens } });
    return { sent: res?.sent || 0 };
}

async function alert(eventKey, { tenantId, vars = {}, data = {} } = {}) {
    try {
        const def = await rules.get(eventKey, null);
        if (def.enabled === false) return null;

        const tenant = tenantId ? await Tenant.findById(tenantId).select('name slug').lean() : null;
        const extra = await extraVars(tenantId, data);
        const v = { shop: tenant?.name || 'A shop', ...data, ...extra, ...vars };
        const text = adminTexts.build(eventKey, v);
        if (!text) return null;

        const channels = def.channels || [];
        const doc = await Notification.create({
            tenantId: tenantId || undefined,
            role: 'superadmin',
            type: eventKey,
            title: text.title.slice(0, 120),
            body: text.body.slice(0, 300),
            data: { ...data, shopName: tenant?.name, shopSlug: tenant?.slug },
        });

        if (channels.includes('push')) {
            try {
                await pushToAdmins({
                    title: doc.title, body: doc.body, data: { type: eventKey, ...(tenantId && { tenantId: String(tenantId) }) },
                });
            } catch (e) {
                console.error('Admin push error:', e.message);
            }
        }

        if (channels.includes('sms')) {
            try {
                const platform = await PlatformSettings.findById('main').select('alerts').lean();
                const a = platform?.alerts || {};
                if (a.smsToAdmin && a.phone && (def.critical || a.allEvents)) {
                    await alertSmsRotation.send({
                        phone: a.phone, text: `Platform alert: ${text.sms}. Open your panel for details.`, eventKey, tenantId,
                    });
                }
            } catch (e) {
                console.error('Admin SMS error:', e.message);
            }
        }
        return doc;
    } catch (e) {
        console.error(`Admin alert (${eventKey}) error:`, e.message);
        return null;
    }
}

module.exports = { alert };