// Email adapter (Brevo). Business code calls ONLY this file.
//   EMAIL_MOCK=true                           -> prints a line, sends nothing
//   BREVO_API_KEY + MAIL_FROM_EMAIL (+ MAIL_FROM_NAME) -> real mail through Brevo
// With neither, email is simply OFF: enabled() is false and nothing is queued.
// send() throws when the mail was not sent, so the queue can retry it.

if (
    process.env.EMAIL_MOCK === 'true' &&
    process.env.NODE_ENV === 'production' &&
    process.env.ALLOW_EMAIL_MOCK_IN_PROD !== 'true'
) {
    throw new Error('FATAL: EMAIL_MOCK must not be enabled in production.');
}

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

const isMock = () => process.env.EMAIL_MOCK === 'true';
const isReal = () => !!(process.env.BREVO_API_KEY && process.env.MAIL_FROM_EMAIL);
const enabled = () => isMock() || isReal();

// attachments: [{ name: 'Invoice.pdf', content: '<base64>' }]
async function send({ to, subject, html, text, attachments }) {
    if (isMock()) {
        console.log(`[MOCK EMAIL] to ${to}: ${subject}${attachments?.length ? ` (+${attachments.length} attachment)` : ''}`);
        return { messageId: 'mock' };
    }
    if (!isReal()) throw new Error('Email provider not configured');

    const body = {
        sender: { name: process.env.MAIL_FROM_NAME || 'App', email: process.env.MAIL_FROM_EMAIL },
        to: [{ email: to }],
        subject,
        htmlContent: html,
    };
    if (text) body.textContent = text;
    if (attachments?.length) body.attachment = attachments.map((a) => ({ name: a.name, content: a.content }));

    const res = await fetch(BREVO_URL, {
        method: 'POST',
        headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
        let msg = '';
        try {
            const j = await res.json();
            msg = j?.message || JSON.stringify(j);
        } catch (e) { /* no body */ }
        throw Object.assign(new Error(`Email provider error ${res.status}${msg ? `: ${msg}` : ''}`), { status: res.status });
    }
    let json = {};
    try { json = await res.json(); } catch (e) { /* no body */ }
    return { messageId: json.messageId };
}

module.exports = { send, enabled };