const AuditLog = require('../models/AuditLog');

const SENSITIVE = /pass|token|secret|otp|authorization|pepper|^pin$/i;
const MAX_JSON = 30000;
const ID_IN_PATH = /[a-f0-9]{24}/gi;

// Copies a value, hiding secrets and cutting very long text/lists
function clean(v, depth = 0) {
    if (v === null || v === undefined) return v;
    if (v._bsontype) return String(v);                    // ObjectId
    if (v instanceof Date) return v;
    if (typeof v === 'string') return v.length > 500 ? `${v.slice(0, 500)}…` : v;
    if (typeof v !== 'object') return v;
    if (depth >= 5) return '[too deep]';
    if (Array.isArray(v)) return v.slice(0, 50).map((x) => clean(x, depth + 1));
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = SENSITIVE.test(k) ? '[hidden]' : clean(val, depth + 1);
    return out;
}

const capped = (v) => {
    if (v === undefined) return undefined;
    const c = clean(v);
    return JSON.stringify(c ?? null).length > MAX_JSON ? { truncated: true } : c;
};

function record(entry) {
    return AuditLog.create(entry).catch((e) => console.error('Audit log error:', e.message));
}

// Mount AFTER the login check, so the actor is known when the request finishes.
//   actorType: 'superadmin' (reads req.admin) or 'owner' (reads req.auth + req.tenant)
function auditTrail(actorType) {
    return (req, res, next) => {
        if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

        res.on('finish', () => {
            if (res.statusCode >= 400) return;            // only changes that really happened
            try {
                let actorId;
                let actorLabel;
                if (actorType === 'superadmin') {
                    if (!req.admin) return;
                    actorId = req.admin._id;
                    actorLabel = req.admin.email;
                } else {
                    if (!req.auth) return;
                    actorId = req.auth.userId;
                    actorLabel = req.shopUser?.phone || String(req.auth.userId);
                }

                const path = req.originalUrl.split('?')[0];
                const fromPath = path.match(/\/tenants\/([a-f0-9]{24})/i);
                record({
                    actorType,
                    actorId,
                    actorLabel,
                    tenantId: req.tenant?._id || (fromPath ? fromPath[1] : undefined),
                    action: res.locals.auditAction || `${req.method} ${path.replace(ID_IN_PATH, ':id')}`,
                    method: req.method,
                    path,
                    status: res.statusCode,
                    params: capped(res.locals.auditParams),
                    query: capped(req.query),
                    body: capped(req.body),
                    before: capped(req.auditBefore),
                    ip: req.ip,
                });
            } catch (e) {
                console.error('Audit log error:', e.message);
            }
        });
        next();
    };
}

auditTrail.record = record;
module.exports = auditTrail;