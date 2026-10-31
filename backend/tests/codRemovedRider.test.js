require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const CodSettlement = require('../src/models/CodSettlement');
const Rider = require('../src/models/Rider');
const cod = require('../src/services/codService');

test('cash held by a rider who was removed is not counted as owed', async () => {
    CodSettlement.aggregate = async () => [
        { _id: 'u1', collectedPaise: 50000, handedPaise: 0, adjustedPaise: 0, balancePaise: 50000, lastAt: new Date() },   // still on the team
        { _id: 'u2', collectedPaise: 7000, handedPaise: 0, adjustedPaise: 0, balancePaise: 7000, lastAt: new Date() },     // removed: Rs 70
    ];
    Rider.find = () => ({ select: () => ({ lean: async () => [{ userId: 'u1', name: 'Ravi', isActive: true }] }) });
    const r = await cod.balances('t1');
    assert.equal(r.totalOwedPaise, 50000);
    assert.equal(r.writtenOffPaise, 7000);
    const gone = r.items.find((i) => i.removed);
    assert.equal(gone.balancePaise, 7000);   // still on the books
    assert.equal(gone.writtenOff, true);
});
