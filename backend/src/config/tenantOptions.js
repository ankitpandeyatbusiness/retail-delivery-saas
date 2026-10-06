// Every allowed value for every selectable setting.
// The superadmin panel reads this to draw checkboxes/dropdowns; the validator reads it to reject bad data.
// To add a new option: add it here, then handle it in tenantConfigService + the app registry.
const H = require('./homeOptions');

module.exports = {
    ...H, // SHOP_TYPES, FOOD_MODES, BLOCK_TYPES, FILTER_IDS, SORT_IDS, CARD_STYLES

    TABS: ['home', 'search', 'offers', 'orders', 'profile'],

    COLOR_KEYS: ['primary', 'primaryLight', 'primaryDark', 'background', 'text', 'error'],
    FONT_STYLES: ['modern', 'classic', 'rounded'],
    BUTTON_SHAPES: ['rounded', 'pill', 'square'],

    // on/off switches
    FEATURE_KEYS: [
        'vegToggle',            // veg-only switch on home (auto: only for mixed shops)
        'vegDot',               // green/red dot on cards (auto: only for mixed shops)
        'ratingBadge', 'prepTime', 'serves', 'calories',
        'specialInstructions',  // note box on item/cart
        'scheduleOrder',        // order for later
        'reorder', 'favourites',
        'guestBrowsing',        // "Skip" on login
        'couponField', 'tips',
    ],

    OUT_OF_STOCK: ['dim', 'hide'],

    ORDER_TYPES: ['delivery', 'pickup', 'dine_in'],
    PAYMENT_METHODS: ['cod'],
    FEE_TYPES: ['free', 'flat', 'free_above'],
    GST_MODES: ['none', 'inclusive', 'exclusive'],

    DAYS: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'],

    LANGUAGES: ['en', 'hi'],
    LABEL_KEYS: ['addButton', 'orderButton', 'emptyCart', 'emptySearch', 'closedMessage'],
};