// Every minute: the owner's automations (services/automations.js): pickups nobody collected, reservations nobody answered or came to,
// quiet inquiries, and the reminders for what waits for him. Each rule is safe to run twice and on two servers (filtered updates and claims).
const automations = require('../services/automations');

const MIN = 60 * 1000;

function startAutomations() {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try { await automations.runAll(); } catch (e) { console.error('Automations job error:', e.message); } finally { running = false; }
    };
    setTimeout(run, 70 * 1000).unref?.();
    setInterval(run, MIN).unref?.();
}

module.exports = { startAutomations };
