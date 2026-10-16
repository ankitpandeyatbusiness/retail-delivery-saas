// The supreme admin: the one superadmin who may change anything that affects money, the operator, agreements and the
// settlement sheet. Every other superadmin can look (and do everything else they could before).
// It is the superadmin whose login phone is this number. Set SUPREME_ADMIN_PHONE in .env to change it; it is NOT editable
// from any panel, so no other superadmin can give it to himself.
const PHONE = String(process.env.SUPREME_ADMIN_PHONE || '8318538918').replace(/\D/g, '').slice(-10);

const isSupreme = (admin) => !!admin && Array.isArray(admin.phones) && admin.phones.includes(PHONE);

module.exports = { PHONE, isSupreme };
