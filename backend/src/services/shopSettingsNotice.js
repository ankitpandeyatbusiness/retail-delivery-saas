// Tells a shop owner (push + inbox, tap opens the Rent page) when the platform team changes something about HIS shop's rent or free period.
// Only things the owner should know. Platform-wide money settings that are not his business (SMS prices, payment keys, tax rules) are never announced.
const notify = require('./notificationService');

const date = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

const send = (tenantId, { title, body }) => notify.toOwner(tenantId, {
    type: 'platform_message', title, body, data: { kind: 'rent' },
}).catch((e) => console.error('Shop notice error:', e.message));

const TEXT = {
    freeEnded: { title: 'Your free period has ended', body: 'Monthly rent starts now. Open Rent to see how it is worked out.' },
    freeStarted: { title: 'Your free period has started', body: 'You will not pay rent during the free period. Open Rent to see what is left.' },
    freeExtended: { title: 'Your free period was extended', body: 'Your free period is on again, so rent is paused until it ends. Open Rent to see what is left.' },
    freeChanged: { title: 'Your free period was changed', body: 'The platform team changed the limits of your free period. Open Rent to see what is left.' },
    waived: { title: 'A bill was waived', body: 'A bill was waived by the platform team. You do not need to pay it.' },
    cancelled: { title: 'A bill was cancelled', body: 'A bill was cancelled by the platform team. You do not need to pay it.' },
    lateFeesWaived: { title: 'Your late fees were waived', body: 'The platform team waived your unpaid late fees. Your rent bills still need to be paid.' },
};

const freeEnded = (tenantId) => send(tenantId, TEXT.freeEnded);
const freeStarted = (tenantId) => send(tenantId, TEXT.freeStarted);
const freeExtended = (tenantId) => send(tenantId, TEXT.freeExtended);
const freeChanged = (tenantId) => send(tenantId, TEXT.freeChanged);
const billCancelled = (tenantId, { waived }) => send(tenantId, waived ? TEXT.waived : TEXT.cancelled);
const lateFeesWaived = (tenantId) => send(tenantId, TEXT.lateFeesWaived);
const graceExtended = (tenantId, until) => send(tenantId, { title: 'Your payment deadline was extended', body: `You now have until ${date(until)} to pay your bill.` });

module.exports = { freeEnded, freeStarted, freeExtended, freeChanged, billCancelled, graceExtended, lateFeesWaived, TEXT };
