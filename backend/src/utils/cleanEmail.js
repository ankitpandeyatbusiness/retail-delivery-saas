// One check for every email field. Returns the clean email, or '' to clear it. Throws 400 for a bad one.
const { httpError } = require('../middlewares/apiErrors');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

module.exports = function cleanEmail(value) {
    if (value === null) return '';
    if (typeof value !== 'string') throw httpError(400, 'Enter a valid email address');
    const e = value.trim().toLowerCase();
    if (!e) return '';
    if (e.length > 120 || !EMAIL_RE.test(e)) throw httpError(400, 'Enter a valid email address');
    return e;
};