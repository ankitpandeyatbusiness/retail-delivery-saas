// Shop services (bulk order, tiffin, party booking, anything the owner makes up): the starter templates, the recommended
// questions for each, and the checks for what the owner saves and what the customer sends.
const { httpError } = require('../middlewares/apiErrors');

const TYPES = ['text', 'longtext', 'number', 'date', 'time', 'yesno', 'choice', 'multichoice', 'phone', 'address', 'photo'];
const PRICE_TYPES = ['per_plate', 'fixed', 'from', 'per_month', 'quote'];
const MAX_QUESTIONS = 60;   // a safety net against a runaway client, not a product limit

const Q = (id, type, label, extra = {}) => ({ id, type, label, hint: '', required: false, enabled: true, recommended: true, options: [], ...extra });

const QUESTIONS = {
    date: (label = 'Which date?') => Q('date', 'date', label, { required: true }),
    time: () => Q('time', 'time', 'What time?'),
    guests: (label = 'How many guests?') => Q('guests', 'number', label, { required: true, min: 1, max: 5000 }),
    plates: () => Q('plates', 'number', 'How many plates?', { required: true, min: 1, max: 5000 }),
    diet: () => Q('diet', 'choice', 'Veg or non-veg?', { options: ['Veg', 'Non-veg', 'Both'] }),
    address: (label = 'Address') => Q('address', 'address', label),
    budget: () => Q('budget', 'number', 'Budget per plate (₹)', { min: 0 }),
    note: () => Q('note', 'longtext', 'Anything else we should know?'),
};

// The recommended set for each starter kind. A custom service starts from "other".
const RECOMMENDED = {
    bulk: () => [QUESTIONS.date(), QUESTIONS.time(), QUESTIONS.plates(), QUESTIONS.diet(),
        Q('delivery', 'choice', 'Delivery or pickup?', { options: ['Delivery', 'Pickup'] }), QUESTIONS.address('Delivery address'), QUESTIONS.budget()],
    tiffin: () => [QUESTIONS.date('Start date'), Q('days', 'choice', 'Days per week', { options: ['5 days', '6 days', '7 days'] }),
        Q('meals', 'multichoice', 'Which meals?', { options: ['Lunch', 'Dinner'] }), QUESTIONS.diet(),
        Q('plan', 'choice', 'Plan', { options: ['Weekly', 'Monthly'] }), QUESTIONS.address('Delivery address')],
    party: () => [QUESTIONS.date(), QUESTIONS.time(), QUESTIONS.guests(),
        Q('occasion', 'choice', 'Occasion', { options: ['Birthday', 'Anniversary', 'Family get-together', 'Other'] }), QUESTIONS.diet(),
        Q('decor', 'yesno', 'Need cake or decoration?')],
    other: () => [QUESTIONS.date(), QUESTIONS.guests('How many people?'), QUESTIONS.note()],
};

const TEMPLATES = {
    bulk: { name: 'Bulk Order Booking', icon: 'cube-outline', priceType: 'per_plate', minGuests: 20, noticeHours: 48,
        quickTexts: ['I need a bulk order for an event', 'Please share the price per plate', 'Is my date available?', 'Veg only, please'] },
    tiffin: { name: 'Tiffin Service', icon: 'restaurant-outline', priceType: 'per_month',
        quickTexts: ['I want a monthly tiffin', 'Please share the menu and price', 'Do you deliver to my area?', 'Veg only, please'] },
    party: { name: 'Restaurant Booking', icon: 'balloon-outline', priceType: 'per_plate', minGuests: 10, noticeHours: 24,
        quickTexts: ['Birthday party, please share the price', 'Is the hall free on my date?', 'Do you have a party package?', 'We need decoration and a cake'] },
    other: { name: 'Other', icon: 'sparkles-outline', priceType: 'quote',
        quickTexts: ['I have a question about this', 'Please share the price', 'Please call me back'] },
};

const STARTER_KINDS = Object.keys(TEMPLATES);
const DEFAULT_REMINDER_HOURS = 24;

