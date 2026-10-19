// The message library for reminders to customers (by hand with "Remind" or by Autopilot).
// Push and the in-app inbox only. Each message has three wordings: en (English), hinglish (Hindi in English letters), hi (Hindi).
//   [title, body]. Words in braces are filled in:
//   {name} the customer's first name   {food} his favourite food   {shop} the shop   {discount} percent off   {code} his coupon code
// A message without a favourite food uses the fallback wording for {food}.
const FOOD_FALLBACK = { en: 'your favourite', hinglish: 'aapka favourite', hi: 'आपका पसंदीदा' };
const NAME_FALLBACK = { en: 'there', hinglish: 'dost', hi: 'दोस्त' };
// 'mixed' is not a fourth wording: every message picks English, Hinglish or Hindi by chance, so the customer does not get bored
const LANGUAGES = ['en', 'hinglish', 'hi', 'mixed'];
const MIX = ['en', 'hinglish', 'hinglish', 'hi'];   // Hinglish is the most natural, so it comes up the most

// Emojis: one for the front of the title and one for the end of the text, chosen by the message so the same message always wears
// the same pair. The owner's own wording is left exactly as he wrote it.
const EMOJI = {
    winback_1: ['😋', '🍽️', '🥘', '🍕', '🍛', '🥗', '🍜'],
    winback_2: ['🎁', '💸', '🎉', '🏷️', '✨', '🤑'],
    winback_3: ['👋', '🙏', '💛', '🤗', '🚪', '😊'],
    welcome: ['🎉', '👋', '🥳', '💛', '🙌'],
    thanks: ['❤️', '🙏', '😊', '🌟', '🤗', '🍽️'],
    mealtime_breakfast: ['🌅', '☕', '🥐', '🍳', '🥞'],
    mealtime_lunch: ['🍛', '🥘', '🍱', '😋', '🍲'],
    mealtime_snacks: ['🍟', '☕', '🍪', '🥪', '😋'],
    mealtime_dinner: ['🌙', '🍽️', '🍝', '🍛', '😋'],
    festival: ['🪔', '🎊', '✨', '🎆', '🙏'],
    manual: ['😊', '🍽️', '👋', '💛'],
};
const GENERIC = ['😊', '🍽️', '✨'];
const pools = (kind) => EMOJI[kind] || GENERIC;

