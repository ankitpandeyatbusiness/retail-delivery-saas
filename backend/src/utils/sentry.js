// Error reporting (Sentry free plan). Off when SENTRY_DSN is not set. Never sends request bodies, cookies or tokens.
let client = null;

const HEADERS = ['authorization', 'cookie', 'x-api-key', 'x-device-id'];

function scrub(event) {
    if (event && event.request) {
        delete event.request.cookies;
        delete event.request.data;
        delete event.request.query_string;
        if (event.request.headers) for (const h of HEADERS) delete event.request.headers[h];
    }
    if (event && event.user) {
        delete event.user.ip_address;
        delete event.user.email;
        delete event.user.username;
    }
    return event;
}

function init() {
    if (client) return true;
    const dsn = process.env.SENTRY_DSN;
    if (!dsn) return false;
    try {
        const Sentry = require('@sentry/node');
        Sentry.init({
            dsn,
            environment: process.env.NODE_ENV || 'development',
            release: process.env.RENDER_GIT_COMMIT || undefined,
            tracesSampleRate: 0,
            sendDefaultPii: false,
            beforeSend: scrub,
        });
        client = Sentry;
        return true;
    } catch (e) {
        console.error('Sentry is not available:', e.message);
        return false;
    }
}

// extra: small facts like ids. Never put phones, tokens or request bodies here.
function capture(err, extra) {
    if (!client) return;
    try {
        client.captureException(err instanceof Error ? err : new Error(String(err)), extra ? { extra } : undefined);
    } catch (e) { /* reporting must never break the app */ }
}

const flush = async (ms = 2000) => { if (client) await client.flush(ms).catch(() => { }); };

const _setClient = (c) => { client = c; };      // for tests

module.exports = { init, capture, flush, scrub, _setClient };