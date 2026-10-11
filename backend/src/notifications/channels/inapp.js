// The inbox row (always saved) and the live message (Socket.IO).
const Notification = require('../../models/Notification');
const realtime = require('../../services/realtime');

function save({ tenantId, userId, role, type, title, body, data, escalateAt }) {
    return Notification.create({
        tenantId, userId, role, type,
        title: String(title).slice(0, 120),
        body: body ? String(body).slice(0, 300) : undefined,
        data, escalateAt,
    });
}

// userId empty = the owner side of the shop
function live({ tenantId, userId, doc }) {
    const payload = {
        id: doc._id, type: doc.type, title: doc.title, body: doc.body || null, data: doc.data || null, createdAt: doc.createdAt,
    };
    if (userId) realtime.toUser(tenantId, userId, 'notification', payload);
    else realtime.toOwner(tenantId, 'notification', payload);
}

module.exports = { save, live };