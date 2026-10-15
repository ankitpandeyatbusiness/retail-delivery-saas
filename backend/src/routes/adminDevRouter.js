// Superadmin: "Development details" of one shop. Everything a developer needs to know about that shop's app
// in one answer. Read only (apart from the free-text notes), and never any secret: keys are masked, secrets are yes/no.
//   GET /tenants/:tid/dev-details
//   PUT /tenants/:tid/dev-notes   { notes }
const express = require('express');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const Product = require('../models/Product');
const Category = require('../models/Category');
const Order = require('../models/Order');
const Rider = require('../models/Rider');
const Media = require('../models/Media');
const Session = require('../models/Session');
const DeviceToken = require('../models/DeviceToken');
const SmsLog = require('../models/SmsLog');
const SmsWallet = require('../models/SmsWallet');
const AppVersionSeen = require('../models/AppVersionSeen');
const loadTenant = require('../middlewares/loadTenant');
const { wrap, httpError } = require('../middlewares/apiErrors');
const accounts = require('../services/paymentAccounts');
const payments = require('../services/adapters/payments');
const { resolveConfig } = require('../services/tenantConfigService');
const { shopState } = require('../utils/shopState');

const router = express.Router();

const base = (req) => (process.env.PUBLIC_BASE_URL
    ? process.env.PUBLIC_BASE_URL.replace(/\/+$/, '')
    : `${req.protocol}://${req.get('host')}`);
const mask = (v) => {
    const s = String(v || '');
    if (!s) return null;
    if (s.length <= 8) return `${s.slice(0, 2)}••••`;
    return `${s.slice(0, 6)}••••${s.slice(-3)}`;
};
const yes = (v) => !!v;

