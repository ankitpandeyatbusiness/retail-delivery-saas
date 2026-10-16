const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { orderSpeech, orderSpeechHi, MAX_ITEMS } = require('../src/utils/orderSpeech');

const line = (name, quantity, extra = {}) => ({ name, quantity, ...extra });

describe('orderSpeech', () => {
    test('reads the items, the total and the payment', () => {
        const s = orderSpeech({
            orderType: 'delivery',
            items: [
                line('Butter Naan', 2),
                line('Laccha Paratha', 1),
                line('Paneer Butter Masala', 1, { selections: [{ groupName: 'Size', name: 'Full' }] }),
            ],
            pricing: { total: 540 },
            payment: { method: 'cod' },
        });
        assert.equal(
            s,
            'New order. 2 Butter Naan, 1 Laccha Paratha, 1 Paneer Butter Masala, Full. Total 540 rupees. Cash on delivery.',
        );
    });

    test('a long order is shortened', () => {
        const items = Array.from({ length: MAX_ITEMS + 3 }, (_, i) => line(`Dish ${i}`, 1));
        const s = orderSpeech({ orderType: 'delivery', items, pricing: { total: 100 }, payment: { method: 'cod' } });
        assert.match(s, /and 3 more items\./);
        assert.ok(!s.includes(`Dish ${MAX_ITEMS}`));
    });

    test('pickup, paid online, and an item sold by weight', () => {
        const s = orderSpeech({
            orderType: 'pickup',
            items: [line('Basmati Rice', 1, { measure: { qty: 500, unit: 'g', label: '500 grams' } })],
            pricing: { total: 80.4 },
            payment: { method: 'upi', status: 'paid' },
        });
        assert.equal(s, 'New pickup order. 500 grams Basmati Rice. Total 80 rupees. Paid online.');
    });

    test('symbols in a dish name are not read out', () => {
        const s = orderSpeech({ orderType: 'delivery', items: [line('Roll (Egg) #1 *special*', 1)], pricing: { total: 50 }, payment: { method: 'cod' } });
        assert.ok(!/[#*()]/.test(s));
    });

    test('the Hindi sentence has the same items, total and payment', () => {
        const s = orderSpeechHi({
            orderType: 'delivery',
            items: [line('Butter Naan', 2), line('Paneer Butter Masala', 1, { selections: [{ name: 'Full' }] })],
            pricing: { total: 540 },
            payment: { method: 'cod' },
        });
        assert.equal(s, 'नया ऑर्डर। 2 Butter Naan, 1 Paneer Butter Masala, Full। कुल 540 रुपये। कैश ऑन डिलीवरी।');
    });

    test('a long order is shortened in Hindi too, and pickup / online are said', () => {
        const items = Array.from({ length: MAX_ITEMS + 2 }, (_, i) => line(`Dish ${i}`, 1));
        const s = orderSpeechHi({ orderType: 'pickup', items, pricing: { total: 90 }, payment: { method: 'upi', status: 'paid' } });
        assert.match(s, /और 2 आइटम/);
        assert.match(s, /पिकअप/);
        assert.match(s, /ऑनलाइन/);
    });

    test('never throws on a half-empty order', () => {
        assert.equal(orderSpeech({}), 'New order.');
        assert.equal(orderSpeechHi({}), 'नया ऑर्डर।');
    });
});
