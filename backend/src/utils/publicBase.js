// The address the outside world uses to reach this server (webhook URLs, table QR links, the app's base URL).
// Local: PUBLIC_BASE_URL from .env (http://localhost:5000). Production: PUBLIC_BASE_URL if it is a real address, else the address
// the request came in on. A localhost value is ignored in production, so a copied .env line can never show localhost to the super admin.
module.exports = function publicBase(req) {
    const set = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
    const isLocalAddress = /^https?:\/\/(localhost|127\.|0\.0\.0\.0|10\.0\.2\.2|192\.168\.)/i.test(set);
    const production = process.env.NODE_ENV === 'production';
    if (set && !(production && isLocalAddress)) return set;
    return `${req.protocol}://${req.get('host')}`;
};
