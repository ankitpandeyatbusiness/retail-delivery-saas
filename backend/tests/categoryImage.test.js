require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const pic = require('../src/services/categoryImage');

// The picture a category shows: its own, a dish's (never empty while any dish has one), or '' (the app then draws the big first letter).
test('automatic: its own picture first, then a dish, then the letter', () => {
    assert.equal(pic.effective({ image: 'own.jpg' }, 'dish.jpg'), 'own.jpg');
    assert.equal(pic.effective({ image: '' }, 'dish.jpg'), 'dish.jpg');
    assert.equal(pic.effective({ imageSource: 'auto' }, undefined), '');
    assert.equal(pic.needsDish({ image: 'own.jpg' }), false);
    assert.equal(pic.needsDish({}), true);
});

test('my own picture: never a dish picture', () => {
    assert.equal(pic.effective({ imageSource: 'own', image: 'own.jpg' }, 'dish.jpg'), 'own.jpg');
    assert.equal(pic.effective({ imageSource: 'own' }, 'dish.jpg'), '');   // none of its own: the letter
    assert.equal(pic.needsDish({ imageSource: 'own' }), false);
});

test('a dish picture: the dish first, then its own, then the letter', () => {
    assert.equal(pic.effective({ imageSource: 'dish', image: 'own.jpg' }, 'dish.jpg'), 'dish.jpg');
    assert.equal(pic.effective({ imageSource: 'dish', image: 'own.jpg' }, undefined), 'own.jpg');   // no dish has a picture: its own, so it is not empty
    assert.equal(pic.effective({ imageSource: 'dish' }, undefined), '');
    assert.equal(pic.needsDish({ imageSource: 'dish', image: 'own.jpg' }), true);
});

test('only the three choices are accepted', () => {
    assert.deepEqual(pic.SOURCES, ['auto', 'own', 'dish']);
});
