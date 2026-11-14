import test from 'node:test';
import assert from 'node:assert/strict';
import { loadShared } from '../scripts/load-shared.mjs';

const RW = loadShared();

test('baseDomain handles common and multi-part suffixes', () => {
  assert.equal(RW.baseDomain('www.example.com'), 'example.com');
  assert.equal(RW.baseDomain('a.b.c.example.com'), 'example.com');
  assert.equal(RW.baseDomain('shop.example.co.uk'), 'example.co.uk');
  assert.equal(RW.baseDomain('user.github.io'), 'user.github.io');
  assert.equal(RW.baseDomain('d1234.cloudfront.net'), 'd1234.cloudfront.net');
  assert.equal(RW.baseDomain('localhost'), 'localhost');
  assert.equal(RW.baseDomain('192.168.0.1'), '192.168.0.1');
  assert.equal(RW.baseDomain('EXAMPLE.com.'), 'example.com');
});

test('hostFromUrl only accepts http(s)', () => {
  assert.equal(RW.hostFromUrl('https://News.Example.com/a?b'), 'news.example.com');
  assert.equal(RW.hostFromUrl('chrome://extensions'), '');
  assert.equal(RW.hostFromUrl('file:///etc/passwd'), '');
  assert.equal(RW.hostFromUrl('javascript:alert(1)'), '');
  assert.equal(RW.hostFromUrl('not a url'), '');
});

test('isValidDomain', () => {
  for (const ok of ['example.com', 'a-b.example.co.uk', 'localhost', '10.0.0.1', 'xn--bcher-kva.example']) assert.ok(RW.isValidDomain(ok), ok);
  for (const bad of ['', 'com', '-a.com', 'a-.com', 'a..com', 'a b.com', 'exa_mple.com', '*.example.com', '[::1]', 'a.123']) assert.ok(!RW.isValidDomain(bad), bad);
});

test('hostInSet walks parent domains', () => {
  const set = new Set(['doubleclick.net', 'mc.yandex.ru']);
  assert.ok(RW.hostInSet('securepubads.g.doubleclick.net', set));
  assert.ok(RW.hostInSet('mc.yandex.ru', set));
  assert.ok(!RW.hostInSet('yandex.ru', set));
  assert.ok(!RW.hostInSet('notdoubleclick.net', set));
});

test('entity groups and breakage guards', () => {
  assert.ok(RW.sameEntity('facebook.com', 'fbcdn.net'));
  assert.ok(!RW.sameEntity('facebook.com', 'google.com'));
  assert.ok(RW.isNeverRestrict('js.stripe.com'));
  assert.ok(RW.isNeverRestrict('www.google.com'));
  assert.ok(RW.isCookieBlockCapped('cdn.jsdelivr.net'));
  assert.ok(RW.isBenignCookieName('__cf_bm'));
  assert.ok(RW.isBenignCookieName('incap_ses_123_456'));
  assert.ok(!RW.isBenignCookieName('_ga'));
});
