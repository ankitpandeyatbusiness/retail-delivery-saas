// The chat between a customer and the owner. The same routes, mounted twice:
//   /api/chat        the customer (logged in)
//   /api/shop/chat   the owner (the owner chain already ran)
//   GET  /unread                      { total, byRef: { 'bulk:<id>': 2 } }   for the badges
//   GET  /:kind/:id?read=1            the messages ({ items, closed, closesAt, title }); read=1 marks the other side's messages as read
//   POST /:kind/:id                   { text?, images?: [url], voice?: { url, sec }, clientId? }
//   POST /:kind/:id/ack               { ids? }   the app got these messages (delivered)
//   POST /:kind/:id/read              the chat is open on screen (read)
//   POST /:kind/:id/typing            "typing..." to the other person
// kind = bulk | inquiry | booking
const express = require('express');
const { wrap } = require('../middlewares/apiErrors');
const chat = require('../services/chat');

function make(side) {
    const router = express.Router();
    const who = (req) => ({ tenant: req.tenant, side, userId: req.auth?.userId });
    router.get('/unread', wrap(async (req, res) => { res.json(await chat.unread(who(req))); }));
    router.get('/:kind/:id', wrap(async (req, res) => { res.json(await chat.list({ ...who(req), kind: req.params.kind, refId: req.params.id, read: req.query.read === '1' })); }));
    router.post('/:kind/:id', wrap(async (req, res) => { res.status(201).json(await chat.send({ ...who(req), kind: req.params.kind, refId: req.params.id, body: req.body || {} })); }));
    router.post('/:kind/:id/ack', wrap(async (req, res) => {
        const c = await chat.load({ ...who(req), kind: req.params.kind, refId: req.params.id });
        await chat.markDelivered({ tenant: req.tenant, kind: req.params.kind, refId: c.doc._id, side, customerId: c.customerId, ids: Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 200) : undefined });
        res.json({ ok: true });
    }));
    router.post('/:kind/:id/read', wrap(async (req, res) => {
        const c = await chat.load({ ...who(req), kind: req.params.kind, refId: req.params.id });
        await chat.markRead({ tenant: req.tenant, kind: req.params.kind, refId: c.doc._id, side, customerId: c.customerId });
        res.json({ ok: true });
    }));
    router.post('/:kind/:id/typing', wrap(async (req, res) => {
        const c = await chat.load({ ...who(req), kind: req.params.kind, refId: req.params.id });
        chat.typing({ tenant: req.tenant, kind: req.params.kind, refId: c.doc._id, side, customerId: c.customerId });
        res.json({ ok: true });
    }));
    return router;
}

module.exports = { customerChat: () => make('customer'), ownerChat: () => make('owner') };
