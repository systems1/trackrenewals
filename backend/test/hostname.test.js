const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeHostname } = require('../src/utils/hostname');

test('strips scheme + trailing slash → bare domain', () => {
  assert.strictEqual(normalizeHostname('https://yahoo.com/'), 'yahoo.com');
});

test('strips http scheme', () => {
  assert.strictEqual(normalizeHostname('http://yahoo.com'), 'yahoo.com');
});

test('keeps www subdomain', () => {
  assert.strictEqual(normalizeHostname('www.yahoo.com'), 'www.yahoo.com');
  assert.strictEqual(normalizeHostname('https://www.yahoo.com/'), 'www.yahoo.com');
});

test('strips path, query and fragment', () => {
  assert.strictEqual(normalizeHostname('https://www.yahoo.com/news/world?q=1#top'), 'www.yahoo.com');
});

test('strips port', () => {
  assert.strictEqual(normalizeHostname('yahoo.com:443'), 'yahoo.com');
  assert.strictEqual(normalizeHostname('https://yahoo.com:8443/x'), 'yahoo.com');
});

test('strips userinfo', () => {
  assert.strictEqual(normalizeHostname('https://user:pass@yahoo.com/'), 'yahoo.com');
});

test('lowercases uppercase hosts', () => {
  assert.strictEqual(normalizeHostname('YAHOO.COM'), 'yahoo.com');
  assert.strictEqual(normalizeHostname('WWW.YAHOO.COM.'), 'www.yahoo.com');
});

test('trims surrounding whitespace', () => {
  assert.strictEqual(normalizeHostname('  yahoo.com  '), 'yahoo.com');
});

test('strips fully-qualified trailing dot', () => {
  assert.strictEqual(normalizeHostname('yahoo.com.'), 'yahoo.com');
});

test('handles bare domain without scheme', () => {
  assert.strictEqual(normalizeHostname('yahoo.com'), 'yahoo.com');
  assert.strictEqual(normalizeHostname('sub.domain.example.com'), 'sub.domain.example.com');
});

test('keeps IP addresses', () => {
  assert.strictEqual(normalizeHostname('https://192.168.0.1/x'), '192.168.0.1');
});

test('returns null for empty / whitespace / garbage', () => {
  assert.strictEqual(normalizeHostname(null), null);
  assert.strictEqual(normalizeHostname(''), null);
  assert.strictEqual(normalizeHostname('   '), null);
  assert.strictEqual(normalizeHostname('foo bar'), null);
});