// Runs every shop's Autopilot every 15 minutes (reminders to customers and the owner's summaries).
// Each message is claimed in NudgeLog / Notification first, so two servers (or two runs) never send the same one twice.
const autopilot = require('../services/autopilot');

function startAutopilotScheduler() {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try {
            const r = await autopilot.runAll();
            if (r.customers || r.owner) console.log(`Autopilot: ${r.customers} customer message(s), ${r.owner} owner summary(ies) from ${r.shops} shop(s)`);
        } catch (e) {
            console.error('Autopilot error:', e.message);
        } finally {
            running = false;
        }
    };
    setTimeout(run, 4 * 60 * 1000).unref?.();
    setInterval(run, 15 * 60 * 1000).unref?.();
}

module.exports = { startAutopilotScheduler };
