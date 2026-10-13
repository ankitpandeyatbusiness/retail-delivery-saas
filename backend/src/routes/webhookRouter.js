// Webhooks from outside services (Razorpay). The body stays RAW (a Buffer),
// because a signature check needs the exact bytes that were sent.
// This router is mounted ABOVE express.json in app.js.
//   POST /api/webhooks/razorpay/platform    SMS top-ups and rent (platform account)
//   POST /api/webhooks/razorpay/:tenantId   one shop's own Razorpay account

const express = require('express');
const razorpayWebhook = require('../services/razorpayWebhook');

const router = express.Router();

router.use(express.raw({ type: '*/*', limit: '200kb' }));

const handler = (fixedAccount) => async (req, res) => {
    try {
        if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Empty body' });
        const r = await razorpayWebhook.handle({
            account: fixedAccount || req.params.tenantId,
            rawBody: req.body,
            signature: req.get('x-razorpay-signature'),
            eventIdHeader: req.get('x-razorpay-event-id'),
        });
        return res.status(r.status).json(r.body);
    } catch (e) {
        console.error('Webhook error:', e.message);
        return res.status(500).json({ error: 'Could not process, try again' });   // Razorpay will send it again
    }
};

router.post('/razorpay/platform', handler('platform'));
router.post('/razorpay/:tenantId', handler(null));

// anything else under /api/webhooks ends here, so it never reaches express.json
router.use((req, res) => res.status(404).json({ error: 'Not found' }));

module.exports = router;