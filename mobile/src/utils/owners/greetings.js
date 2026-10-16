// What the Soundbox says to the owner before reading a new order, like the greeting of a payment soundbox:
//   "Jai Shri Krishna sir. New order. 2 Butter Naan ..."
// Two independent parts, both chosen by the owner on the Soundbox screen:
//   - "Call me": how he likes to be addressed (sir, madam, or his own name)
//   - one greeting of his faith ("Jai Shri Krishna", "Assalamu alaikum", "Sat Sri Akal", "Jai Masih Ki"...)
// Each greeting has an English form (Roman letters, for an English voice) and a Hindi form (Devanagari, for a Hindi voice).

// [id, English, Hindi]
export const FAITH_GREETINGS = [
    ['Hindu', [
        ['krishna', 'Jai Shri Krishna', 'जय श्री कृष्णा'],
        ['ram', 'Ram Ram', 'राम राम'],
        ['radhe', 'Radhe Radhe', 'राधे राधे'],
        ['mata', 'Jai Mata Di', 'जय माता दी'],
        ['shiv', 'Har Har Mahadev', 'हर हर महादेव'],
        ['namaste', 'Namaste', 'नमस्ते'],
    ]],
    ['Muslim', [
        ['salaam', 'Assalamu alaikum', 'अस्सलामु अलैकुम'],
        ['aadab', 'Aadab', 'आदाब'],
    ]],
    ['Sikh', [
        ['satsriakal', 'Sat Sri Akal', 'सत श्री अकाल'],
        ['waheguru', 'Waheguru ji ka Khalsa, Waheguru ji ki Fateh', 'वाहेगुरु जी का खालसा, वाहेगुरु जी की फतेह'],
    ]],
    ['Christian', [
        ['masih', 'Jai Masih Ki', 'जय मसीह की'],
        ['bless', 'God bless you', 'गॉड ब्लेस यू'],
    ]],
    ['Jain', [
        ['jinendra', 'Jai Jinendra', 'जय जिनेंद्र'],
    ]],
];

// how the owner can be addressed (the Call me switch turns it on or off)
export const ADDRESS_CHOICES = [['sir', 'Sir'], ['madam', 'Madam'], ['name', 'My name']];

const FAITH_BY_ID = Object.fromEntries(FAITH_GREETINGS.flatMap(([, rows]) => rows.map(([id, en, hi]) => [id, { en, hi }])));
export const faithText = (id, language) => (FAITH_BY_ID[id] ? FAITH_BY_ID[id][language === 'hi' ? 'hi' : 'en'] : '');

function titleOf(addressAs, name, language) {
    const hindi = language === 'hi';
    const first = String(name || '').trim().split(/\s+/)[0];
    if (addressAs === 'name' && first) return hindi ? `${first} जी` : first;   // "ji" only in Hindi, an English voice says the plain name
    if (addressAs === 'madam') return hindi ? 'मैडम' : 'madam';
    return hindi ? 'सर' : 'sir';   // "sir" is also the fallback for "my name" when no name is known
}

// The words to say before the order, or '' when the owner chose nothing.
//   o = { language: 'en' | 'hi', greetFaith: id | null, callMe: boolean, addressAs, name }
//   faith + call me  ->  "Jai Shri Krishna sir."      only call me  ->  "Sir."      only faith  ->  "Jai Shri Krishna."
export function buildGreeting(o) {
    const language = o.language === 'hi' ? 'hi' : 'en';
    const faith = o.greetFaith ? faithText(o.greetFaith, language) : '';
    const title = o.callMe ? titleOf(o.addressAs, o.name, language) : '';
    const words = faith ? [faith, title].filter(Boolean).join(' ') : (title ? title.charAt(0).toUpperCase() + title.slice(1) : '');
    return words ? `${words}.` : '';
}
