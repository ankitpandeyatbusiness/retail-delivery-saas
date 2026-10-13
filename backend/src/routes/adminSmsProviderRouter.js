// Superadmin: a shop's SMS sender settings. The keys can be set, never read back.
//   GET /tenants/:tid/sms-provider
//   PUT /tenants/:tid/sms-provider   { templateId?, own?: { enabled?, senderId?, entityId?, templateIds?, authKey? } }
const express = require('express');
const apiErrors = require('../middlewares/apiErrors');
const loadTenant = require('../middlewares/loadTenant');
const Tenant = require('../models/Tenant');
const box = require('../utils/secretBox');
const smsConfig = require('../services/smsConfig');

const { wrap, httpError } = apiErrors;
const router = express.Router();
const sub = express.Router({ mergeParams: true });
router.use('/tenants/:tid/sms-provider', loadTenant, sub);

const DIGITS = /^\d{10,25}$/;          // DLT entity and template ids
const SENDER = /^[A-Za-z]{6}$/;        // DLT header (sender id): 6 letters
const KEY = /^[a-z0-9_]{1,40}$/;       // template key, like otp or order_new

const load = (id) => Tenant.findById(id).select('+sms.own.providerKeysEnc').lean();
const view = (t) => {
    const s = t.sms || {};
    const o = s.own || {};
    return {
        templateId: s.templateId || null,
        own: {
            enabled: !!o.enabled,
            senderId: o.senderId || null,
            entityId: o.entityId || null,
            templateIds: o.templateIds || {},
            hasKeys: !!o.providerKeysEnc,       // only yes/no, the key is never returned
        },
    };
};

sub.get('/', wrap(async (req, res) => {
    res.json(view(await load(req.tenantDoc._id)));
}));

sub.put('/', wrap(async (req, res) => {
    const b = req.body || {};
    const own = b.own === undefined ? {} : b.own;
    if (!own || typeof own !== 'object' || Array.isArray(own)) throw httpError(400, 'own must be an object');
    const authKey = own.authKey;
    // keep the secret out of the audit log
    delete req.body.authKey;
    if (req.body.own) delete req.body.own.authKey;

    const cur = await load(req.tenantDoc._id);
    req.auditBefore = view(cur);
    const curOwn = (cur.sms && cur.sms.own) || {};
    const set = {};

    if (b.templateId !== undefined) {
        if (b.templateId !== null && b.templateId !== '' && !DIGITS.test(String(b.templateId))) throw httpError(400, 'templateId must be the DLT template number');
        set['sms.templateId'] = b.templateId ? String(b.templateId) : null;
    }
    if (own.enabled !== undefined) {
        if (typeof own.enabled !== 'boolean') throw httpError(400, 'enabled must be true or false');
        set['sms.own.enabled'] = own.enabled;
    }
    if (own.senderId !== undefined) {
        if (own.senderId !== null && !SENDER.test(String(own.senderId))) throw httpError(400, 'senderId must be 6 letters');
        set['sms.own.senderId'] = own.senderId ? String(own.senderId).toUpperCase() : null;
    }
    if (own.entityId !== undefined) {
        if (own.entityId !== null && !DIGITS.test(String(own.entityId))) throw httpError(400, 'entityId must be the DLT entity number');
        set['sms.own.entityId'] = own.entityId ? String(own.entityId) : null;
    }
    if (own.templateIds !== undefined) {
        const t = own.templateIds;
        if (!t || typeof t !== 'object' || Array.isArray(t) || Object.keys(t).length > 30) throw httpError(400, 'templateIds must be an object with up to 30 templates');
        for (const [k, v] of Object.entries(t)) {
            if (!KEY.test(k) || !DIGITS.test(String(v))) throw httpError(400, `Bad template: ${k}`);
        }
        set['sms.own.templateIds'] = t;
    }
    if (authKey !== undefined) {
        if (authKey === null) {
            set['sms.own.providerKeysEnc'] = null;
        } else {
            if (typeof authKey !== 'string' || authKey.length < 8 || authKey.length > 200) throw httpError(400, 'authKey looks wrong');
            try {
                set['sms.own.providerKeysEnc'] = box.encrypt(authKey);
            } catch (e) {
                throw httpError(500, 'The server cannot keep secrets (SECRETS_KEY is not set)');
            }
        }
    }
    if (!Object.keys(set).length) throw httpError(400, 'Nothing to update');

    // the result must be complete if it is switched on
    const next = {
        enabled: set['sms.own.enabled'] ?? curOwn.enabled,
        senderId: 'sms.own.senderId' in set ? set['sms.own.senderId'] : curOwn.senderId,
        entityId: 'sms.own.entityId' in set ? set['sms.own.entityId'] : curOwn.entityId,
        hasKey: 'sms.own.providerKeysEnc' in set ? !!set['sms.own.providerKeysEnc'] : !!curOwn.providerKeysEnc,
        templates: Object.keys(set['sms.own.templateIds'] || curOwn.templateIds || {}).length
            + (('sms.templateId' in set ? set['sms.templateId'] : cur.sms && cur.sms.templateId) ? 1 : 0),
    };
    if (next.enabled && !(next.senderId && next.entityId && next.hasKey && next.templates)) {
        throw httpError(400, 'To use the shop own SMS, save the sender id, entity id, keys and at least one template first');
    }

    await Tenant.updateOne({ _id: req.tenantDoc._id }, { $set: set });
    smsConfig.invalidate(req.tenantDoc._id);
    res.json(view(await load(req.tenantDoc._id)));
}));

module.exports = router;