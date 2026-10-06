// Shared by the per-shop check (tenantRecognizer) and the superadmin maintenance routes.

const httpError = (status, message) => Object.assign(new Error(message), { status });
const DEFAULT_MESSAGE = 'We are down for maintenance. Please try again soon.';

// m = { on, message, until }. "until" is optional: maintenance ends by itself at that time.
const isMaintenanceOn = (m, now = new Date()) =>
    !!m && m.on === true && (!m.until || new Date(m.until) > now);

// What the app receives while maintenance is on (the app looks for maintenance: true)
const maintenanceBody = (m) => ({
    error: m.message || DEFAULT_MESSAGE,
    maintenance: true,
    until: m.until || null,
});

// Reads { on, message, until } from a request body, or throws a clear 400
function parseMaintenanceBody(input) {
    const body = input || {};
    if (typeof body.on !== 'boolean') throw httpError(400, 'Send on: true or false');

    let message = '';
    if (body.message !== undefined && body.message !== null) {
        if (typeof body.message !== 'string' || body.message.trim().length > 200) {
            throw httpError(400, 'Message must be text up to 200 characters');
        }
        message = body.message.trim();
    }

    let until = null;
    if (body.on && body.until) {
        until = new Date(body.until);
        if (Number.isNaN(until.getTime())) throw httpError(400, 'Invalid "until" date');
        if (until <= new Date()) throw httpError(400, '"until" must be a time in the future');
    }
    return { on: body.on, message, until };
}

module.exports = { isMaintenanceOn, maintenanceBody, parseMaintenanceBody };