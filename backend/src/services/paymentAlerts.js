// Tell the superadmin about a money problem. Never throws, so it can never break a payment.
module.exports = (eventKey, opts) => Promise.resolve()
    .then(() => require('./adminAlerts').alert(eventKey, opts))
    .catch((e) => console.error('Payment alert error:', e.message));