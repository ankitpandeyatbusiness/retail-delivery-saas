// Superadmin: his own profile picture. Mounted under /api/admin (after the superadmin login check).
//   POST   /me/photo/sign   { contentType, bytes }  -> where to PUT the picture
//   POST   /me/photo        { key }                 -> checks it, makes a 512 px WebP, saves it as MY picture
//   DELETE /me/photo
// One picture per superadmin, stored at platform/admins/<id>/photo.webp (a new picture replaces the old one).
const crypto = require('crypto');
const express = require('express');
const SuperAdmin = require('../models/SuperAdmin');
const storage = require('../services/adapters/storage');
const { toWebp } = require('../services/imageProcessor');
const { sniff, MAX_BYTES } = require('../services/mediaService');
const { wrap, httpError } = require('../middlewares/apiErrors');

const router = express.Router();
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const tmpPrefix = (id) => `platform/admins/${id}/tmp/`;
const finalKey = (id) => `platform/admins/${id}/photo.webp`;

router.post('/me/photo/sign', wrap(async (req, res) => {
    const { contentType, bytes } = req.body || {};
    const ext = EXT[contentType];
    if (!ext) throw httpError(400, 'Only jpeg, png or webp images are allowed');
    if (!Number.isInteger(bytes) || bytes < 1 || bytes > MAX_BYTES) throw httpError(400, 'The picture must be between 1 byte and 5 MB');
    const key = `${tmpPrefix(req.admin._id)}${crypto.randomUUID()}.${ext}`;
    const uploadUrl = await storage.presignPut({ key, contentType, bytes });
    res.json({ uploadUrl, key, method: 'PUT', headers: { 'Content-Type': contentType }, expiresIn: 300 });
}));

router.post('/me/photo', wrap(async (req, res) => {
    const key = req.body?.key;
    if (typeof key !== 'string' || !key.startsWith(tmpPrefix(req.admin._id))) throw httpError(400, 'Invalid key');
    try { storage.safeKey(key); } catch { throw httpError(400, 'Invalid key'); }
    const drop = () => storage.remove(key).catch(() => { });

    const meta = await storage.head(key).catch(() => null);
    if (!meta) throw httpError(400, 'The picture was not uploaded');
    if (meta.bytes > MAX_BYTES || !sniff(await storage.peek(key, 12))) {
        await drop();
        throw httpError(400, 'Not a valid image (jpeg, png or webp, max 5 MB)');
    }
    let img;
    try { img = await toWebp(await storage.get(key), { maxSide: 512 }); } catch (e) {
        await drop();
        if (/sharp is not installed/.test(e.message)) throw e;
        throw httpError(400, 'Not a valid image (jpeg, png or webp, max 5 MB)');
    }
    await storage.put({ key: finalKey(req.admin._id), buffer: img.buffer, contentType: 'image/webp' });
    await drop();
    const photo = `${storage.publicUrl(finalKey(req.admin._id))}?v=${Date.now()}`;   // same name, new picture: bust the cache
    await SuperAdmin.updateOne({ _id: req.admin._id }, { $set: { photo } });
    res.status(201).json({ photo });
}));

router.delete('/me/photo', wrap(async (req, res) => {
    if (!req.admin.photo) throw httpError(404, 'You have no picture');
    await storage.remove(finalKey(req.admin._id)).catch(() => { });
    await SuperAdmin.updateOne({ _id: req.admin._id }, { $unset: { photo: 1 } });
    res.json({ ok: true });
}));

module.exports = router;
