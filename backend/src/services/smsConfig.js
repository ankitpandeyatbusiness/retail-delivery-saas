// Which sender, template and keys an SMS uses (N14).
// Own settings apply only to customer-facing SMS (otp, order). Bills and platform alerts always use the platform sender.
const Tenant = require('../models/Tenant');
const box = require('../utils/secretBox');

const OWN_PURPOSES = ['otp', 'order'];
const TTL_MS = 30 * 1000;
const cache = new Map();

async function getConfig(tenantId) {
    const id = String(tenantId);
    const hit = cache.get(id);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.cfg;
    const t = await Tenant.findById(id).select('+sms.own.providerKeysEnc').lean();
    const cfg = (t && t.sms) || {};
    cache.set(id, { at: Date.now(), cfg });
    return cfg;
}
const invalidate = (tenantId) => { if (tenantId) cache.delete(String(tenantId)); else cache.clear(); };

// own sender is used only when it is complete: switched on, sender, entity and keys saved
const ready = (cfg) => !!(cfg.own && cfg.own.enabled && cfg.own.senderId && cfg.own.entityId && cfg.own.providerKeysEnc);

// the wallet asks this BEFORE it takes money
async function usesOwn(tenantId, purpose) {
    if (!tenantId || !OWN_PURPOSES.includes(purpose)) return false;
    return ready(await getConfig(tenantId));
}

// the adapter asks this when it sends
async function resolve({ tenantId, purpose, templateKey }) {
    const cfg = tenantId ? await getConfig(tenantId) : {};
    if (tenantId && OWN_PURPOSES.includes(purpose) && ready(cfg)) {
        const ids = cfg.own.templateIds || {};
        return {
            own: true,
            senderId: cfg.own.senderId,
            entityId: cfg.own.entityId,
            authKey: box.decrypt(cfg.own.providerKeysEnc),
            templateId: ids[templateKey] || ids[purpose] || cfg.templateId || null,
        };
    }
    const envKey = templateKey ? process.env[`SMS_TEMPLATE_${String(templateKey).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`] : undefined;
    return {
        own: false,
        senderId: process.env.SMS_SENDER_ID,
        entityId: process.env.SMS_ENTITY_ID,
        authKey: process.env.SMS_AUTH_KEY,
        // the shop template wins, then a template for this message, then the platform default
        templateId: cfg.templateId || envKey || process.env.SMS_DEFAULT_TEMPLATE_ID || null,
    };
}

module.exports = { OWN_PURPOSES, getConfig, invalidate, usesOwn, resolve };