// When somebody who went off duty for a while is back, said the way a person says it (India time): "4:30 pm", "tomorrow 6:00 am", "31/10 6:00 am".
// backAt(date) is English, backAt(date, 'hi') Hindi. No date (off until they switch on again) gives ''.
const IST_MIN = 330;
const dayOf = (d) => Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000);

function backAt(date, lang = 'en', now = new Date()) {
    if (!date) return '';
    const t = new Date(date);
    if (Number.isNaN(t.getTime())) return '';
    const d = new Date(t.getTime() + IST_MIN * 60000);
    const n = new Date(now.getTime() + IST_MIN * 60000);
    const h = d.getUTCHours();
    const clock = `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`;
    const gap = dayOf(d) - dayOf(n);
    if (gap <= 0) return clock;
    if (gap === 1) return `${lang === 'hi' ? 'कल' : 'tomorrow'} ${clock}`;
    return `${d.getUTCDate()}/${d.getUTCMonth() + 1} ${clock}`;
}

module.exports = backAt;
