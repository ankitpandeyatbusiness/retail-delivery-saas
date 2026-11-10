// Plan money that waits for the supreme admin must not be forgotten: a payment that was HELD (the owner paid, the plan could not be applied) and a bank dispute
// that is still open. Every morning, while any exists, ONE alert says how many and how old (services/platformDisputes.js, services/planBilling.js applyHeld).
const PlanPayment = require('../models/PlanPayment');
const PlatformDispute = require('../models/PlatformDispute');
const adminAlerts = require('./adminAlerts');
const { OPEN } = require('./platformDisputes');

const DAY = 86400000;
const days = (d, now) => Math.max(0, Math.floor((now.getTime() - new Date(d).getTime()) / DAY));

async function remind(now = new Date()) {
    const [held, disputes] = await Promise.all([
        PlanPayment.find({ status: 'held' }).select('createdAt paidAt').lean(),
        PlatformDispute.find({ status: { $in: OPEN } }).select('createdAt respondBy').lean(),
    ]);
    if (!held.length && !disputes.length) return { held: 0, disputes: 0, alerted: false };
    const parts = [];
    if (held.length) parts.push(`${held.length} held payment${held.length > 1 ? 's' : ''} (the oldest ${days(Math.min(...held.map((h) => new Date(h.paidAt || h.createdAt))), now)} day(s) old): the owner paid but the plan was not applied`);
    if (disputes.length) {
        const soon = disputes.filter((d) => d.respondBy).map((d) => new Date(d.respondBy)).sort((a, b) => a - b)[0];
        parts.push(`${disputes.length} open bank dispute${disputes.length > 1 ? 's' : ''}${soon ? ` (reply by ${soon.toISOString().slice(0, 10)})` : ''}`);
    }
    await adminAlerts.alert('admin_plan_money_waiting', { vars: { summary: `${parts.join('. ')}. Open More > Plans overview.` }, supremeOnly: true });
    return { held: held.length, disputes: disputes.length, alerted: true };
}

module.exports = { remind };
