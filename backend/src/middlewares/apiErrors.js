// Shared helpers for the address, order and shop routers.
//
//   const { wrap, httpError } = require('../middlewares/apiErrors');
//   router.use(apiErrors);   // put at the END of a router

const httpError = (status, message) => Object.assign(new Error(message), { status });

// lets async route functions throw: the error goes to apiErrors below
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Turns thrown errors into clean JSON. Real messages for expected errors (status < 500),
// a generic message for anything unexpected.
function apiErrors(err, req, res, next) { // eslint-disable-line no-unused-vars
    if (err.name === 'ValidationError') {
        const errors = Object.values(err.errors || {}).map((e) => e.message);
        return res.status(400).json({ error: 'Validation failed', errors: errors.length ? errors : [err.message] });
    }
    if (err.name === 'CastError') return res.status(400).json({ error: `Invalid value for "${err.path}"` });
    if (err.code === 11000) return res.status(409).json({ error: 'Already exists (duplicate value)' });
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    console.error('API error:', err);
    res.status(500).json({ error: 'Something went wrong' });
}

apiErrors.httpError = httpError;
apiErrors.wrap = wrap;
module.exports = apiErrors;