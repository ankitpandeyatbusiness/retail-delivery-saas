const authenticate = require('./authMiddleware');

// For public routes that behave a little differently for logged-in customers
// (e.g. hide "first order only" offers from returning customers).
//   - no Authorization header  -> continues as a guest (req.auth is undefined)
//   - header present           -> must be a valid token, otherwise 401 (so the app knows to refresh)
// Use AFTER tenantRecognizer.
module.exports = (req, res, next) =>
    req.headers.authorization ? authenticate(req, res, next) : next();