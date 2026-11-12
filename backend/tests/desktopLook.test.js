require('./helpers/env');
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveConfig, validateSettings } = require('../src/services/tenantConfigService');

// the desktop website's own look (brand.desktop): it follows the mobile look unless the shop's panel turns "follow" off
const shop = (brand) => ({ name: 'Test shop', slug: 'test-shop', colors: { primary: '#E23744' }, settings: { brand, home: { cardStyle: 'grid' } } });

describe('desktop look', () => {
    test('a shop with no desktop settings: the desktop look is the mobile look (nothing changes by itself)', () => {
        const c = resolveConfig(shop({ categoryStyle: 'pills', locationStyle: 'chip', tabBarStyle: 'floating' }));
        assert.equal(c.brand.desk.follow, true);
        assert.equal(c.brand.desk.categoryStyle, 'pills');
        assert.equal(c.brand.desk.locationStyle, 'chip');
        assert.equal(c.brand.desk.tabBarStyle, 'floating');
        assert.equal(c.brand.desk.cardStyle, 'grid');
        assert.deepEqual(c.brand.desk.colors, c.brand.colors);
    });

    test('with follow on, the saved desktop values are kept but not used', () => {
        const c = resolveConfig(shop({ categoryStyle: 'circles', desktop: { follow: true, categoryStyle: 'tiles' } }));
        assert.equal(c.brand.desk.categoryStyle, 'circles');
    });

    test('with follow off, the desktop has its own values, and falls back to the mobile one for what is not set', () => {
        const c = resolveConfig(shop({
            categoryStyle: 'circles', locationStyle: 'card', headerStyle: 'hero',
            desktop: { follow: false, categoryStyle: 'tiles', categoryScroll: true, tabBarStyle: 'floating', cardStyle: 'big', colors: { primary: '#0D9488', primaryLight: '#2DD4BF', primaryDark: '#115E59' } },
        }));
        assert.equal(c.brand.desk.follow, false);
        assert.equal(c.brand.desk.categoryStyle, 'tiles');
        assert.equal(c.brand.desk.categoryScroll, true);
        assert.equal(c.brand.desk.tabBarStyle, 'floating');
        assert.equal(c.brand.desk.cardStyle, 'big');
        assert.equal(c.brand.desk.locationStyle, 'card');   // not set on desktop: the mobile one
        assert.equal(c.brand.desk.headerStyle, 'hero');
        assert.equal(c.brand.desk.colors.primary, '#0D9488');
        assert.equal(c.brand.colors.primary, '#E23744');    // the mobile colours are untouched
        assert.equal(c.brand.categoryStyle, 'circles');
    });

    test('bad desktop values are refused', () => {
        const bad = validateSettings({ brand: { desktop: { follow: 'yes', categoryStyle: 'nope', colors: { primary: 'red' } } } });
        assert.ok(bad.errors.length >= 3);
        const worse = validateSettings({ brand: { desktop: { shiny: true } } });
        assert.ok(worse.errors.length >= 1);
        const ok = validateSettings({ brand: { desktop: { follow: false, categoryStyle: 'pills', cardStyle: 'compact', colors: { primary: '#112233' } } } });
        assert.equal(ok.errors.length, 0);
        assert.equal(ok.clean.brand.desktop.categoryStyle, 'pills');
    });
});