router.get('/tenants/:tid/dev-details', loadTenant, wrap(async (req, res) => {
    const id = req.tenantDoc._id;
    const t = await Tenant.findById(id).select('+sms.own.providerKeysEnc').lean();
    if (!t) throw httpError(404, 'Tenant not found');
    const slug = t.slug;
    const cfg = resolveConfig(t);
    const cdn = (process.env.MEDIA_CDN_URL || '').replace(/\/+$/, '');
    const day30 = new Date(Date.now() - 30 * 86400000);

    const [
        payStatus, wallet, versions, mediaKinds, usersByRole, products, categories, riders,
        orders, orders30, lastOrder, sessions, tokens, sms30, lastSms,
    ] = await Promise.all([
        accounts.statusFor(id, base(req)),
        SmsWallet.findOne({ tenantId: id }).lean(),
        AppVersionSeen.find({ tenantId: id }).sort({ lastSeenAt: -1 }).limit(30).lean(),
        Media.aggregate([{ $match: { tenantId: id } }, { $group: { _id: '$kind', n: { $sum: 1 } } }]),
        User.aggregate([{ $match: { tenantId: id } }, { $group: { _id: '$role', n: { $sum: 1 } } }]),
        Product.countDocuments({ tenantId: id, isActive: true }),
        Category.countDocuments({ tenantId: id }),
        Rider.countDocuments({ tenantId: id, isActive: true }),
        Order.countDocuments({ tenantId: id }),
        Order.countDocuments({ tenantId: id, createdAt: { $gte: day30 } }),
        Order.findOne({ tenantId: id }).sort({ createdAt: -1 }).select('createdAt orderNo').lean(),
        Session.countDocuments({ tenantId: id, expiresAt: { $gt: new Date() } }),
        DeviceToken.aggregate([
            { $match: { tenantId: id } },
            { $group: { _id: '$platform', n: { $sum: 1 }, last: { $max: '$lastSeenAt' } } },
        ]),
        SmsLog.aggregate([
            { $match: { tenantId: id, createdAt: { $gte: day30 } } },
            { $group: { _id: '$status', n: { $sum: 1 } } },
        ]),
        SmsLog.findOne({ tenantId: id }).sort({ createdAt: -1 }).select('createdAt status purpose own').lean(),
    ]);

    const kinds = Object.fromEntries(mediaKinds.map((k) => [k._id, k.n]));
    const roles = Object.fromEntries(usersByRole.map((r) => [r._id, r.n]));
    const own = t.sms?.own || {};
    const tpl = own.templateIds instanceof Map ? Object.fromEntries(own.templateIds) : (own.templateIds || {});
    const minVersion = cfg.app?.minVersion || null;
    const brandPath = `tenants/${slug}/branding`;
    const brandFile = (name, kind) => ({
        name,
        kind,
        uploaded: !!kinds[kind],
        url: cdn ? `${cdn}/${brandPath}/${name}` : null,
    });
    const pkg = t.androidPackage || null;

    res.json({
        generatedAt: new Date(),
        identity: {
            tenantId: String(id),
            slug,
            APP_TENANT: slug,
            name: t.name,
            status: t.status,
            state: shopState(t),
            businessType: t.businessType,
            androidPackage: pkg,
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
            apiBaseUrl: `${base(req)}/api`,
            webhookUrl: payStatus.webhookUrl,
        },
        build: {
            // the app.config.js of the mobile project keeps the name, package and colour of each shop in tenantConfigs
            tenantConfigsEntry: `${slug}: { name: ${JSON.stringify(t.name)}, bundleId: ${JSON.stringify(pkg || 'com.example.' + slug.replace(/-/g, ''))}, backgroundColor: ${JSON.stringify(t.colors?.primary || '#ffffff')} },`,
            commands: {
                powershell: [
                    `$env:APP_TENANT = "${slug}"`,
                    'npx expo start --clear',
                    'eas build --platform android --profile production',
                    'eas update --branch production --message "update"',
                ],
                bash: [
                    `APP_TENANT=${slug} npx expo start --clear`,
                    `APP_TENANT=${slug} eas build --platform android --profile production`,
                    `APP_TENANT=${slug} eas update --branch production --message "update"`,
                ],
            },
            env: [
                { key: 'APP_TENANT', value: slug },
                { key: 'EXPO_PUBLIC_BASE_URL', value: `${base(req)}/api` },
                { key: 'MEDIA_CDN_URL', value: cdn || null, note: cdn ? null : 'Not set on the server: set it, the app build needs it for the icon.' },
                { key: 'GOOGLE_MAPS_API_KEY', value: null, note: 'Set in the mobile .env / EAS secrets (not known to the server).' },
            ],
            branding: {
                folder: cdn ? `${cdn}/${brandPath}/` : `${brandPath}/ (bucket path; MEDIA_CDN_URL is not set)`,
                files: [brandFile('icon.png', 'icon'), brandFile('adaptive-foreground.png', 'adaptive'), brandFile('splash.png', 'splash')],
                logoUploaded: !!kinds.logo || !!t.logo,
                heroImages: kinds.hero || (t.heroImages || []).length,
            },
            firebase: {
                file: `mobile/google-services.${slug}.json`,
                note: 'Push needs the shop\'s own google-services file made for its package name. The server cannot see it.',
                tokensRegistered: tokens.reduce((a, x) => a + x.n, 0),
            },
        },
        appVersion: {
            minVersion,
            note: minVersion ? `Apps older than ${minVersion} are told to update.` : 'No minimum version: every version is allowed.',
            seen: versions.map((v) => ({
                version: v.version, build: v.build || null, platform: v.platform || null, osVersion: v.osVersion || null,
                firstSeenAt: v.firstSeenAt, lastSeenAt: v.lastSeenAt,
            })),
            latestSeen: versions[0]?.version || null,
            tracking: versions.length
                ? null
                : 'No app version reported yet. It appears once customers open an app built or updated after this feature shipped.',
        },
        payments: {
            enabled: payStatus.enabled,
            mode: payStatus.keyMode,
            keyIdMasked: mask(payStatus.keyId),
            hasKeySecret: payStatus.hasKeySecret,
            hasWebhookSecret: payStatus.hasWebhookSecret,
            verifiedAt: payStatus.verifiedAt,
            lastWebhookAt: payStatus.lastWebhookAt,
            webhookUrl: payStatus.webhookUrl,
            mockMode: payStatus.mockMode,
            checklist: payStatus.checklist,
            warnings: payStatus.warnings,
            methodsInApp: cfg.orders?.payments || [],       // the payment methods the customer is offered
        },
        sms: {
            mockMode: process.env.SMS_MOCK === 'true',
            useOwnSender: !!own.enabled,
            senderId: own.enabled ? (own.senderId || null) : (process.env.SMS_SENDER_ID || null),
            senderSource: own.enabled ? 'shop' : 'platform',
            entityId: own.enabled ? (own.entityId || null) : (process.env.SMS_ENTITY_ID || null),
            shopTemplateId: t.sms?.templateId || null,
            ownTemplateIds: tpl,
            ownProviderKey: yes(own.providerKeysEnc),
            platformDefaultTemplate: yes(process.env.SMS_DEFAULT_TEMPLATE_ID),
            platformAuthKey: yes(process.env.SMS_AUTH_KEY),
            wallet: wallet ? {
                balancePaise: wallet.balancePaise,
                ratePerSmsPaise: wallet.ratePerSmsPaise,
                costPerSmsPaise: wallet.costPerSmsPaise,
                lowBalancePaise: wallet.lowBalancePaise,
                blockAtZero: wallet.blockAtZero,
            } : null,
            last30Days: Object.fromEntries(sms30.map((s) => [s._id, s.n])),
            lastSms: lastSms ? { at: lastSms.createdAt, status: lastSms.status, purpose: lastSms.purpose, own: !!lastSms.own } : null,
        },
        data: {
            customers: roles.customer || 0,
            owners: roles.admin || 0,
            riderLogins: roles.rider || 0,
            riders,
            products,
            categories,
            orders,
            orders30Days: orders30,
            lastOrderAt: lastOrder?.createdAt || null,
            lastOrderNo: lastOrder?.orderNo || null,
            activeSessions: sessions,
            devices: tokens.map((x) => ({ platform: x._id || 'unknown', count: x.n, lastSeenAt: x.last })),
        },
        config: {
            look: {
                lightLook: cfg.brand?.lightLook, darkLook: cfg.brand?.darkLook, motion: cfg.brand?.motion,
                headerStyle: cfg.brand?.headerStyle, tabBarStyle: cfg.brand?.tabBarStyle, categoryStyle: cfg.brand?.categoryStyle,
                filterStyle: cfg.brand?.filterStyle, locationStyle: cfg.brand?.locationStyle,
            },
            acceptingOrders: cfg.orders?.acceptingOrders !== false,
            orderTypes: cfg.orders?.types || [],
            features: Object.entries(cfg.features || {}).filter(([, v]) => typeof v === 'boolean').map(([k, v]) => ({ key: k, on: v })),
            gst: { gstin: t.business?.gstin || null, fssai: t.business?.fssai || null },
            delivery: { latitude: t.delivery?.latitude ?? null, longitude: t.delivery?.longitude ?? null, radiusKm: t.delivery?.radiusKm ?? null },
            billing: { state: t.billing?.state, isLive: !!t.billing?.isLive, goLiveAt: t.billing?.goLiveAt || null },
        },
        server: {
            nodeEnv: process.env.NODE_ENV || null,
            paymentsMock: payments.isMock(),
            smsMock: process.env.SMS_MOCK === 'true',
            mediaCdnSet: !!cdn,
            publicBaseUrl: base(req),
        },
        notes: t.devNotes || '',
    });
}));

router.put('/tenants/:tid/dev-notes', loadTenant, wrap(async (req, res) => {
    const notes = typeof req.body?.notes === 'string' ? req.body.notes.slice(0, 4000) : null;
    if (notes === null) throw httpError(400, 'notes must be text');
    req.auditBefore = {};
    await Tenant.updateOne({ _id: req.tenantDoc._id }, { $set: { devNotes: notes } });
    res.json({ ok: true, notes });
}));

module.exports = router;
