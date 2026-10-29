require('./helpers/env');
// The owner is told when somebody who went off duty is back (India time), in English and in Hindi.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const backAt = require('../src/utils/backAt');
const texts = require('../src/notifications/templates/texts');
const hi = require('../src/notifications/templates/textsHi');
const alerts = require('../src/notifications/alertGroups');

const now = new Date('2026-10-29T10:00:00Z');   // 3:30 pm in India

test('the time is said the way a person says it', () => {
    assert.equal(backAt(new Date('2026-10-29T11:30:00Z'), 'en', now), '5:00 pm');
    assert.equal(backAt(new Date('2026-10-30T00:30:00Z'), 'en', now), 'tomorrow 6:00 am');
    assert.equal(backAt(new Date('2026-10-30T00:30:00Z'), 'hi', now), 'कल 6:00 am');
    assert.equal(backAt(new Date('2026-11-02T01:00:00Z'), 'en', now), '2/11 6:30 am');
    assert.equal(backAt(null), '', 'no time: off until they switch on again');
});

test('the owner\'s off-duty alert for a cook, a waiter or a rider says when they are back, or that it is up to them', () => {
    assert.equal(texts.build('staff_off_duty', { name: 'Ravi', job: 'Cook', back: '4:30 pm' }).body, 'Ravi (Cook) switched off duty. Back at 4:30 pm.');
    assert.match(texts.build('staff_off_duty', { name: 'Ravi', job: 'Cook' }).body, /Back when they switch on duty again/);
    assert.equal(texts.build('rider_ended_duty', { riderName: 'Raju', back: 'tomorrow 6:00 am' }).body, 'Back at tomorrow 6:00 am.');
    assert.match(hi.build('staff_off_duty', { name: 'Ravi', job: 'cook', backHi: '4:30 pm' }), /4:30 pm पर वापस आएँगे/);
    assert.match(hi.build('rider_ended_duty', { riderName: 'Raju', backHi: 'कल 6:00 am' }), /कल 6:00 am पर वापस आएँगे/);
});

test('a rider going off duty is in the same switch group as the cook and the waiter', () => {
    assert.equal(alerts.groupOf('admin', 'rider_ended_duty').id, 'offduty');
    assert.equal(alerts.groupOf('admin', 'staff_off_duty').id, 'offduty');
});
