// In a brand with branches the BRAND OWNER pays the rent and tops up the shared SMS wallet, not the branch managers.
//   canPay(req)  -> true / false: may the person behind this request pay?
//   brandPayer   -> middleware for the pay and top-up routes: a branch manager gets 403 { brandOwnerPays: true }
// Always allowed: a shop that is not a branch, the superadmin acting for a shop, and a brand that has no brand owner yet (nobody would be able to pay).
const Brand = require('../models/Brand');
const User = require('../models/User');

async function canPay(req) {
    if (req.actor && req.actor.type === 'superadmin') return true;
    if (!req.tenant || !req.tenant.brandId) return true;
    const brand = await Brand.findById(req.tenant.brandId).select('ownerPhones').lean();
    if (!brand || !(brand.ownerPhones || []).length) return true;
    const userId = req.auth && req.auth.userId;
    if (!userId) return false;
    const user = await User.findById(userId).select('phone').lean();
    return !!user && brand.ownerPhones.includes(user.phone);
}

const MESSAGE = 'The brand owner pays the rent and tops up the SMS wallet for every branch.';

async function brandPayer(req, res, next) {
    try {
        if (await canPay(req)) return next();
        return res.status(403).json({ error: MESSAGE, brandOwnerPays: true });
    } catch (e) {
        console.error('Brand payer check error:', e.message);
        return res.status(500).json({ error: 'Could not verify access' });
    }
}

module.exports = { canPay, brandPayer, MESSAGE };