// What the super admin changed for the starter kinds (PlatformSettings.servicesDefaults): { reminderHours?, kinds: { bulk: { quickTexts?, quickReplies?, questions? } } }.
// Anything he did not change is the built-in set above.
const loadDefaults = async () => (await require('../models/PlatformSettings').findById('main').select('servicesDefaults').lean())?.servicesDefaults || {};

const recommendedFor = (kind, defaults = {}) => {
    const mine = defaults.kinds?.[kind]?.questions;
    return Array.isArray(mine) && mine.length ? mine.map((q) => ({ ...q, hint: q.hint || '', options: q.options || [], recommended: true, enabled: q.enabled !== false })) : (RECOMMENDED[kind] || RECOMMENDED.other)();
};
const withDefaults = (kind, defaults) => ({ ...(TEMPLATES[kind] || {}), ...(defaults.kinds?.[kind]?.quickTexts ? { quickTexts: defaults.kinds[kind].quickTexts } : {}), ...(defaults.kinds?.[kind]?.quickReplies ? { quickReplies: defaults.kinds[kind].quickReplies } : {}) });
const templateList = (defaults = {}) => STARTER_KINDS.map((kind) => ({ kind, ...withDefaults(kind, defaults) }));
const newDoc = (kind, defaults = {}) => ({ kind: TEMPLATES[kind] ? kind : 'custom', ...withDefaults(kind, defaults), questions: recommendedFor(kind, defaults) });

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const strings = (v, max, each) => (Array.isArray(v) ? v.map((x) => str(x, each)).filter(Boolean).slice(0, max) : []);
const num = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? undefined : Number(v));

// One question, cleaned. The id of an owner's own question is made by the server so two can never clash.
function cleanQuestion(q, taken) {
    if (!q || typeof q !== 'object') throw httpError(400, 'A question is not valid');
    if (!TYPES.includes(q.type)) throw httpError(400, 'Unknown question type');
    const label = str(q.label, 200);
    if (!label) throw httpError(400, 'Every question needs its words');
    let id = /^[a-z0-9_]{1,40}$/.test(q.id || '') && !taken.has(q.id) ? q.id : '';
    if (!id) { do { id = 'q' + Math.random().toString(36).slice(2, 8); } while (taken.has(id)); }
    taken.add(id);
    const out = { id, type: q.type, label, hint: str(q.hint, 200), required: !!q.required, enabled: q.enabled !== false, recommended: !!q.recommended, options: [] };
    if (q.type === 'choice' || q.type === 'multichoice') {
        out.options = strings(q.options, 30, 80);
        if (out.options.length < 2) throw httpError(400, `"${label}" needs at least two choices`);
    }
    if (q.type === 'number') { const mn = num(q.min); const mx = num(q.max); if (mn !== undefined) out.min = mn; if (mx !== undefined) out.max = mx; }
    return out;
}

function cleanQuestions(list) {
    if (!Array.isArray(list)) throw httpError(400, 'Questions must be a list');
    if (list.length > MAX_QUESTIONS) throw httpError(400, `Too many questions (most ${MAX_QUESTIONS})`);
    const taken = new Set();
    return list.map((q) => cleanQuestion(q, taken));
}

// The fields an owner may set on a service. Anything else in the body is ignored.
function cleanService(body, { partial } = {}) {
    const out = {};
    const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
    if (has('name') || !partial) { out.name = str(body.name, 80); if (!out.name) throw httpError(400, 'Give the service a name'); }
    if (has('icon')) out.icon = str(body.icon, 40) || 'sparkles-outline';
    if (has('description')) out.description = str(body.description, 1000);
    if (has('photos')) out.photos = strings(body.photos, 8, 600);
    if (has('priceType')) { if (!PRICE_TYPES.includes(body.priceType)) throw httpError(400, 'Unknown price type'); out.priceType = body.priceType; }
    if (has('price')) out.price = Math.max(0, Math.round(Number(body.price) || 0));
    if (has('minGuests')) out.minGuests = Math.max(0, Math.round(Number(body.minGuests) || 0));
    if (has('noticeHours')) out.noticeHours = Math.max(0, Math.round(Number(body.noticeHours) || 0));
    if (has('bullets')) out.bullets = strings(body.bullets, 12, 120);
    if (has('quickTexts')) out.quickTexts = strings(body.quickTexts, 12, 160);
    if (has('quickReplies')) out.quickReplies = strings(body.quickReplies, 12, 240);
    if (has('questions')) out.questions = cleanQuestions(body.questions);
    if (has('isActive')) out.isActive = !!body.isActive;
    return out;
}

