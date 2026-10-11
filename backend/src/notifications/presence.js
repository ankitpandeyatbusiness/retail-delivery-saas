// Is this person connected right now? (read from the live connections of Socket.IO, one server)
const realtime = require('../services/realtime');

module.exports = {
    isOnline: (tenantId, userId) => realtime.isUserOnline(String(tenantId), String(userId)),
    ownerOnline: (tenantId) => realtime.isOwnerOnline(String(tenantId)),
};