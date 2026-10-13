// A job that runs once a day after a given Indian hour, on ONE server only (a Mongo lock per job and day).
// A failed run releases the lock, so the next check (every 30 minutes) tries again, up to 4 times a day.
const mongoose = require('mongoose');
const sentry = require('./sentry');

const istShift = (now) => new Date(now + 330 * 60 * 1000);
const istDay = (now = Date.now()) => istShift(now).toISOString().slice(0, 10);

let ttlDone = false;
const locks = () => mongoose.connection.collection('job_locks');

async function claim(key) {
    if (!ttlDone) {
        ttlDone = true;
        await locks().createIndex({ at: 1 }, { expireAfterSeconds: 7 * 24 * 3600 }).catch(() => { });
    }
    try {
        await locks().insertOne({ _id: key, at: new Date() });
        return true;
    } catch (e) {
        if (e && e.code === 11000) return false;
        throw e;
    }
}
const release = (key) => locks().deleteOne({ _id: key }).catch(() => { });

async function runDailyOnce({ name, hour, fn, now = Date.now() }) {
    if (istShift(now).getUTCHours() < hour) return { ran: false, reason: 'early' };
    const key = `${name}:${istDay(now)}`;
    if (!(await claim(key))) return { ran: false, reason: 'done' };
    try {
        return { ran: true, result: await fn() };
    } catch (e) {
        await release(key);
        throw e;
    }
}

function startDailyJob({ name, hour, fn }) {
    let running = false;
    let day = '';
    let attempts = 0;
    const tick = async () => {
        if (running) return;
        const today = istDay();
        if (today !== day) { day = today; attempts = 0; }
        if (attempts >= 4) return;
        running = true;
        try {
            const r = await runDailyOnce({ name, hour, fn });
            if (r.ran || r.reason === 'done') attempts = 99;       // finished today, here or on another server
        } catch (e) {
            attempts += 1;
            console.error(`Daily job ${name} failed:`, e.message);
            sentry.capture(e, { job: name });
        } finally {
            running = false;
        }
    };
    setTimeout(tick, 2 * 60 * 1000).unref?.();
    setInterval(tick, 30 * 60 * 1000).unref?.();
}

module.exports = { runDailyOnce, startDailyJob, istDay };