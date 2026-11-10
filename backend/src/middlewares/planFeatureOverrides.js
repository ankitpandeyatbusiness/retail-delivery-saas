// Keeps the "what each plan includes" table of this server up to date with the database (the supreme admin can change it in Plan defaults).
// A request refreshes it at most every few seconds, so a change reaches every server instance quickly. In tests it is read on every request.
const planService = require('../services/planService');

const TTL = process.env.NODE_ENV === 'test' ? 0 : 15000;
let last = 0;
let loading = null;

async function refresh() {
    if (Date.now() - last < TTL) return;
    if (!loading) loading = planService.loadFeatureOverrides().then(() => { last = Date.now(); }).catch(() => { /* keep what we have */ }).finally(() => { loading = null; });
    await loading;
}

module.exports = (req, res, next) => { refresh().then(() => next(), () => next()); };
module.exports.refresh = refresh;
