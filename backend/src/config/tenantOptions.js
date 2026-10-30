// Every allowed value for every selectable setting.
// The superadmin panel reads this to draw checkboxes/dropdowns; the validator reads it to reject bad data.
// To add a new option: add it here, then handle it in tenantConfigService + the app registry.
const H = require('./homeOptions');

module.exports = {
    ...H, // SHOP_TYPES, FOOD_MODES, BLOCK_TYPES, FILTER_IDS, SORT_IDS, CARD_STYLES

    TABS: ['home', 'search', 'offers', 'orders', 'profile'],

    // 'accent' is the second colour: offer ribbons and highlights (the main colour stays for buttons and headers)
    COLOR_KEYS: ['primary', 'primaryLight', 'primaryDark', 'background', 'text', 'error', 'accent'],
    FONT_STYLES: ['modern', 'classic', 'rounded'],
    BUTTON_SHAPES: ['rounded', 'pill', 'square'],

    // the look of the customer app. 'bold' is the original brand-gradient look (the default, so existing shops do not change);
    // the others set the background, card and text colours and let the brand colour be an accent.
    // Two separate choices: the theme the customer sees in LIGHT mode and the one in DARK mode.
    LIGHT_LOOKS: ['bold', 'fresh', 'cream', 'mist'],
    DARK_LOOKS: ['midnight', 'charcoal', 'black', 'slate'],
    LOOKS: ['bold', 'fresh', 'cream', 'mist', 'midnight', 'charcoal', 'black', 'slate'],   // every theme: the old single "look" setting is still read
    MOTION_LEVELS: ['full', 'subtle', 'off'],        // entrance and press animations; 'off' = none
    HEADER_STYLES: ['hero', 'compact'],               // the top of the home screen
    TAB_BAR_STYLES: ['classic', 'floating'],          // bottom tabs: a flat strip, or a rounded bar that floats
    CATEGORY_STYLES: ['circles', 'tiles', 'pills'],   // how the category row is drawn
    LOCATION_STYLES: ['card', 'list', 'chip', 'banner'],   // how the shop's address and Directions button are drawn
    FILTER_STYLES: ['dialog', 'sheet', 'rail'],       // the filters: a centred dialog, a bottom sheet, or a bottom sheet with a side list of sections

    // on/off switches
    FEATURE_KEYS: [
        'vegToggle',            // veg-only switch on home (auto: only for mixed shops)
        'vegDot',               // green/red dot on cards (auto: only for mixed shops)
        'ratingBadge', 'prepTime', 'serves', 'calories',
        'specialInstructions',  // note box on item/cart
        'scheduleOrder',        // order for later
        'reorder', 'favourites',
        'guestBrowsing',        // "Skip" on login
        'directions',           // the shop's address and a Directions button (Google Maps) when the shop is pinned on the map
        'couponField', 'tips',
        'services', 'tableBooking',   // add-ons: off until the super admin switches them on for a shop (services/featureGate.js)
    ],

    OUT_OF_STOCK: ['dim', 'hide'],

    ORDER_TYPES: ['delivery', 'pickup', 'dine_in'],
    PAYMENT_METHODS: ['cod'],
    FEE_TYPES: ['free', 'flat', 'free_above', 'distance'],
    GST_MODES: ['none', 'inclusive', 'exclusive'],

    DAYS: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'],

    ASSIGN_MODES: ['automatic', 'manual'],   // how riders are picked for delivery orders

    LANGUAGES: ['en', 'hi'],
    LABEL_KEYS: ['addButton', 'orderButton', 'emptyCart', 'emptySearch', 'closedMessage'],
};