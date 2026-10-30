require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const ticket = require('../src/services/bookingTicket');

test('token is signed and cannot be changed', () => {
    const b = { _id: '64b7f0c2a1b2c3d4e5f60718' };
    const t = ticket.tokenOf(b);
    assert.equal(ticket.idFromToken(t), String(b._id));
    assert.equal(ticket.idFromToken(t.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'))), null);
    assert.equal(ticket.idFromToken('TB1.64b7f0c2a1b2c3d4e5f60719.' + t.split('.')[2]), null);
    assert.equal(ticket.idFromToken('hello'), null);
});

test('QR matrix is square and made of 0 and 1', () => {
    const m = ticket.matrixOf('TB1.x');
    assert.equal(m.rows.length, m.size);
    assert.ok(m.rows.every((r) => r.length === m.size && /^[01]+$/.test(r)));
});

test('only a paid and allowed booking has a ticket', () => {
    const base = { status: 'confirmed', approvedAt: new Date(), deposit: { status: 'paid' } };
    assert.equal(ticket.ticketable(base), true);
    assert.equal(ticket.ticketable({ ...base, approvedAt: null }), false);
    assert.equal(ticket.ticketable({ ...base, status: 'held' }), false);
    assert.equal(ticket.ticketable({ ...base, status: 'cancelled' }), false);
    assert.equal(ticket.ticketable({ ...base, deposit: { status: 'unpaid' } }), false);
});

// the scanner, with the database stubbed
const TableBooking = require('../src/models/TableBooking');
const START = new Date('2026-11-03T19:00:00+05:30').getTime();
const at = (min) => START + min * 60000;
const mk = (over = {}) => ({ _id: '64b7f0c2a1b2c3d4e5f60718', tenantId: 't1', name: 'Asha', phone: '999', table: '4', date: '2026-11-03', time: '19:00', party: 2, code: 'ABCDE', status: 'confirmed', approvedAt: new Date(), deposit: { status: 'paid' }, startsAt: new Date(START), endsAt: new Date(START + 3600000), ...over });
const stub = (doc) => { TableBooking.findOne = () => ({ lean: async () => doc, sort: () => ({ lean: async () => doc }) }); };
const tenant = { _id: 't1' };

test('the scanner says what is wrong, and accepts 15 minutes early', async () => {
    const tok = ticket.tokenOf(mk());
    stub(mk());
    assert.equal((await ticket.check(tenant, tok, at(-16))).state, 'early');
    assert.equal((await ticket.check(tenant, tok, at(-15))).state, 'ok');
    assert.equal((await ticket.check(tenant, tok, at(30))).state, 'ok');
    assert.equal((await ticket.check(tenant, tok, at(61))).state, 'late');
    assert.equal((await ticket.check(tenant, tok, at(-60 * 24 * 2))).state, 'wrong_day');
    stub(mk({ approvedAt: null })); assert.equal((await ticket.check(tenant, tok, at(0))).state, 'not_allowed');
    stub(mk({ status: 'seated', arrivedAt: new Date() })); assert.equal((await ticket.check(tenant, tok, at(0))).state, 'arrived');
    stub(mk({ status: 'cancelled' })); assert.equal((await ticket.check(tenant, tok, at(0))).state, 'cancelled');
    stub(null); assert.equal((await ticket.check(tenant, tok, at(0))).state, 'not_found');
    assert.equal((await ticket.check(tenant, 'TB1.64b7f0c2a1b2c3d4e5f60718.00000000000000000000', at(0))).state, 'not_found');
});

test('the ticket is gone when the slot is over', () => {
    const b = mk();
    assert.equal(ticket.over(b, at(59)), false);
    assert.equal(ticket.over(b, at(61)), true);
    assert.throws(() => ticket.ticketFor(b, { name: 'S' }, at(61)), /time is over/);
    assert.equal(ticket.ticketFor(b, { name: 'S' }, at(30)).table, '4');
});
