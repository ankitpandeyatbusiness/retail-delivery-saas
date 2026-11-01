# Languages: phone test checklist

The apps (customer, owner, rider, kitchen, waiter) speak English, Hindi, Bhojpuri (beta), Marathi, Gujarati and Bengali.
Superadmin stays English. SMS stays English (needs DLT registration first).

## How it works (for whoever changes texts later)

- Screen texts: `tr('English text')` in the app. Translations live in `mobile/scripts/i18n-chunks/*.js`
  (rows `[English, Hindi, Bhojpuri, Marathi, Gujarati, Bengali]`). Never edit `src/i18n/locales/*.js` by hand.
  After adding rows run, in `mobile/`: `node scripts/i18nKeys.js` then `node scripts/i18nBuild.js` then `node scripts/i18nKeys.js --check`.
- Server messages and notification texts are collected by `node backend/scripts/i18nServerMessages.js`
  (run it first when server texts change). Texts with values are patterns: `Minimum order is ₹{v1}`.
- Notification texts of `backend/src/notifications/templates/texts.js` are listed as patterns in
  `backend/src/notifications/templates/textPatterns.js`. Change a text there too, and add its translation row.
- The build also writes the server's copy (`backend/src/notifications/locales/*.json`), used to write each push
  in the person's language (`User.language`).
- Soundbox voice: Hindi uses the server's own Hindi lines; Marathi, Gujarati and Bengali translate the English line on
  the phone (`mobile/src/utils/common/speechLang.js`).
- Long words: one-line texts shrink to 80% in other languages instead of being cut (`src/i18n/textPatch.js`); buttons
  may take two lines; the shop's custom font (Inter, Lora, Nunito) is used only in English, because it has no Indian letters.

## On a real phone, for each language

Change the language from Login, customer Account, owner menu or rider Profile. The app redraws.

1. **Customer**: home, menu, item, cart (Now / Today / Tomorrow chips, the pay bar), place a cash order, order page,
   pickup actions, table dining (scan, call waiter, split bill), points, refer a friend, my reservations, inquiries.
2. **Owner**: home, orders board, an order (accept, cancel reasons, rider pick), menu (add item button), dine in settings,
   bookings, staff, alerts, Soundbox screen, transactions, history, the settings menu search (type a word in the language).
3. **Rider**: home, a delivery (map, PIN, cancel reasons), money, profile, duty and leave.
4. **Kitchen and waiter**: the queue, by dish, tables, requests, QR payment, duty and leave.
5. **Errors**: try a wrong pickup code, a too-small order, a closed shop: the message must be in the language.
6. **Push**: with the app closed, place an order from another phone: the owner's notification is in the owner's language;
   accept it: the customer's notification is in the customer's language.
7. **Voice**: Soundbox screen, pick मराठी / ગુજરાતી / বাংলা, tap a voice to hear it, then let an order arrive.
   If the phone has no such voice: Settings, Language, Text-to-speech, Google, Install voice data.

## What to look for

- Text cut with "..." where the meaning is lost, text running out of a button or chip, two buttons squeezed.
- Clipped tops or bottoms of letters (ि, ं, ु) in headings.
- Bold headings that look thin.
- English left on a screen (screenshot it: the text and the screen name are enough to add it).

## Labels whose translations run longest (look at these first)

| English | Longest in | Translation |
|---|---|---|
| Mark as solved? | bn | সমাধান হয়েছে হিসেবে চিহ্নিত করবেন? |
| Order your usual | bn | আপনার সবসময়ের খাবার অর্ডার করুন |
| 10 PM to 8 AM | hi | रात 10 से सुबह 8 बजे तक |
| No items yet. Add one | bn | এখনও কোনো আইটেম নেই। একটি যোগ করুন |
| OR BY WHO ORDERED | bn | অথবা যিনি অর্ডার করেছেন সেই অনুযায়ী |
| Points last | hi | पॉइंट कितने समय चलते हैं |
| {a} reminded | bn | {a} জনকে মনে করানো হয়েছে |
| Asked | bn | জিজ্ঞাসা করা হয়েছে |
| Ends on | bho | खतम होखे के तारीख |
| Marked {s} | mr | {s} म्हणून चिन्हांकित केले |
| Remind at | mr | इतक्या वाजता आठवण द्या |
| left as it is | bn | যেমন ছিল তেমনই রাখা হয়েছে |
| {name} paid and left | hi | {name} ने भुगतान किया और चले गए |
