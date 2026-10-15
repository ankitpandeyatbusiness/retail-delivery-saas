// Dummy content for the live phone preview. Nothing here is the shop's real data: it only has to look like a menu.
// The shop's real name, colours and every setting come from the config that is being edited.

export const CATEGORIES = [
    { id: 'biryani', name: 'Biryani', emoji: '🍛' },
    { id: 'burgers', name: 'Burgers', emoji: '🍔' },
    { id: 'pizza', name: 'Pizza', emoji: '🍕' },
    { id: 'starters', name: 'Starters', emoji: '🍟' },
    { id: 'desserts', name: 'Desserts', emoji: '🍰' },
    { id: 'drinks', name: 'Drinks', emoji: '🥤' },
];

export const DISHES = [
    { id: 1, cat: 'biryani', name: 'Chicken Dum Biryani', price: 249, mrp: 299, veg: false, rating: 4.6, mins: 25, emoji: '🍛', best: true, desc: 'Slow-cooked basmati rice layered with tender chicken, saffron and fried onions.' },
    { id: 2, cat: 'biryani', name: 'Paneer Tikka Biryani', price: 229, mrp: 229, veg: true, rating: 4.4, mins: 22, emoji: '🍛', best: false, desc: 'Fragrant rice with smoky paneer tikka and mint raita.' },
    { id: 3, cat: 'burgers', name: 'Crispy Chicken Burger', price: 159, mrp: 189, veg: false, rating: 4.3, mins: 15, emoji: '🍔', best: true, desc: 'Crunchy fried chicken, lettuce and house sauce in a toasted bun.' },
    { id: 4, cat: 'burgers', name: 'Veg Supreme Burger', price: 129, mrp: 129, veg: true, rating: 4.1, mins: 15, emoji: '🍔', best: false, desc: 'Aloo-corn patty, cheese slice and tangy mayo.' },
    { id: 5, cat: 'pizza', name: 'Margherita Pizza', price: 199, mrp: 249, veg: true, rating: 4.5, mins: 20, emoji: '🍕', best: true, desc: 'Classic tomato, fresh mozzarella and basil on a thin crust.' },
    { id: 6, cat: 'starters', name: 'Peri Peri Fries', price: 99, mrp: 119, veg: true, rating: 4.2, mins: 10, emoji: '🍟', best: false, desc: 'Hot, crisp fries tossed in peri peri seasoning.' },
    { id: 7, cat: 'desserts', name: 'Chocolate Lava Cake', price: 119, mrp: 119, veg: true, rating: 4.7, mins: 12, emoji: '🍰', best: true, desc: 'Warm cake with a molten chocolate centre.' },
    { id: 8, cat: 'drinks', name: 'Cold Coffee', price: 89, mrp: 99, veg: true, rating: 4.4, mins: 8, emoji: '🥤', best: false, desc: 'Chilled, creamy and just sweet enough.' },
];

export const BANNERS = [
    { title: 'Weekend feast', sub: 'Flat 20% off on all biryanis' },
    { title: 'Free delivery', sub: 'On orders above ₹399' },
    { title: 'New: Lava cake', sub: 'Warm, gooey and worth it' },
];

export const OFFERS = [
    { code: 'WELCOME50', value: '50%', desc: '50% off up to ₹100', min: 199 },
    { code: 'FREEDEL', value: '₹40', desc: 'Free delivery on your order', min: 299 },
    { code: 'SWEET20', value: '20%', desc: '20% off on desserts', min: 149 },
];

export const ORDERS = {
    live: { no: 2481, step: 2, items: '2 × Chicken Dum Biryani, 1 × Cold Coffee', eta: 20, total: 587 },
    past: [
        { no: 2476, date: 'Yesterday, 8:42 PM', items: 'Margherita Pizza, Peri Peri Fries', total: 298, status: 'Delivered' },
        { no: 2455, date: '12 Oct, 1:15 PM', items: 'Crispy Chicken Burger × 2', total: 318, status: 'Delivered' },
    ],
};

export const STEPS = ['Placed', 'Accepted', 'Preparing', 'On the way', 'Delivered'];

export const USER = { name: 'Aarav Sharma', phone: '+91 98765 43210', email: 'aarav@example.com' };
