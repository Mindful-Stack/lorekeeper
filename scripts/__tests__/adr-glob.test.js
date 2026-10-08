'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { matchesGlob } = require('../adr/glob');

test('** spans segments, including none', () => {
    assert.ok(matchesGlob('src/Billing/a.cs', 'src/Billing/**'));
    assert.ok(matchesGlob('src/Billing/x/y.cs', 'src/Billing/**'));
    assert.ok(matchesGlob('src/a.cs', 'src/**/*.cs'));
    assert.ok(matchesGlob('src/x/y/a.cs', 'src/**/*.cs'));
});

test('a directory glob does not match a sibling with the same prefix', () => {
    assert.ok(!matchesGlob('src/BillingX/a.cs', 'src/Billing/**'));
});

test('* and ? stay within one segment', () => {
    assert.ok(matchesGlob('src/a.cs', 'src/*.cs'));
    assert.ok(!matchesGlob('src/x/a.cs', 'src/*.cs'));
    assert.ok(matchesGlob('a1.md', 'a?.md'));
    assert.ok(!matchesGlob('a/.md', 'a?.md'));
});

test('regex metacharacters are literal, and Windows separators normalise', () => {
    assert.ok(!matchesGlob('srcXa.cs', 'src.a.cs'));
    assert.ok(matchesGlob('src\\Billing\\a.cs', 'src/Billing/**'));
});
