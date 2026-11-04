// Tells a shop owner (push + inbox, tap opens the Rent page) when the platform team changes something about HIS shop's rent or free period.
// Only things the owner should know. Platform-wide money settings that are not his business (SMS prices, payment keys, tax rules) are never announced.
const notify = require('./notificationService');

const date = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

const send = (tenantId, { title, body }, kind = 'rent') => notify.toOwner(tenantId, {
    type: 'platform_message', title, body, data: { kind },
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

// the shop was paused for maintenance, and is back: the message and end time are the ones the superadmin wrote
const maintenanceOn = (tenantId, { message, until } = {}) => send(tenantId, {
    title: 'Your shop is paused for maintenance',
    body: `${message || 'The platform team is working on your shop.'}${until ? ` Expected back by ${new Date(until).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}.` : ''}`,
}, 'shop');
const maintenanceOff = (tenantId) => send(tenantId, { title: 'Your shop is back', body: 'Maintenance is over. Your shop works as usual.' }, 'shop');
// the owner panel was locked or opened again (the reason is private and never sent)
const ownerBlocked = (tenantId) => send(tenantId, { title: 'Your shop panel was locked', body: 'The platform team locked your panel for now. Please contact support.' }, 'shop');
const ownerAllowed = (tenantId) => send(tenantId, { title: 'Your shop panel is open again', body: 'You can use your shop panel as before.' }, 'shop');

module.exports = { maintenanceOn, maintenanceOff, ownerBlocked, ownerAllowed, freeEnded, freeStarted, freeExtended, freeChanged, billCancelled, graceExtended, lateFeesWaived, TEXT };
