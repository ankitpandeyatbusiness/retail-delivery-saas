// "Until tomorrow morning": the next 4 AM in India time (tomorrow's, or today's if it is earlier than 4 AM now).
// A shop open past midnight keeps one working day, the same turnover hour as the stock day (stockService.DAY_START_HOUR).
const IST_MS = 330 * 60000;

function nextMorning(now = new Date()) {
    const ist = new Date(now.getTime() + IST_MS);
    const today4 = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 4, 0, 0) - IST_MS;
    return new Date(today4 > now.getTime() ? today4 : today4 + 86400000);
}

module.exports = { nextMorning };
