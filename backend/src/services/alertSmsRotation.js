// Sends an alert SMS to the superadmin's phone. The PLATFORM (the superadmin) always pays; no shop wallet is ever charged.
// Each SMS saves a PlatformSmsCost row, so the superadmin app can show his own SMS usage.
// If the SMS provider fails, nothing is recorded. Mock SMS mode only prints the SMS.
// (File name kept from the old round-robin version, where shops paid in turns.)
const PlatformSmsCost = require('../models/PlatformSmsCost');
const wallet = require('./smsWalletService');
const smsAdapter = require('./adapters/sms');

const PURPOSE = 'platform_alert';

async function send({ phone, text, eventKey, tenantId }) {
    try {
        await smsAdapter.send({ to: phone, text, purpose: PURPOSE, tenant: null });
    } catch (e) {
        console.error('Alert SMS failed:', e.message);
        return { mode: 'failed', error: e.message };
    }
    if (!wallet.shouldCharge()) return { mode: 'mock' };   // mock SMS: nothing really cost money
    await PlatformSmsCost.create({
        eventKey, tenantId, costPaise: wallet.DEFAULTS.costPerSmsPaise, phoneMasked: wallet.mask(phone),
    }).catch((e) => console.error('Alert SMS cost not saved:', e.message));
    return { mode: 'platform' };
}

module.exports = { send };
