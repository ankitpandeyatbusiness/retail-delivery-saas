require('./helpers/env');
// The login OTP says which shop it is for, with the shop name cleaned and cut to a DLT variable (30 characters).
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { otpText } = require('../src/services/adapters/sms');

describe('OTP text', () => {
    test('names the shop and gives the code', () => {
        assert.equal(otpText({ otp: '482916', tenant: { name: 'Savera Restaurant' } }), 'Your OTP for Savera Restaurant is 482916. Valid for 5 minutes. Do not share it.');
    });
    test('a long or odd shop name is cleaned and cut at 30 characters', () => {
        const t = otpText({ otp: '111111', tenant: { name: 'The Very Long Name Of A Restaurant {#var#} <b>X</b> That Never Ends' } });
        const name = t.replace('Your OTP for ', '').replace(' is 111111. Valid for 5 minutes. Do not share it.', '');
        assert.ok(name.length <= 30, name);
        assert.ok(!/[{}#<>]/.test(name), name);
    });
    test('no shop (the superadmin login) still reads well', () => {
        assert.match(otpText({ otp: '222222', tenant: null }), /^Your OTP for .+ is 222222\./);
    });
});
