// The demo tutorial: short stories, each about one person doing one job. Used by the private demo login and the public demo website.
// A story has 6 to 8 short steps. A step has a text, and may have:
//   target: the id of a button on the screen (<CoachTarget id="...">): it is circled, and tapping it moves the story on by itself
// A story has a panel: the person it is about. If the demo is not showing that panel, the step card offers one tap to become that person.
// The texts are plain English here; the screen translates them (tr). Characters: Aarav (customer), Meera (cook), Ravi (rider),
// Sunil (waiter), Seema (shop owner).
export const FULL_TOUR_ID = 'tour';

export const STORIES = [
    {
        id: 'tour', title: 'Full tour', who: 'A quick look at everything', min: 2, panel: 'customer', icon: 'compass',
        steps: [
            { text: 'Welcome! This is a real shop app, filled with pretend data. In two minutes you will see how a shop works from every side.' },
            { text: 'Customers browse the menu, add dishes and place an order. Tap the Add button on a dish to start.', target: 'add-item' },
            { text: 'The order goes to the shop owner, who accepts it. The cook makes the food and a delivery partner brings it.' },
            { text: 'The customer watches the order and the rider on a live map, and pays cash or online at the door.' },
            { text: 'The owner sees every order, the money, the team and the reports in one place.' },
            { text: 'Tap the Demo button at the top any time to become the Owner, Cook, Waiter or Rider, or to open another story.' },
        ],
    },
    {
        id: 'order', title: 'Order your first meal', who: 'Aarav, a customer', min: 2, panel: 'customer', icon: 'restaurant',
        steps: [
            { text: 'Aarav is hungry. He opens the shop app and sees the menu, the offers and the bestsellers.' },
            { text: 'He finds a dish he likes and taps Add.', target: 'add-item' },
            { text: 'The cart shows at the bottom. He opens it to check the dishes and the bill.' },
            { text: 'He picks his address, and a payment method: cash on delivery or online.' },
            { text: 'He applies a coupon, for example FIRST50, and sees the new total.' },
            { text: 'He taps Place order. The shop gets it at once.' },
            { text: 'That is all. Open the next story to follow his order live.' },
        ],
    },
    {
        id: 'follow', title: 'Follow it live', who: 'Aarav, a customer', min: 2, panel: 'customer', icon: 'navigate',
        steps: [
            { text: 'After ordering, Aarav opens the Orders tab. His order is at the top.' },
            { text: 'The steps move by themselves: accepted, being cooked, out for delivery.' },
            { text: 'When the rider picks it up, a map opens. The rider pin moves towards his door.' },
            { text: 'The time left changes as the rider moves. Aarav can call the rider with one tap.' },
            { text: 'The rider reaches the door and gives the delivery code. The order is delivered.' },
            { text: 'Aarav rates the food and the delivery. The shop sees it at once.' },
        ],
    },
    {
        id: 'owner', title: 'Run your shop: a new order', who: 'Seema, the shop owner', min: 3, panel: 'owner', icon: 'storefront',
        steps: [
            { text: 'Seema owns the shop. A new order makes a sound and shows on her Home and Orders screens.' },
            { text: 'She taps Accept. The customer is told at once, and the kitchen sees it.', target: 'accept-order' },
            { text: 'The cook marks the food ready. For delivery, a rider is offered the order.' },
            { text: 'She can see where every rider is, how long each order has waited, and who is late.' },
            { text: 'The Money tab shows today\'s sales, cash to collect and what the shop earned.' },
            { text: 'The alert slider and the voice read each new order aloud, in her language.' },
            { text: 'Open the Cook and Rider stories to see their side.' },
        ],
    },
    {
        id: 'cook', title: 'The kitchen', who: 'Meera, the cook', min: 2, panel: 'cook', icon: 'flame',
        steps: [
            { text: 'Meera is the cook. She sees only what she needs: the orders to make, oldest first.' },
            { text: 'A new order waits in To start. She taps Start cooking.', target: 'start-cooking' },
            { text: 'When the food is done she taps Ready. The rider or the waiter is told.' },
            { text: 'Late orders are marked, so nothing is forgotten in a busy hour.' },
            { text: 'She can go off duty for a break, and the owner is told.' },
        ],
    },
    {
        id: 'rider', title: 'A day on the road', who: 'Ravi, the delivery partner', min: 3, panel: 'rider', icon: 'bicycle',
        steps: [
            { text: 'Ravi delivers for one shop. He starts duty, and the shop can now send him orders.' },
            { text: 'An offer pops up with the pay and the distance. He taps Accept.' },
            { text: 'At the shop he picks up the food and the trip starts. The customer sees his pin on the map.' },
            { text: 'At the door he asks for the customer\'s 4 digit code. Cash orders: he collects the money, or the customer pays by QR.' },
            { text: 'He taps Delivered. His earnings and points go up.' },
            { text: 'His Money page shows what he earned and the cash he must hand over.' },
        ],
    },
    {
        id: 'waiter', title: 'Serving tables', who: 'Sunil, the waiter', min: 2, panel: 'waiter', icon: 'cafe',
        steps: [
            { text: 'Sunil is the waiter. Guests scan the QR on their table and order from their own phone.' },
            { text: 'When a dish is ready, Sunil is told which table needs it.' },
            { text: 'He serves it and taps Served. The guest sees it too.' },
            { text: 'Guests can call the waiter or ask for the bill from their phone.' },
            { text: 'The table bill is paid on the phone or in cash, and the table is free again.' },
        ],
    },
    {
        id: 'book', title: 'Tables, services and bulk orders', who: 'Aarav, a customer', min: 3, panel: 'customer', icon: 'calendar',
        steps: [
            { text: 'Aarav wants a table for the weekend. He opens Book a table.' },
            { text: 'Like a cinema, he picks the day, the time and the exact table. A small deposit holds it.' },
            { text: 'For a party he opens Services and sends an inquiry. The owner replies in a chat.' },
            { text: 'For 40 people he places a Bulk order. The owner sends a price and he pays an advance.' },
            { text: 'Seema sees every booking, inquiry and bulk order in her own list.' },
        ],
    },
    {
        id: 'points', title: 'Points, coupons and reviews', who: 'Aarav, a customer', min: 2, panel: 'customer', icon: 'gift',
        steps: [
            { text: 'Aarav earns points on every order. They show in his Account.' },
            { text: 'He spends points to pay less on the next order.' },
            { text: 'Coupons show on the Home screen and in the cart. He picks the best one.' },
            { text: 'After delivery he rates each dish with stars and a few words.' },
            { text: 'If something went wrong, he can send a complaint with a photo. The owner replies.' },
        ],
    },
    {
        id: 'menu', title: 'Menu, offers and your team', who: 'Seema, the shop owner', min: 3, panel: 'owner', icon: 'restaurant',
        steps: [
            { text: 'Seema opens the Menu tab. Dishes, photos, prices and sizes are all hers to change.' },
            { text: 'When something runs out she switches it off. Customers see it as sold out.' },
            { text: 'She makes offers: coupons, banners and meal deals.' },
            { text: 'In Team she adds cooks, waiters and riders with just a phone number.' },
            { text: 'The shop timings, delivery area and charges are in Settings.' },
        ],
    },
    {
        id: 'brand', title: 'Many shops, one brand', who: 'Seema, the shop owner', min: 2, panel: 'owner', icon: 'git-branch',
        steps: [
            { text: 'Seema now has three shops: Demo Shop, City Centre and Mall Road. They are one brand.' },
            { text: 'One sign in opens every shop. She switches shop from the top of her Home screen.' },
            { text: 'The All shops page shows sales and orders of every shop together.' },
            { text: 'A menu change can be sent to all shops with one tap. Customers pick their nearest shop.' },
        ],
    },
    {
        id: 'language', title: 'Alerts in your language', who: 'Seema, the shop owner', min: 2, panel: 'owner', icon: 'language',
        steps: [
            { text: 'The whole app can be used in English, Hindi, Bhojpuri, Marathi, Gujarati and Bengali.' },
            { text: 'Each person chooses their own language. Notifications arrive in it.' },
            { text: 'The Soundbox reads every new order aloud in Hindi, Marathi, Gujarati or Bengali, even with a noisy kitchen.' },
            { text: 'Every alert has four switches: sound, notification, voice and the loud slider.' },
        ],
    },
];

export const storyById = (id) => STORIES.find((s) => s.id === id) || null;
