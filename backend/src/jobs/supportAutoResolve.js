// Support requests the team answered and the owner never replied to for 7 days are marked solved by themselves (services/supportService.js autoResolveQuiet).
// Safe to run on two servers: each request is claimed with a filtered update.
const support = require('../services/supportService');

function startSupportAutoResolveScheduler() {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try {
            const n = await support.autoResolveQuiet();
            if (n) console.log(`Support: ${n} quiet request(s) marked solved`);
        } catch (e) {
            console.error('Support auto-resolve error:', e.message);
        } finally {
            running = false;
        }
    };
    setTimeout(run, 3 * 60 * 1000).unref?.();
    setInterval(run, 6 * 60 * 60 * 1000).unref?.();   // every 6 hours
}

module.exports = { startSupportAutoResolveScheduler };
