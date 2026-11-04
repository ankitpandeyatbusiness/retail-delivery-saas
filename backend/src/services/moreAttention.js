// The More tab's "Needs attention": the platform things that want a look, not about one shop's money or orders.
// Support waiting, maintenance still on, the last backup too old, a health check that is not green.
// A backup or health item can be marked "handled by hand" (services/handledMarks.js); the others are live facts and leave by themselves.
const PlatformSettings = require('../models/PlatformSettings');
const SupportTicket = require('../models/SupportTicket');
const handled = require('./handledMarks');
const { isMaintenanceOn } = require('../utils/maintenance');

const DAY = 86400000;
const BACKUP_MAX_DAYS = 2;
let healthCache = null;   // the health build is heavy: reuse it for a minute

async function healthCards(now) {
    if (healthCache && Date.now() - healthCache.at < 60000) return healthCache.list;
    let list = [];
    try { list = (await require('./platformHealth').build(new Date(now))).needsYou || []; } catch (e) { list = []; }
    healthCache = { at: Date.now(), list };
    return list;
}

async function lastBackupDay() {
    try {
        const b = await require('./backupService').listBackups();
        return b.daily[0] || null;   // 'YYYY-MM-DD'
    } catch (e) { return undefined; }   // backups are not set up here: say nothing
}

async function attention({ supreme = false, now = Date.now() } = {}) {
    const items = [];
    const [support, settings, backupDay, health, marksBackup, marksHealth] = await Promise.all([
        SupportTicket.countDocuments({ status: 'open' }),
        PlatformSettings.findById('main').select('maintenance').lean(),
        lastBackupDay(),
        healthCards(now),
        handled.mapFor('backup_old', now),
        handled.mapFor('health_card', now),
    ]);

    if (isMaintenanceOn(settings?.maintenance, new Date(now))) {
        items.push({ key: 'maintenance', level: 'bad', title: 'Maintenance is ON', hint: 'Every shop\'s app is paused right now. Turn it off when the work is done.', screen: 'Maintenance' });
    }
    if (support > 0) items.push({ key: 'support', level: 'warn', title: `${support} support request${support === 1 ? '' : 's'} waiting`, hint: 'Shop owners are waiting for your answer.', screen: 'Support' });

    if (backupDay !== undefined) {
        const age = backupDay ? Math.floor((now - new Date(`${backupDay}T00:00:00+05:30`).getTime()) / DAY) : null;
        if (!backupDay || age > BACKUP_MAX_DAYS) {
            const refId = backupDay || 'none';
            items.push({ key: 'backup_old', kind: 'backup_old', refId, title: 'The last backup is too old', hint: backupDay ? `The newest backup is from ${backupDay} (${age} days ago). It should be made every night.` : 'No backup has been made yet.', level: 'bad', screen: 'System', mark: marksBackup.get(refId) || null });
        }
    }
    for (const c of health) {
        const refId = `${c.key}:${c.level}`;
        items.push({ key: `health_${c.key}`, kind: 'health_card', refId, level: c.level === 'bad' ? 'bad' : 'warn', title: `Platform health: ${c.key.replace(/_/g, ' ')}`, hint: c.note, screen: 'PlatformHealth', mark: marksHealth.get(refId) || null });
    }
    const open = items.filter((i) => !i.mark);
    const done = items.filter((i) => i.mark);
    const rank = { bad: 0, warn: 1 };
    open.sort((a, b) => rank[a.level] - rank[b.level]);
    return { items: open, handled: done, counts: { total: open.length, bad: open.filter((i) => i.level === 'bad').length }, checkedAt: new Date(now) };
}

module.exports = { attention };
