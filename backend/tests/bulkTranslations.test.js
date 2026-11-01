require('./helpers/env');
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const i18n = require('../src/notifications/i18n');
const texts = require('../src/notifications/templates/texts');
const hiVoice = require('../src/notifications/templates/textsHi');

// Every push and inbox text of a bulk order must come out in the person's language, with its values (order code, amounts, names) kept.
// "Translated" is checked by looking for English words left over: only the values the server puts in may stay in Latin letters.
const LANGS = ['hi', 'bho', 'mr', 'gu', 'bn'];
const CODE = 'B7K2QX';
const left = (s, allowed) => (s.replace(new RegExp(allowed.join('|'), 'g'), '').match(/[A-Za-z]{3,}/g) || []);

// [event, values, the values that must survive, the values that are allowed to stay in Latin letters]
const CASES = [
    ['bulk_new', { code: CODE, name: 'Anil', total: 10000, when: '2026-11-20' }, ['B7K2QX', 'Anil', '10000', '2026-11-20'], [CODE, 'Anil']],
    ['bulk_new', { code: CODE, name: 'Anil', total: 8500 }, ['B7K2QX', 'Anil', '8500'], [CODE, 'Anil']],   // no date: the end of the sentence is empty
    ['bulk_change', { code: CODE, name: 'Anil' }, ['B7K2QX', 'Anil'], [CODE, 'Anil']],
    ['bulk_quoted', { code: CODE, total: 14650, advance: 7325, hours: 24 }, ['B7K2QX', '14650', '7325', '24'], [CODE]],
    ['bulk_declined', { code: CODE, reason: '' }, ['B7K2QX'], [CODE]],
    ['bulk_declined', { code: CODE, reason: 'Closed' }, ['B7K2QX', 'Closed'], [CODE, 'Closed']],
    ['bulk_paid', { code: CODE, name: 'Raj', amount: 5000 }, ['B7K2QX', 'Raj', '5000'], [CODE, 'Raj']],
    ['bulk_confirmed', { code: CODE, amount: 5000 }, ['B7K2QX', '5000'], [CODE]],
    ['bulk_cancelled', { code: CODE, name: 'Raj', kept: true }, ['B7K2QX', 'Raj'], [CODE, 'Raj']],
    ['bulk_cancelled', { code: CODE, name: 'Raj', kept: false }, ['B7K2QX', 'Raj'], [CODE, 'Raj']],
    ['bulk_refund', { code: CODE, amount: 5000 }, ['B7K2QX', '5000'], [CODE]],
    ['bulk_shop_cancelled', { code: CODE, reason: 'Oven broke', amount: 5000 }, ['B7K2QX', 'Oven broke', '5000'], [CODE, 'Oven', 'broke']],
    ['bulk_shop_cancelled', { code: CODE, amount: 5000 }, ['B7K2QX', '5000'], [CODE]],
    ['bulk_balance_paid', { code: CODE, name: 'Raj', amount: 5000 }, ['B7K2QX', 'Raj', '5000'], [CODE, 'Raj']],
    ...['preparing', 'ready', 'out_for_delivery', 'delivered'].flatMap((stage) => ['pickup', 'delivery'].flatMap((fulfilment) => [0, 5000].map((balance) => (
        ['bulk_stage', { code: CODE, stage, fulfilment, balance }, [CODE, ...(balance && stage !== 'preparing' ? ['5000'] : [])], [CODE]]
    )))),
    ['bulk_completed', { code: CODE }, [CODE], [CODE]],
];

describe('bulk order texts in every language', () => {
    for (const [event, vars, keep, allowed] of CASES) {
        test(`${event} ${JSON.stringify(vars)}`, () => {
            const t = texts.build(event, vars);
            for (const lang of LANGS) {
                const title = i18n.translate(t.title, lang);
                const body = i18n.translate(t.body, lang);
                assert.notEqual(title, t.title, `${lang} title is still English: ${t.title}`);
                assert.notEqual(body, t.body, `${lang} body is still English: ${t.body}`);
                for (const v of keep) assert.ok((`${title} ${body}`).includes(v), `${lang}: "${v}" was lost in: ${title} | ${body}`);
                assert.deepEqual(left(title, allowed), [], `${lang} title has English words left: ${title}`);
                assert.deepEqual(left(body, allowed), [], `${lang} body has English words left: ${body}`);
            }
        });
    }

    test('the owner\'s Hindi voice lines exist for the owner events', () => {
        for (const [event, vars] of [['bulk_new', { code: CODE, name: 'Anil' }], ['bulk_change', { name: 'Anil' }], ['bulk_paid', { code: CODE, name: 'Raj', amount: 5000 }], ['bulk_balance_paid', { code: CODE, name: 'Raj', amount: 5000 }], ['bulk_cancelled', { code: CODE, kept: true }]]) {
            const line = hiVoice.build(event, vars);
            assert.match(String(line), /[ऀ-ॿ]/, `${event} has no Hindi line`);
        }
    });
});
