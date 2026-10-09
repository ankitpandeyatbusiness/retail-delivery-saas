// Webhooks from outside services (Razorpay later). The body stays RAW (a Buffer),
// because a signature check needs the exact bytes that were sent.
// This router is mounted ABOVE express.json in server.js.

const express = require('express');

const router = express.Router();

router.use(express.raw({ type: '*/*', limit: '200kb' }));

// PHASE 4: replace this with the real handler. It should:
//   1. read the shop from req.params.tenantId and load that shop's webhook secret
//   2. check the signature against req.body (the raw Buffer)
//   3. use the payment id so a repeated webhook does nothing twice
router.post('/razorpay/:tenantId', (req, res) => {
    res.status(501).json({ error: 'Payments are not enabled yet' });
});

// anything else under /api/webhooks ends here, so it never reaches express.json
router.use((req, res) => res.status(404).json({ error: 'Not found' }));

module.exports = router;