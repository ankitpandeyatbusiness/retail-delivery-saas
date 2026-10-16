# Start here: the operator year in plain words

(The full details are in `operator-and-settlement.md`. This page is only what you have to do and where things live.)

## Where is the truth? (one place for each thing)

| Thing | The one place | Who may change it |
|---|---|---|
| The company on the bills (name, address, GST number, PAN, state, invoice prefix, "Powered by", contact phone) | **Money, Business details** = the ACTIVE company. | Supreme admin |
| Razorpay keys that receive rent and SMS top-ups | **Money, My Razorpay** = the ACTIVE company. | Supreme admin |
| The other company (your own agency), saved and waiting | **More, Companies and Switch** | Supreme admin |
| Which company is active | The **Switch** button there. It copies the chosen company into Business details and My Razorpay. | Supreme admin |
| Who brought each shop (50/50 or 70/30) | **Shop page, "Who brought this shop"** | Supreme admin |
| The ratios, the 15 days, the two names | **Settlement sheet, Names and ratios** | Supreme admin |
| Who owes whom, and what was paid | **More, Settlement sheet** (rows are made by themselves) | Supreme admin writes; everybody reads |
| The agreement and terms | **More, Agreements and terms** | Supreme admin writes and sends; everybody reads |
| Who is "supreme admin" | `SUPREME_ADMIN_PHONE` in `backend/.env` (default 8318538918). No panel can change it. | The server file only |

How the first two stay one truth: Business details and My Razorpay always edit the **active** company, and its saved copy in Companies follows by itself. A company that is not active is only changed in Companies. Old bills never change: each keeps the company it was made with.

## What YOU do, in this order
1. **Backend:** restart it (nothing else to install). Set `SUPREME_ADMIN_PHONE` in `backend/.env` only if the number is different.
2. **Log in** to the superadmin app with 8318538918. Add Vivek as a second superadmin (More, Superadmin team) with his phone.
3. **Money, Business details:** fill the company that runs the platform now (Vivek's): legal name, address, GST number, PAN, state, SAC code, invoice prefix, "Powered by" name, contact phone. **Money, My Razorpay:** his Razorpay keys.
4. **More, Companies and Switch:** press "Save the current company". Later add your own agency here with its details and its own Razorpay keys. (You can do this months before the switch.)
5. **Settlement sheet, Names and ratios:** type the two names, check 50 / 70 / 50 and 15 days.
6. **Every shop:** open it and choose "Who brought this shop". Add its State (shop form).
7. **More, Agreements and terms:** open the Operating agreement, Edit draft, fill the [blanks], Send. Mark Vivek as the operator partner (Who agreed). Review and send the other documents too.
8. **When you give the app to a client:** open that shop and press "Mark as handed over to the client". Their owner and riders will be asked to agree on their second visit.
9. **Each month:** More, GST register for Vivek's returns; Settlement sheet to mark what was paid.
10. **After a year:** Companies and Switch, open your agency, read the checklist, press "Switch".

## What to check on the phone (about 15 minutes)
1. Log in as the second superadmin: you can open the Settlement sheet, GST register, Companies and Agreements, but changing anything gives "Only the supreme admin can do this".
2. Owner app, SMS balance: type 200: it shows "You pay 236". Pay. In History tap "Open invoice (PDF)".
3. Mark a bill paid (Money, a bill, Mark paid): a row appears on the Settlement sheet, and your phone gets a notification.
4. Open that row: tap "Record a payment"; then try "Set off against another row".
5. Log in as Vivek: the row shows "I have paid"; press it; you confirm it on your phone.
6. Agreements: send the Owner terms; mark a shop handed over; on the owner phone open the app, close it for 30 minutes, open it again: the agree screen cannot be closed.
7. Customer app: login screen and Account show "Terms and privacy" and "Powered by ... Contact".
8. Companies and Switch: open the checklist of your agency (do NOT press Switch until the year is over).
