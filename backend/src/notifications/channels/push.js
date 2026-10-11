// Push to the phones of one person, or of every owner of the shop.
// Returns { sent, tokens }: sent 0 means "nobody could be reached", so the next step (SMS) may start.
const DeviceToken = require('../../models/DeviceToken');
const User = require('../../models/User');
const adapter = require('../../services/adapters/push');

async function send({ tenantId, userId, title, body, data }) {
    const userIds = userId
        ? [userId]
        : (await User.find({ tenantId, role: 'admin' }).select('_id').lean()).map((u) => u._id);
    if (!userIds.length) return { sent: 0, tokens: 0 };

    const rows = await DeviceToken.find({ tenantId, userId: { $in: userIds } }).select('token').lean();
    const tokens = rows.map((r) => r.token);
    if (!tokens.length) return { sent: 0, tokens: 0 };

    const res = await adapter.send({ tokens, title, body, data });
    if (res?.invalidTokens?.length) await DeviceToken.deleteMany({ token: { $in: res.invalidTokens } });
    return { sent: res?.sent || 0, tokens: tokens.length };
}

module.exports = { send };