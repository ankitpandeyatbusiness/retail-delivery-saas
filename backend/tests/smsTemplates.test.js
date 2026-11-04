require('./helpers/env');
// The SMS texts that name the shop: the shop name is filled in for every shop, and each text matches what is registered on DLT.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const sms = require('../src/notifications/templates/sms');

describe('SMS templates with the shop name', () => {
    test('delivery PIN names the shop, the order and the PIN', () => {
        const t = sms.build('delivery_pin', { shop: 'Savera Restaurant', orderNo: 'SAV-1042', pin: '5821' });
        assert.equal(t.text, 'Your Savera Restaurant delivery PIN for order #SAV-1042 is 5821. Tell it to the delivery partner at your door.');
    });
    test('rider help names the rider, the shop and the phone', () => {
        const t = sms.build('rider_sos', { riderName: 'Ramesh', shop: 'Savera Andheri', phone: '9876543210' });
        assert.equal(t.text, 'Rider Ramesh of Savera Andheri pressed the help button. Call him now on 9876543210.');
    });
    test('bill issued, bill overdue and shop paused all carry the shop name', () => {
        assert.match(sms.build('bill_issued', { invoiceNo: 'SUB/26-27/0001', amount: '1180', shop: 'Savera', date: '10 Nov' }).text, /for Savera\./);
        assert.match(sms.build('bill_overdue', { amount: '1770', shop: 'Savera' }).text, /overdue for Savera\./);
        assert.match(sms.build('shop_paused', { shop: 'Savera' }).text, /Your shop Savera is paused/);
    });
    test('a long shop name is cut to the 30 characters a DLT variable allows', () => {
        const t = sms.build('shop_paused', { shop: 'A'.repeat(60) });
        assert.ok(t.text.includes('A'.repeat(30)) && !t.text.includes('A'.repeat(31)));
    });
});
