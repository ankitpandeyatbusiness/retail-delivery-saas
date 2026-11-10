// Makes the key pair for browser push (web phase 6). Run ONCE, then put the three lines in the server's environment:
//   node backend/src/scripts/generateVapidKeys.js
// The PRIVATE key is a secret: never commit it, never share it. Changing the keys later signs every browser out of push (they must switch it on again).
const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();
console.log('Add these to the server environment (Render > Environment, and backend/.env for local testing):\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('VAPID_SUBJECT=mailto:YOUR-SUPPORT-EMAIL   # or https://your-company-website, a real contact for push services');
