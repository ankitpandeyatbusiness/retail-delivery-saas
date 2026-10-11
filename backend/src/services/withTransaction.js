// Runs fn(session) in ONE database transaction: everything inside is saved together, or nothing is.
// If the server crashes in the middle, the database rolls the whole thing back.
// Pass { session } to every create and update inside fn.
// The database may call fn again when it hits a harmless clash, so keep fn free of side effects
// (no SMS, no push, no logs that count) and do those after withTransaction returns.
const mongoose = require('mongoose');

async function withTransaction(fn) {
    const session = await mongoose.startSession();
    try {
        let result;
        await session.withTransaction(async () => {
            result = await fn(session);
        });
        return result;
    } finally {
        await session.endSession();
    }
}

module.exports = withTransaction;