const LIB = {
    // win-back, step 1: a friendly nudge at the hour he usually orders
    winback_1: [
        { en: ['{name}, {food} misses you', 'It has been a while! {shop} has your {food} ready whenever you are.'], hinglish: ['{name}, {food} aapko yaad kar raha hai', 'Kaafi din ho gaye! {shop} mein {food} aapka wait kar raha hai.'], hi: ['{name}, {food} आपको याद कर रहा है', 'काफ़ी दिन हो गए! {shop} में {food} आपका इंतज़ार कर रहा है।'] },
        { en: ['Hungry, {name}?', 'Your usual time is here. One tap and {food} is on its way.'], hinglish: ['Bhookh lagi, {name}?', 'Aapka roz ka time ho gaya. Ek tap aur {food} aapke paas.'], hi: ['भूख लगी, {name}?', 'आपका रोज़ का वक़्त हो गया। एक टैप और {food} आपके पास।'] },
        { en: ['We saved your seat, {name}', '{shop} is open and {food} is hot. Come back for a bite?'], hinglish: ['{name}, aapki seat rakhi hai', '{shop} khula hai aur {food} garam hai. Aaj ho jaye?'], hi: ['{name}, आपकी सीट रखी है', '{shop} खुला है और {food} गरम है। आज हो जाए?'] },
        { en: ['Craving {food}?', 'Hi {name}, today is a good day for {food} from {shop}.'], hinglish: ['{food} ka mann hai?', 'Hi {name}, aaj {shop} ka {food} banta hai!'], hi: ['{food} का मन है?', 'Hi {name}, आज {shop} का {food} बनता है!'] },
        { en: ['Long time no see, {name}', 'Your table at {shop} is still yours. {food}, anyone?'], hinglish: ['{name}, bahut din baad!', '{shop} mein aapki jagah wahi hai. {food} mangwaoge?'], hi: ['{name}, बहुत दिन बाद!', '{shop} में आपकी जगह वही है। {food} मँगवाओगे?'] },
        { en: ['A little hello from {shop}', 'Hi {name}, we baked, fried and stirred, all for you. Order {food} today?'], hinglish: ['{shop} ki taraf se hello', 'Hi {name}, aapke liye sab taiyaar hai. Aaj {food} ho jaye?'], hi: ['{shop} की तरफ़ से नमस्ते', 'Hi {name}, आपके लिए सब तैयार है। आज {food} हो जाए?'] },
        { en: ['Dinner sorted, {name}?', 'Skip the cooking tonight. {food} from {shop} is a tap away.'], hinglish: ['Khana ban gaya, {name}?', 'Aaj khana banane ki chhutti. {shop} ka {food} bas ek tap door.'], hi: ['खाना बन गया, {name}?', 'आज खाना बनाने की छुट्टी। {shop} का {food} बस एक टैप दूर।'] },
    ],
    // win-back, step 2: a small offer (only when the owner allows a discount; otherwise a second reminder from winback_1 is used)
    winback_2: [
        { en: ['{discount}% off, just for you', '{name}, use {code} on your next order at {shop}. Valid for a few days.'], hinglish: ['Sirf aapke liye {discount}% off', '{name}, {shop} mein agle order par {code} lagayein. Kuch din ke liye valid.'], hi: ['सिर्फ़ आपके लिए {discount}% छूट', '{name}, {shop} में अगले ऑर्डर पर {code} लगाएँ। कुछ दिन के लिए मान्य।'] },
        { en: ['A treat from {shop}', 'Hi {name}, take {discount}% off {food} with code {code}.'], hinglish: ['{shop} ki taraf se treat', 'Hi {name}, {food} par {discount}% off, code {code} ke saath.'], hi: ['{shop} की तरफ़ से ट्रीट', 'Hi {name}, {food} पर {discount}% छूट, कोड {code} के साथ।'] },
        { en: ['We miss you, {name}', 'Here is {discount}% off to say sorry for the quiet. Code: {code}'], hinglish: ['{name}, hum aapko miss kar rahe hain', 'Ye lijiye {discount}% off. Code: {code}'], hi: ['{name}, हम आपको मिस कर रहे हैं', 'ये लीजिए {discount}% छूट। कोड: {code}'] },
        { en: ['{discount}% off is waiting', '{name}, your code {code} works on anything at {shop}. Hurry, it ends soon.'], hinglish: ['{discount}% off wait kar raha hai', '{name}, {shop} mein kuch bhi mangwayein, code {code} lagayein. Jaldi karein!'], hi: ['{discount}% छूट इंतज़ार कर रही है', '{name}, {shop} में कुछ भी मँगवाएँ, कोड {code} लगाएँ। जल्दी करें!'] },
        { en: ['Your {food}, now cheaper', 'Hi {name}, {discount}% off with {code}. Only for you.'], hinglish: ['{food}, ab sasta', 'Hi {name}, {code} lagao aur {discount}% off pao. Sirf aapke liye.'], hi: ['{food}, अब सस्ता', 'Hi {name}, {code} लगाओ और {discount}% छूट पाओ। सिर्फ़ आपके लिए।'] },
        { en: ['Come back for less', '{name}, {discount}% off at {shop} with {code}. See you soon!'], hinglish: ['Wapas aao, kam daam mein', '{name}, {shop} mein {code} se {discount}% off. Jaldi milte hain!'], hi: ['वापस आओ, कम दाम में', '{name}, {shop} में {code} से {discount}% छूट। जल्दी मिलते हैं!'] },
    ],
    // win-back, step 3: the last call, kind and short. After this the customer is left alone for a month.
    winback_3: [
        { en: ['Last call from {shop}', '{name}, we will stop bothering you now. If you want {food}, we are here.'], hinglish: ['{shop} ki aakhri awaaz', '{name}, ab hum pareshan nahi karenge. {food} chahiye to hum yahin hain.'], hi: ['{shop} की आख़िरी आवाज़', '{name}, अब हम परेशान नहीं करेंगे। {food} चाहिए तो हम यहीं हैं।'] },
        { en: ['No pressure, {name}', 'Whenever you feel like {food}, {shop} is just a tap away.'], hinglish: ['Koi jaldi nahi, {name}', 'Jab bhi {food} ka mann ho, {shop} ek tap door hai.'], hi: ['कोई जल्दी नहीं, {name}', 'जब भी {food} का मन हो, {shop} बस एक टैप दूर है।'] },
        { en: ['The door is always open', 'Hi {name}, thank you for ordering from {shop}. Come back any time.'], hinglish: ['Darwaza hamesha khula hai', 'Hi {name}, {shop} se order karne ka shukriya. Kabhi bhi wapas aaiye.'], hi: ['दरवाज़ा हमेशा खुला है', 'Hi {name}, {shop} से ऑर्डर करने का शुक्रिया। कभी भी वापस आइए।'] },
        { en: ['One more try, {name}!', 'Your {food} is still on our menu. That is all, promise.'], hinglish: ['Ek aur koshish, {name}!', 'Aapka {food} abhi bhi hamare menu mein hai. Bas itna hi, promise.'], hi: ['एक और कोशिश, {name}!', 'आपका {food} अभी भी हमारे मेन्यू में है। बस इतना ही, वादा।'] },
        { en: ['We will wait, {name}', '{shop} will be here when {food} calls you.'], hinglish: ['Hum intezaar karenge, {name}', 'Jab {food} ka mann kare, {shop} yahin milega.'], hi: ['हम इंतज़ार करेंगे, {name}', 'जब {food} का मन करे, {shop} यहीं मिलेगा।'] },
        { en: ['Thanks for being with us', '{name}, you are always welcome at {shop}.'], hinglish: ['Saath rehne ka shukriya', '{name}, {shop} mein aapka hamesha swagat hai.'], hi: ['साथ रहने का शुक्रिया', '{name}, {shop} में आपका हमेशा स्वागत है।'] },
    ],
    // after a customer's first order
    welcome: [
        { en: ['Welcome to {shop}, {name}!', 'Thanks for your first order. Next time, your favourites are one tap away.'], hinglish: ['{shop} mein swagat hai, {name}!', 'Pehle order ka shukriya. Agli baar favourites bas ek tap door.'], hi: ['{shop} में स्वागत है, {name}!', 'पहले ऑर्डर का शुक्रिया। अगली बार पसंदीदा बस एक टैप दूर।'] },
        { en: ['Glad you tried us, {name}', 'We hope you loved it. Tell us how it was, and order again any time.'], hinglish: ['{name}, try karne ka shukriya', 'Umeed hai pasand aaya. Bataiye kaisa laga, aur phir order kijiye.'], hi: ['{name}, ट्राई करने का शुक्रिया', 'उम्मीद है पसंद आया। बताइए कैसा लगा, और फिर ऑर्डर कीजिए।'] },
        { en: ['Hello from {shop}', 'Hi {name}, you are one of us now. Rate your order and help us get better!'], hinglish: ['{shop} ki taraf se hello', 'Hi {name}, ab aap hamare parivaar mein hain. Order ko rate karke batayein!'], hi: ['{shop} की तरफ़ से नमस्ते', 'Hi {name}, अब आप हमारे परिवार में हैं। ऑर्डर को रेट करके बताइए!'] },
        { en: ['Your first order, done!', 'Thank you {name}. Remember us for your next meal.'], hinglish: ['Pehla order, done!', 'Shukriya {name}. Agle khane ke liye humein yaad rakhna.'], hi: ['पहला ऑर्डर, पूरा!', 'शुक्रिया {name}। अगले खाने के लिए हमें याद रखना।'] },
        { en: ['Welcome aboard, {name}', 'Hope it was tasty. {shop} is always here when you are hungry.'], hinglish: ['Swagat hai, {name}', 'Umeed hai swadisht tha. Bhookh lage to {shop} hamesha hai.'], hi: ['स्वागत है, {name}', 'उम्मीद है स्वादिष्ट था। भूख लगे तो {shop} हमेशा है।'] },
    ],
    // after a delivery (at most once in three days)
    thanks: [
        { en: ['Thank you, {name}!', 'Hope you enjoyed your order from {shop}.'], hinglish: ['Shukriya, {name}!', 'Umeed hai {shop} ka order pasand aaya.'], hi: ['शुक्रिया, {name}!', 'उम्मीद है {shop} का ऑर्डर पसंद आया।'] },
        { en: ['Enjoyed it, {name}?', 'Tell us how it was. It takes ten seconds and helps us a lot.'], hinglish: ['Kaisa laga, {name}?', 'Bata dijiye, sirf das second lagenge aur humein bahut madad milegi.'], hi: ['कैसा लगा, {name}?', 'बता दीजिए, सिर्फ़ दस सेकंड लगेंगे और हमें बहुत मदद मिलेगी।'] },
        { en: ['You made our day', '{name}, thank you for choosing {shop}.'], hinglish: ['Aapne hamara din bana diya', '{name}, {shop} chunne ka shukriya.'], hi: ['आपने हमारा दिन बना दिया', '{name}, {shop} चुनने का शुक्रिया।'] },
        { en: ['Bon appétit, {name}!', 'We hope every bite was great. See you again soon.'], hinglish: ['Bon appétit, {name}!', 'Umeed hai har bite mazedaar tha. Jaldi milte hain.'], hi: ['Bon appétit, {name}!', 'उम्मीद है हर निवाला मज़ेदार था। जल्दी मिलते हैं।'] },
        { en: ['Delivered with love', 'Thanks {name}. If something was not right, tell us and we will fix it.'], hinglish: ['Pyaar se deliver hua', 'Shukriya {name}. Kuch theek na laga ho to batayein, hum sudhaar denge.'], hi: ['प्यार से डिलीवर हुआ', 'शुक्रिया {name}। कुछ ठीक न लगा हो तो बताइए, हम सुधार देंगे।'] },
        { en: ['Thanks a lot!', '{name}, your order helps {shop} grow. Rate it if you like.'], hinglish: ['Bahut shukriya!', '{name}, aapke order se {shop} aage badhta hai. Pasand aaye to rate karein.'], hi: ['बहुत शुक्रिया!', '{name}, आपके ऑर्डर से {shop} आगे बढ़ता है। पसंद आए तो रेट करें।'] },
    ],
    // at the hour a regular customer usually orders; one set for each part of the day
    mealtime_breakfast: [
        { en: ['Good morning, {name}!', 'Start the day right with {food} from {shop}.'], hinglish: ['Good morning, {name}!', 'Din ki shuruaat {shop} ke {food} se karein.'], hi: ['सुप्रभात, {name}!', 'दिन की शुरुआत {shop} के {food} से करें।'] },
        { en: ['Breakfast time', '{name}, {food} is hot and ready at {shop}.'], hinglish: ['Naashte ka time', '{name}, {shop} mein {food} garam aur taiyaar hai.'], hi: ['नाश्ते का वक़्त', '{name}, {shop} में {food} गरम और तैयार है।'] },
        { en: ['Rise and dine', 'Hi {name}, no time to cook? {food} is a tap away.'], hinglish: ['Uthiye aur khaiye', 'Hi {name}, banane ka time nahi? {food} bas ek tap door.'], hi: ['उठिए और खाइए', 'Hi {name}, बनाने का वक़्त नहीं? {food} बस एक टैप दूर।'] },
    ],
    mealtime_lunch: [
        { en: ['Lunch time, {name}!', 'Your usual {food} from {shop} is ready to order.'], hinglish: ['Lunch ka time, {name}!', '{shop} ka aapka {food} order ke liye taiyaar hai.'], hi: ['लंच का वक़्त, {name}!', '{shop} का आपका {food} ऑर्डर के लिए तैयार है।'] },
        { en: ['What is for lunch?', '{name}, how about {food} today?'], hinglish: ['Lunch mein kya hai?', '{name}, aaj {food} kaisa rahega?'], hi: ['लंच में क्या है?', '{name}, आज {food} कैसा रहेगा?'] },
        { en: ['Beat the lunch rush', 'Order {food} from {shop} now, {name}, and it reaches you hot.'], hinglish: ['Lunch ki bheed se pehle', '{name}, abhi {shop} se {food} mangwayein, garam pahunchega.'], hi: ['लंच की भीड़ से पहले', '{name}, अभी {shop} से {food} मँगवाएँ, गरम पहुँचेगा।'] },
        { en: ['Lunch sorted?', 'Hi {name}, {food} is waiting at {shop}.'], hinglish: ['Lunch ho gaya?', 'Hi {name}, {shop} mein {food} aapka wait kar raha hai.'], hi: ['लंच हो गया?', 'Hi {name}, {shop} में {food} आपका इंतज़ार कर रहा है।'] },
    ],
    mealtime_snacks: [
        { en: ['Snack time, {name}!', 'A little {food} with your evening tea?'], hinglish: ['Snack time, {name}!', 'Shaam ki chai ke saath thoda {food}?'], hi: ['स्नैक टाइम, {name}!', 'शाम की चाय के साथ थोड़ा {food}?'] },
        { en: ['Small hunger, big taste', '{name}, grab {food} from {shop}.'], hinglish: ['Chhoti bhookh, bada swaad', '{name}, {shop} se {food} mangwa lijiye.'], hi: ['छोटी भूख, बड़ा स्वाद', '{name}, {shop} से {food} मँगवा लीजिए।'] },
        { en: ['Something tasty for the evening', 'Hi {name}, {food} is ready at {shop}.'], hinglish: ['Shaam ke liye kuch tasty', 'Hi {name}, {shop} mein {food} taiyaar hai.'], hi: ['शाम के लिए कुछ टेस्टी', 'Hi {name}, {shop} में {food} तैयार है।'] },
    ],
    mealtime_dinner: [
        { en: ['Dinner time, {name}!', 'Skip the cooking. {food} from {shop} is on the way when you order.'], hinglish: ['Dinner ka time, {name}!', 'Aaj khana banane ki chhutti. {shop} ka {food} order karein.'], hi: ['डिनर का वक़्त, {name}!', 'आज खाना बनाने की छुट्टी। {shop} का {food} ऑर्डर करें।'] },
        { en: ['What is for dinner?', '{name}, your {food} says hello.'], hinglish: ['Dinner mein kya hai?', '{name}, aapka {food} hello bol raha hai.'], hi: ['डिनर में क्या है?', '{name}, आपका {food} हेलो बोल रहा है।'] },
        { en: ['A cosy dinner, delivered', 'Hi {name}, order {food} from {shop} and relax.'], hinglish: ['Aaram se dinner, ghar tak', 'Hi {name}, {shop} se {food} mangwayein aur aaram karein.'], hi: ['आराम से डिनर, घर तक', 'Hi {name}, {shop} से {food} मँगवाएँ और आराम करें।'] },
        { en: ['Hungry tonight?', '{name}, {food} is hot at {shop}. One tap.'], hinglish: ['Aaj raat bhookh lagi?', '{name}, {shop} mein {food} garam hai. Bas ek tap.'], hi: ['आज रात भूख लगी?', '{name}, {shop} में {food} गरम है। बस एक टैप।'] },
    ],
    // a festival greeting; {festival} is the festival's name
    festival: [
        { en: ['Happy {festival}, {name}!', 'Warm wishes from {shop}. Celebrate with {food}?'], hinglish: ['{festival} mubarak, {name}!', '{shop} ki taraf se shubhkamnayein. {food} ke saath celebrate karein?'], hi: ['{festival} की शुभकामनाएँ, {name}!', '{shop} की तरफ़ से शुभकामनाएँ। {food} के साथ जश्न मनाएँ?'] },
        { en: ['{festival} wishes from {shop}', 'Hi {name}, make it tasty today. We are open for you.'], hinglish: ['{shop} ki taraf se {festival} ki badhai', 'Hi {name}, aaj ka din swadisht banayein. Hum aapke liye khule hain.'], hi: ['{shop} की तरफ़ से {festival} की बधाई', 'Hi {name}, आज का दिन स्वादिष्ट बनाएँ। हम आपके लिए खुले हैं।'] },
        { en: ['Celebrate {festival} with us', '{name}, order {food} from {shop} and enjoy the day.'], hinglish: ['{festival} hamare saath manayein', '{name}, {shop} se {food} mangwayein aur din ka maza lein.'], hi: ['{festival} हमारे साथ मनाएँ', '{name}, {shop} से {food} मँगवाएँ और दिन का मज़ा लें।'] },
        { en: ['{festival}! Treat yourself', 'Hi {name}, you deserve {food} today.'], hinglish: ['{festival}! Khud ko treat dein', 'Hi {name}, aaj {food} to banta hai.'], hi: ['{festival}! ख़ुद को ट्रीट दें', 'Hi {name}, आज {food} तो बनता है।'] },
    ],
    // the owner's one-tap "Remind" button (a friendly message he can edit before it goes)
    manual: [
        { en: ['{name}, we saved {food} for you', 'Order from {shop} today?'], hinglish: ['{name}, {food} aapke liye rakha hai', 'Aaj {shop} se order karenge?'], hi: ['{name}, {food} आपके लिए रखा है', 'आज {shop} से ऑर्डर करेंगे?'] },
        { en: ['Hi {name}, it has been a while', '{shop} misses you. {food} today?'], hinglish: ['Hi {name}, kaafi din ho gaye', '{shop} aapko miss kar raha hai. Aaj {food}?'], hi: ['Hi {name}, काफ़ी दिन हो गए', '{shop} आपको मिस कर रहा है। आज {food}?'] },
        { en: ['Craving something, {name}?', '{food} from {shop} is ready when you are.'], hinglish: ['Kuch khane ka mann, {name}?', '{shop} ka {food} aapke order ka wait kar raha hai.'], hi: ['कुछ खाने का मन, {name}?', '{shop} का {food} आपके ऑर्डर का इंतज़ार कर रहा है।'] },
        { en: ['A hello from {shop}', '{name}, we are cooking {food} fresh today. Come and get it!'], hinglish: ['{shop} ki taraf se hello', '{name}, aaj {food} taaza ban raha hai. Mangwa lijiye!'], hi: ['{shop} की तरफ़ से नमस्ते', '{name}, आज {food} ताज़ा बन रहा है। मँगवा लीजिए!'] },
        { en: ['Your usual is waiting', 'Hi {name}, {food} at {shop}. Just one tap.'], hinglish: ['Aapka usual wait kar raha hai', 'Hi {name}, {shop} mein {food}. Bas ek tap.'], hi: ['आपका usual इंतज़ार कर रहा है', 'Hi {name}, {shop} में {food}। बस एक टैप।'] },
        { en: ['Fresh and hot, {name}', '{shop} has {food} ready. Treat yourself today.'], hinglish: ['Taaza aur garam, {name}', '{shop} mein {food} taiyaar hai. Aaj khud ko treat dein.'], hi: ['ताज़ा और गरम, {name}', '{shop} में {food} तैयार है। आज ख़ुद को ट्रीट दें।'] },
        { en: ['{name}, how about {food}?', 'It is a good time to order from {shop}.'], hinglish: ['{name}, {food} kaisa rahega?', '{shop} se order karne ka achha time hai.'], hi: ['{name}, {food} कैसा रहेगा?', '{shop} से ऑर्डर करने का अच्छा वक़्त है।'] },
        { en: ['We are open and hungry for you', 'Hi {name}, order {food} from {shop} today.'], hinglish: ['Hum khule hain, aapka intezaar hai', 'Hi {name}, aaj {shop} se {food} mangwayein.'], hi: ['हम खुले हैं, आपका इंतज़ार है', 'Hi {name}, आज {shop} से {food} मँगवाएँ।'] },
    ],
};

