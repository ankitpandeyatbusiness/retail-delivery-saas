// Texts the SERVER sends for the owner's Download your data screen and for the customer's Alerts screen. The screens show them through tr(text),
// but a text that arrives from the server is not in the code, so it is listed here for the translation tools (scripts/i18nKeys.js) to find.
// Nothing calls this list.
import { tr } from './index';

export const SERVER_TEXTS = () => [
    // the exports: titles, groups, hints, detail levels, periods
    tr('Customers'), tr('Cooks and waiters'), tr('Riders'), tr('Orders'), tr('Rent bills'), tr('Complaints'), tr('Menu items'), tr('My shops and branches'), tr('My costs'),
    tr('People'), tr('Orders and money'), tr('Shop data'), tr('My business'),
    tr('Who ordered from which shop, how much, how often, and what they like. Everything adds a plain-words summary of each customer.'),
    tr('The kitchen and floor staff of each shop, and what the cooks have handled.'),
    tr('The riders of each shop and how many deliveries they did.'),
    tr('Every order with its money, from a few columns to the whole story and a sheet of dishes.'),
    tr('Your monthly rent bills from the platform, with GST and payment details.'),
    tr('What customers complained about and how it ended.'),
    tr('Every dish of the chosen shops with price and how well it sells.'),
    tr('Each shop or branch of yours: sales, orders, rent, team size and how it is doing.'),
    tr('What you wrote down as costs of the shop (ingredients, salaries, rent...).'),
    tr('Quick'), tr('Standard'), tr('Everything'),
    tr('Joined between'), tr('Ordered between'), tr('Issued between'), tr('Raised between'), tr('Added between'), tr('Spent between'),
    // the filters of the exports
    tr('Who'), tr('At least'), tr('Status'), tr('Order type'), tr('Paid by'), tr('Payment'), tr('Kind'), tr('Role'), tr('Duty'), tr('Shown to customers'), tr('Food'), tr('Shop'),
    tr('Everyone'), tr('Has ordered'), tr('Never ordered'), tr('Quiet for 30+ days'), tr('Blocked'), tr('Any orders'), tr('2 orders'), tr('5 orders'), tr('10 orders'),
    tr('New'), tr('Accepted'), tr('Preparing'), tr('Ready'), tr('On the way'), tr('Delivered'), tr('Cancelled'), tr('Not delivered'),
    tr('Every type'), tr('Delivery'), tr('Pickup'), tr('Dine-in'), tr('Cash'), tr('Card'), tr('Wallet'), tr('Paid'), tr('Pending'), tr('Failed'), tr('Refunded'),
    tr('Void'), tr('Overdue'), tr('Monthly'), tr('Custom'), tr('Open'), tr('In progress'), tr('Resolved'), tr('Both'), tr('Cooks'), tr('Waiters'),
    tr('Active'), tr('Paused by the owner'), tr('On duty now'), tr('Off duty'), tr('Yes'), tr('Hidden'), tr('Veg'), tr('Non-veg'), tr('Suspended'),
    // the customer's alert groups
    tr('Order updates'), tr('Your order was accepted, is on the way, a delivery partner is at your door, or the shop sent a note about it.'),
    tr('Pickup orders'), tr('Your food is waiting, the shop answered your pickup time, or asked about your pickup.'),
    tr('Table and dining'), tr('Friends joining your table, a shared bill paid, your bill is ready, or the table is free again.'),
    tr('Table bookings'), tr('A reminder before your booking, your payment, a table that came free, or a booking the shop changed.'),
    tr('Bulk orders'), tr('A quote, a confirmation, the stages of your bulk order, a refund, or the shop declined.'),
    tr('Service inquiries'), tr('The shop answered your inquiry, or it was closed or opened again.'),
    tr('Refunds and dues'), tr('A refund is on its way, an amount you owe was cleared or rejected, or a reminder to pay.'),
    tr('Complaint answers'), tr('The shop decided on your complaint.'),
    tr('Offers and rewards'), tr('A message or an offer from the shop, points that arrived, and referral rewards.'),
];