// What the customer sent, checked against the service's own questions. Returns { answers, guests }.
function checkAnswers(service, given) {
    const src = given && typeof given === 'object' ? given : {};
    const answers = [];
    let guests = 0;
    for (const q of service.questions || []) {
        if (!q.enabled) continue;
        let v = src[q.id];
        const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
        if (empty) {
            if (q.required && q.type !== 'yesno') throw httpError(400, `Please answer: ${q.label}`);
            continue;
        }
        switch (q.type) {
            case 'number': {
                v = Number(v);
                if (!Number.isFinite(v)) throw httpError(400, `${q.label}: enter a number`);
                if (q.min !== undefined && v < q.min) throw httpError(400, `${q.label}: at least ${q.min}`);
                if (q.max !== undefined && v > q.max) throw httpError(400, `${q.label}: at most ${q.max}`);
                if (q.id === 'guests' || q.id === 'plates') guests = v;
                break;
            }
            case 'yesno': v = v === true || v === 'true' || v === 'yes'; break;
            case 'date': if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw httpError(400, `${q.label}: pick a date`); v = String(v); break;
            case 'time': if (!/^\d{1,2}:\d{2}$/.test(String(v))) throw httpError(400, `${q.label}: pick a time`); v = String(v); break;
            case 'phone': v = str(v, 20); if (!/^[0-9+\-\s]{6,20}$/.test(v)) throw httpError(400, `${q.label}: enter a phone number`); break;
            case 'choice': v = str(v, 80); if (!q.options.includes(v)) throw httpError(400, `${q.label}: pick one of the choices`); break;
            case 'multichoice': {
                const picks = (Array.isArray(v) ? v : [v]).map((x) => str(x, 80));
                if (picks.some((p) => !q.options.includes(p))) throw httpError(400, `${q.label}: pick from the choices`);
                v = picks; break;
            }
            case 'photo': v = strings(Array.isArray(v) ? v : [v], 3, 600); break;
            case 'address': v = str(typeof v === 'object' ? v.text || v.line1 : v, 300); break;
            case 'longtext': v = str(v, 1000); break;
            default: v = str(v, 200);
        }
        answers.push({ id: q.id, label: q.label, type: q.type, value: v });
    }
    return { answers, guests };
}

// The price the customer is shown while filling the form: only for a per-plate service once the guests are known.
const estimateFor = (service, guests) => (service.priceType === 'per_plate' && service.price > 0 && guests > 0 ? service.price * guests : 0);

// What the super admin may save as defaults.
function cleanDefaults(body) {
    const out = {};
    if (body.reminderHours !== undefined) {
        const n = Math.round(Number(body.reminderHours));
        if (!(n >= 1 && n <= 168)) throw httpError(400, 'Reminder delay: from 1 to 168 hours');
        out.reminderHours = n;
    }
    if (body.kinds !== undefined) {
        if (!body.kinds || typeof body.kinds !== 'object') throw httpError(400, 'Kinds must be an object');
        out.kinds = {};
        for (const k of Object.keys(body.kinds)) {
            if (!STARTER_KINDS.includes(k)) throw httpError(400, 'Unknown starter service');
            const v = body.kinds[k] || {};
            const o = {};
            if (v.quickTexts !== undefined) o.quickTexts = strings(v.quickTexts, 12, 160);
            if (v.quickReplies !== undefined) o.quickReplies = strings(v.quickReplies, 12, 240);
            if (v.questions !== undefined) o.questions = cleanQuestions(v.questions).map((q) => ({ ...q, recommended: true }));
            out.kinds[k] = o;
        }
    }
    return out;
}

module.exports = { TYPES, PRICE_TYPES, STARTER_KINDS, DEFAULT_REMINDER_HOURS, loadDefaults, cleanDefaults, recommendedFor, templateList, newDoc, cleanService, cleanQuestions, checkAnswers, estimateFor };