const KINDS = Object.keys(LIB);
const count = () => KINDS.reduce((n, k) => n + LIB[k].length, 0);

const firstName = (name, lang) => {
    const n = String(name || '').trim().split(/\s+/)[0];
    return n && !/^\d+$/.test(n) ? n : NAME_FALLBACK[lang];
};

// swap the {words} for real values. Unknown words are left out, never shown as "{word}".
function fill(text, vars) {
    return String(text).replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null || vars[k] === '' ? '' : String(vars[k]))).replace(/\s+/g, ' ').trim();
}

// kind: a key of LIB.  lang: en | hinglish | hi.  avoid: library numbers used lately for this customer (not repeated).
// custom: the owner's own wording { title, body }, used instead of the library when he wrote one.
// Returns { title, body, idx } (idx = which library message, or -1 for the owner's own).
function build({ kind, lang = 'hinglish', avoid = [], custom, vars = {}, pickIdx }) {
    const asked = LANGUAGES.includes(lang) ? lang : 'hinglish';
    const language = asked === 'mixed' ? MIX[Math.floor(Math.random() * MIX.length)] : asked;
    const list = LIB[kind];
    if (!list) throw new Error(`unknown message kind ${kind}`);
    const v = { ...vars, name: firstName(vars.name, language), food: vars.food || FOOD_FALLBACK[language] };
    if (custom?.title && custom?.body) return { title: fill(custom.title, v).slice(0, 120), body: fill(custom.body, v).slice(0, 300), idx: -1 };

    let idx = Number.isInteger(pickIdx) && list[pickIdx] ? pickIdx : -1;
    if (idx < 0) {
        const fresh = list.map((_, i) => i).filter((i) => !avoid.includes(i));
        const pool = fresh.length ? fresh : list.map((_, i) => i);   // everything used lately: start again
        idx = pool[Math.floor(Math.random() * pool.length)];
    }
    const [title, body] = list[idx][language];
    const pool = pools(kind);
    const front = pool[idx % pool.length];
    const back = pool[(idx + 3) % pool.length];
    return { title: `${front} ${fill(title, v)}`.slice(0, 120), body: `${fill(body, v)} ${back === front ? '' : back}`.trim().slice(0, 300), idx, language };
}

module.exports = { LIB, KINDS, LANGUAGES, FOOD_FALLBACK, count, build, fill, firstName };
