require('./helpers/env');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { check } = require('../scripts/checkRequires');

test('B16: every relative require() has the exact file name case', () => {
    assert.deepEqual(check(), []);
});