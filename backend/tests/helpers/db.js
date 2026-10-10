const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

let repl;

// A replica set, so database transactions work in tests (needed from batch C)
exports.connect = async () => {
    repl = await MongoMemoryReplSet.create({
        binary: { version: '7.0.14' },   // fixed version: the newest one can refuse the Mongoose driver
        replSet: { count: 1 },
    });
    await mongoose.connect(repl.getUri(), { serverSelectionTimeoutMS: 30000 });
    await Promise.all(Object.values(mongoose.models).map((m) => m.init()));   // build unique indexes
};

// Empties every collection but keeps the indexes
exports.clear = async () => {
    await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
};

exports.disconnect = async () => {
    await mongoose.disconnect();
    if (repl) await repl.stop();
};