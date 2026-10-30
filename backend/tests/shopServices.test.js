require('./helpers/env');
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const svc = require('../src/services/shopServices');

describe('shop services', () => {
    test('every starter kind comes with its recommended questions', () => {
        for (const kind of ['bulk', 'tiffin', 'party', 'other']) {
            const d = svc.newDoc(kind);
            assert.ok(d.questions.length >= 3, kind);
            assert.ok(d.questions.every((q) => q.recommended && svc.TYPES.includes(q.type)), kind);
        }
        assert.equal(svc.newDoc('custom').kind, 'custom');
        assert.deepEqual(svc.newDoc('custom').questions.map((q) => q.id), svc.recommendedFor('other').map((q) => q.id));
    });

    test('an owner can add any number of his own questions and the server gives them unique ids', () => {
        const many = Array.from({ length: 40 }, (_, i) => ({ type: 'text', label: `Q${i}` }));
        const out = svc.cleanQuestions(many);
        assert.equal(new Set(out.map((q) => q.id)).size, 40);
        assert.ok(out.every((q) => q.recommended === false));
    });

    test('bad questions are refused', () => {
        assert.throws(() => svc.cleanQuestions([{ type: 'nope', label: 'x' }]), /Unknown question type/);
        assert.throws(() => svc.cleanQuestions([{ type: 'text', label: '  ' }]), /words/);
        assert.throws(() => svc.cleanQuestions([{ type: 'choice', label: 'Pick', options: ['only one'] }]), /two choices/);
    });

    test('answers are checked against the questions', () => {
        const s = { priceType: 'per_plate', price: 1000, questions: svc.newDoc('bulk').questions };
        const ok = svc.checkAnswers(s, { date: '2026-11-01', plates: 30, diet: 'Veg' });
        assert.equal(ok.guests, 30);
        assert.equal(svc.estimateFor(s, ok.guests), 30000);
        assert.throws(() => svc.checkAnswers(s, { plates: 30 }), /Which date/);
        assert.throws(() => svc.checkAnswers(s, { date: '2026-11-01', plates: 30, diet: 'Jain' }), /pick one/);
        assert.throws(() => svc.checkAnswers(s, { date: '1 Nov', plates: 30 }), /pick a date/);
    });

    test('a switched-off question is never asked', () => {
        const qs = svc.newDoc('bulk').questions.map((q) => (q.id === 'date' ? { ...q, enabled: false } : q));
        assert.equal(svc.checkAnswers({ questions: qs }, { plates: 20 }).guests, 20);
    });
});
