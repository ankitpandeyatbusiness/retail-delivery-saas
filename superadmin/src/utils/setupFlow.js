// The guided setup of a new shop: the settings screens, one after another, each with its own Skip and Save and next. (Nothing new to learn:
// they are the same screens you use later to change a setting.) Also where each "set-up check" line is fixed.
export const SETUP_STEPS = [
    { screen: 'SettingsHours', title: 'Opening hours', hint: 'Which days and hours the shop takes orders. Without hours the shop is always open.' },
    { screen: 'SettingsOrders', title: 'Orders and fees', hint: 'Delivery, pickup or dine in, payments, minimum order, delivery fee, GST, tips.' },
    { screen: 'SettingsFeatures', title: 'App features', hint: 'Switches: veg filter, favourites, scheduled orders, services, table booking, bulk orders and more.' },
    { screen: 'SettingsDineIn', title: 'Dine in, pickup and staff', hint: 'Tables, pickup rules, and the kitchen and waiter screens.' },
    { screen: 'SettingsRiders', title: 'Riders and delivery', hint: 'How riders are chosen and paid, the delivery PIN, live tracking, rider cash limit.' },
    { screen: 'SettingsMenuOffers', title: 'Menu and offers', hint: 'Sold-out dishes, grouping by category, coupons.' },
    { screen: 'SettingsBrand', title: 'Brand and look', hint: 'Colours, fonts, button shape, animations.' },
    { screen: 'SettingsHome', title: 'Home layout', hint: 'What the customer app\'s home screen shows, and in which order.' },
    { screen: 'SettingsTabs', title: 'Bottom tabs', hint: 'Which tabs the customer app has at the bottom.' },
    { screen: 'SettingsApp', title: 'App version and alerts', hint: 'Oldest app version allowed, SMS alerts, the monthly progress report.' },
];

// open step i of the guided setup (or, after the last one, the set-up check)
export function goSetupStep(nav, shopId, name, i, replace = true) {
    const go = replace ? nav.replace.bind(nav) : nav.navigate.bind(nav);
    if (i >= SETUP_STEPS.length) { go('ShopReadiness', { shopId, name }); return; }
    go(SETUP_STEPS[i].screen, { shopId, name, setup: { i } });
}

// where a "set-up check" line is fixed: [screen, params kind]
export const FIX_SCREEN = {
    logo: 'ShopBranding', hero: 'ShopBranding', contact: 'ShopEdit', location: 'ShopEdit', menu: 'ShopMenu', hours: 'SettingsHours',
    owner: 'ShopOwners', rider: 'ShopRiders', payments: 'ShopPayments', business: 'ShopEdit', package: 'ShopEdit', live: 'ShopBilling',
};
