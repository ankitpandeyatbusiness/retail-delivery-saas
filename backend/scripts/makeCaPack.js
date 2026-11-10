// Makes docs/ca-pack-plans: sample invoices, credit notes and a GST register for the CA, with the questions on one page.
//   node backend/scripts/makeCaPack.js
// Everything is a SAMPLE: fake names, fake numbers, built with the app's REAL invoice and tax code. No database, no real keys.
require('../tests/helpers/env');   // fake settings, so no real key is read
const fs = require('fs');
const path = require('path');
const { renderToBuffer } = require('../src/services/subscriptionInvoicePdf');
const invoicing = require('../src/services/platformInvoicing');
const gstRegister = require('../src/services/gstRegister');
const { buildSheet } = require('../src/services/xlsxExport');

const OUT = path.join(__dirname, '../../docs/ca-pack-plans');
fs.mkdirSync(OUT, { recursive: true });

const BUSINESS = {
    legalName: 'Sample Platform Private Limited (SAMPLE)', address: '12 Sample Road, Lucknow, Uttar Pradesh 226001', gstin: '09AAAAA0000A1Z5', pan: 'AAAAA0000A', email: 'accounts@sample.example',
    phone: '9000000000', sacCode: 'CA to confirm', paymentInstructions: 'Paid online. This is a SAMPLE.', state: 'Uttar Pradesh', stateCode: '09',
};
const SHOP_SAME = { name: 'Sample Sweets (SAMPLE)', phone: '9111111111', address: { line: '5 Market Street', city: 'Kanpur', state: 'Uttar Pradesh', pincode: '208001' }, business: { legalName: 'Sample Sweets (SAMPLE)', gstin: '09BBBBB1111B1Z2' } };
const SHOP_OTHER = { name: 'Sample Cafe (SAMPLE)', phone: '9222222222', address: { line: '9 Beach Road', city: 'Mumbai', state: 'Maharashtra', pincode: '400001' }, business: { legalName: 'Sample Cafe (SAMPLE)', gstin: '27CCCCC2222C1Z8' } };
const SHOP_NOGST = { name: 'Sample Tiffin (SAMPLE)', phone: '9333333333', address: { line: '2 Lane', city: 'Lucknow', state: 'Uttar Pradesh', pincode: '226010' }, business: {} };

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const date = (iso) => new Date(`${iso}T11:00:00+05:30`);

// one tax document: items = [{ description, amount }] (a minus amount is a discount line); gstPercent on the total of the items
function doc({ no, kind = 'plan', shop, items, gstPercent = 18, issue, mode = 'online', ref, description, credit, against, reason }) {
    const { seller, buyer } = invoicing.parties(BUSINESS, shop);
    const base = r2(items.reduce((n, i) => n + i.amount, 0));
    const gst = r2((base * gstPercent) / 100);
    const tax = invoicing.taxFor({ seller, buyer, gstAmount: gst });
    return {
        invoiceNo: no, kind, issueDate: date(issue), status: 'paid', paidAt: date(issue), paymentMode: mode, paymentRef: ref, description: description || items[0].description,
        lineItems: items.map((i) => ({ description: i.description, qty: 1, rate: i.amount, amount: i.amount })), baseAmount: base, gstPercent, gstAmount: gst, total: r2(base + gst),
        reverseCharge: false, ...tax, seller, buyer, ref: credit ? undefined : 'SAMPLE: not a real invoice',
        ...(credit ? { originalInvoiceNo: against, originalIssueDate: date('2026-11-02'), reason } : {}),
    };
}

const FILES = [
    ['01-plan-invoice-same-state.pdf', 'Plan invoice, shop in the same state (CGST + SGST)', 'plan', 'Plan', doc({ no: 'PLN/2026-27/0001', shop: SHOP_SAME, items: [{ description: 'Growth plan for 1 month', amount: 2999 }], issue: '2026-11-02', ref: 'pay_SAMPLE0001' })],
    ['02-plan-invoice-other-state.pdf', 'Plan invoice, shop in another state (IGST)', 'plan', 'Plan', doc({ no: 'PLN/2026-27/0002', shop: SHOP_OTHER, items: [{ description: 'Growth plan for 1 month', amount: 2999 }], issue: '2026-11-03', ref: 'pay_SAMPLE0002' })],
    ['03-plan-invoice-with-discount.pdf', 'Plan invoice with the 6 month discount (GST on the discounted price)', 'plan', 'Plan', doc({ no: 'PLN/2026-27/0003', shop: SHOP_SAME, items: [{ description: 'Pro plan for 6 months', amount: 29994 }, { description: '6 months discount 10%', amount: -2999.4 }], issue: '2026-11-04', ref: 'pay_SAMPLE0003' })],
    ['04-plan-invoice-wallet-balance-used.pdf', 'Plan invoice where an old Partner wallet balance of Rs 400 was adjusted (GST already paid on it)', 'plan', 'Plan', doc({ no: 'PLN/2026-27/0004', shop: SHOP_SAME, items: [{ description: 'Growth plan for 1 month', amount: 2999 }, { description: 'Wallet balance adjusted (GST already paid on it)', amount: -400 }], issue: '2026-11-05', ref: 'pay_SAMPLE0004' })],
    ['05-plan-invoice-paid-outside-the-app.pdf', 'Plan invoice for a payment received outside the app (bank transfer, recorded by the admin)', 'plan', 'Plan', doc({ no: 'PLN/2026-27/0005', shop: SHOP_SAME, items: [{ description: 'Plan payment received (bank transfer)', amount: 2999 }], issue: '2026-11-06', mode: 'bank', ref: 'UTR SAMPLE 99887766' })],
    ['06-partner-wallet-top-up-invoice.pdf', 'Partner wallet top-up of Rs 500 with GST on top', 'wallet', 'Wallet top-up', doc({ no: 'TOP/2026-27/0001', kind: 'wallet_topup', shop: SHOP_NOGST, items: [{ description: 'Partner wallet top-up', amount: 500 }], issue: '2026-11-07', ref: 'pay_SAMPLE0006' })],
    ['07-sms-top-up-invoice.pdf', 'SMS balance top-up of Rs 200 with GST on top', 'sms', 'SMS top-up', doc({ no: 'TOP/2026-27/0002', kind: 'sms_topup', shop: SHOP_NOGST, items: [{ description: 'SMS balance top-up', amount: 200 }], issue: '2026-11-07', ref: 'pay_SAMPLE0007' })],
];
// credit notes: a refund of Rs 2,000 (GST included) on a plan, Rs 354 on wallet money, Rs 590 for a bank dispute the platform lost
const credit = (no, shop, base, desc, against, reason, issue) => doc({ no, kind: 'credit_note', shop, items: [{ description: desc, amount: base }], issue, credit: true, against, reason });
FILES.push(
    ['08-credit-note-plan-refund.pdf', 'Credit note: Rs 2,000 sent back for the unused part of a plan', 'plan', 'Plan', credit('CN/2026-27/0001', SHOP_SAME, 1694.92, 'Refund of a plan payment', 'PLN/2026-27/0001', 'Shop closing, unused 20 days refunded', '2026-11-20'), -1],
    ['09-credit-note-wallet-refund.pdf', 'Credit note: Rs 354 sent back for unused wallet money (Rs 300 + GST)', 'wallet', 'Wallet top-up', credit('CN/2026-27/0002', SHOP_NOGST, 300, 'Refund of wallet money', 'TOP/2026-27/0001', 'Owner asked, balance returned', '2026-11-21'), -1],
    ['10-credit-note-lost-bank-dispute.pdf', 'Credit note: the bank took Rs 590 back (a chargeback the platform lost)', 'wallet', 'Wallet top-up', credit('CN/2026-27/0003', SHOP_NOGST, 500, 'Bank dispute lost: money taken back', 'TOP/2026-27/0001', 'Bank dispute lost: the bank took the money back', '2026-11-25'), -1],
);

// the one-page-ish questions page for the CA, as a PDF with room to write the answers
const QUESTIONS = [
    ['The plan price', [
        'Is 18% GST right for our monthly plans, and which SAC code goes on the invoice?',
        'We add GST on top of the price. Is that the right way to show it?',
        'For 3 and 6 month plans we give a discount and charge GST on the reduced price. Is that correct?',
        'If an owner pays months in advance, is GST due now or month by month?',
    ]],
    ['The Partner wallet', [
        'The owner tops up Rs 500 and pays Rs 500 + 18% GST. Is it right to charge GST at top-up time?',
        'We then take Rs 3 to Rs 15 from the wallet per order. Does that fee need GST, and what invoice does it need?',
        'We count wallet money as our income only when it is used up. Is that the right way to show profit?',
    ]],
    ['Refunds', [
        'When we refund a plan or wallet top-up we make a credit note. Is that the right form and timing?',
        'Do we get the GST back when we refund?',
        'If a bank takes money back (a chargeback), what do we record?',
        'Our rule is "no refunds except mistakes". Is that fine for GST and consumer law?',
    ]],
    ['Other cases', [
        'Is a coupon a discount before GST, or something else?',
        'We give free days at the start. Does a free period need any invoice or GST?',
        'Sometimes the owner pays us directly by bank or UPI and we record it. Is the invoice timing right?',
        'Do we need e-invoicing (IRN/QR) at our size, and from what turnover?',
        'Our invoice numbers look like PLN/2026-27/0001 (plans), TOP/2026-27/0001 (top-ups) and CN/2026-27/0001 (credit notes). Is that fine?',
        'Do any GST or TCS duties fall on us when customers order from each shop\'s own app?',
        'How should your share and Vivek\'s share of the money be recorded?',
    ]],
];

function writeQuestionsPdf(file, files) {
    const PDFDocument = require('pdfkit');
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: 'Questions for the CA', Author: 'Sample Platform' } });
        const stream = fs.createWriteStream(file);
        stream.on('finish', resolve); stream.on('error', reject);
        doc.pipe(stream);
        const L = 48; const W = 595 - 96;
        const need = (h) => { if (doc.y + h > 800) doc.addPage(); };
        doc.font('Helvetica-Bold').fontSize(20).fillColor('#111827').text('Questions for the CA', L, 48);
        doc.font('Helvetica').fontSize(9.5).fillColor('#6b7280').text('Please read with the sample files in this folder. Every file is a SAMPLE: fake names, fake numbers, made by the app\'s real invoice code. Nothing here is a real invoice.', L, doc.y + 4, { width: W });
        doc.moveDown(0.8);
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827').text('How the money works, in four lines');
        doc.font('Helvetica').fontSize(10.5).fillColor('#1f2933');
        [
            'A shop owner pays us for a plan (Growth Rs 2,999 or Pro Rs 4,999 a month, paid in advance). We add 18% GST on top.',
            'Or the owner is on "Partner": no monthly price. He adds money to a wallet (GST on top) and we take Rs 3 to Rs 15 from it for each completed order.',
            'If we send money back we make a credit note. If a bank takes money back from us (a chargeback) we also make a credit note.',
            'We call wallet money our income only when it is used up as order fees. A top-up is only cash we hold until then.',
        ].forEach((t, i) => doc.text(`${i + 1}.  ${t}`, L + 6, doc.y + 3, { width: W - 6 }));
        doc.moveDown(1);
        let n = 0;
        for (const [group, qs] of QUESTIONS) {
            need(60);
            doc.font('Helvetica-Bold').fontSize(12).fillColor('#047857').text(group, L, doc.y + 4);
            doc.moveDown(0.3);
            for (const q of qs) {
                n += 1;
                need(62);
                const y = doc.y;
                doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#111827').text(`${n}.`, L, y, { width: 22 });
                doc.font('Helvetica').fontSize(10.5).fillColor('#111827').text(q, L + 22, y, { width: W - 22 });
                const yy = doc.y + 6;
                doc.moveTo(L + 22, yy + 14).lineTo(L + W, yy + 14).lineWidth(0.4).strokeColor('#d1d5db').stroke();
                doc.moveTo(L + 22, yy + 30).lineTo(L + W, yy + 30).lineWidth(0.4).strokeColor('#d1d5db').stroke();
                doc.y = yy + 36;
            }
            doc.moveDown(0.3);
        }
        need(120);
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827').text('The files in this folder', L, doc.y + 6);
        doc.moveDown(0.3);
        for (const [fname, what] of files) {
            need(34);
            const y = doc.y;
            doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#111827').text(fname, L, y, { width: 210 });
            doc.font('Helvetica').fontSize(9.5).fillColor('#1f2933').text(what, L + 220, y, { width: W - 220 });
            doc.y = Math.max(doc.y, y + 12) + 4;
        }
        need(70);
        doc.moveDown(0.8);
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text('Also for a lawyer (not the CA)', L, doc.y);
        doc.font('Helvetica').fontSize(10).fillColor('#1f2933').text('The Terms of Service and the Privacy Policy, the "no refund" wording, and the agreement between Ankit and Vivek.', L, doc.y + 2, { width: W });
        doc.end();
    });
}

(async () => {
    for (const [file, , , , d] of FILES) {
        const credit = d.kind === 'credit_note';
        fs.writeFileSync(path.join(OUT, file), await renderToBuffer(d, { creditNote: credit }));
    }
    // the register of the month: every document above, the credit notes as minus rows
    const rows = FILES.map(([, , , label, d, sign]) => ({
        ...gstRegister.row(d, { type: d.kind === 'credit_note' ? `Credit note (${label})` : label, sign: sign || 1, status: d.kind === 'credit_note' ? 'refunded' : 'paid', paidAt: d.paidAt }),
    })).sort((a, b) => new Date(a.date) - new Date(b.date));
    const sum = (k) => r2(rows.reduce((n, r) => n + r[k], 0));
    const buf = await buildSheet({
        title: 'GST register (SAMPLE) 2026-11', subtitle: `${rows.length} documents  ·  taxable Rs ${sum('taxable').toFixed(2)}  ·  GST Rs ${sum('gst').toFixed(2)}  ·  credit notes are minus rows`, total: true,
        columns: [
            { header: 'Date', key: 'date', kind: 'date' }, { header: 'Type', key: 'type' }, { header: 'Document no', key: 'docNo' }, { header: 'Against invoice', key: 'against' },
            { header: 'Buyer', key: 'buyer' }, { header: 'Buyer GSTIN', key: 'buyerGstin' }, { header: 'B2B / B2C', key: 'supply', kind: 'center' }, { header: 'Place of supply', key: 'placeOfSupply' },
            { header: 'Taxable value', key: 'taxable', kind: 'money' }, { header: 'GST %', key: 'gstPercent', kind: 'int' }, { header: 'CGST', key: 'cgst', kind: 'money' }, { header: 'SGST', key: 'sgst', kind: 'money' },
            { header: 'IGST', key: 'igst', kind: 'money' }, { header: 'Total', key: 'total', kind: 'money' },
        ],
        rows,
    });
    fs.writeFileSync(path.join(OUT, '11-gst-register-sample.xlsx'), buf);

    await writeQuestionsPdf(path.join(OUT, 'QUESTIONS-FOR-THE-CA.pdf'), FILES.map(([file, what]) => [file, what]).concat([['11-gst-register-sample.xlsx', "The month's GST register with all of the above. The credit notes are minus rows."]]));
    const old = path.join(OUT, 'QUESTIONS-FOR-THE-CA.md');
    if (fs.existsSync(old)) fs.unlinkSync(old);   // the questions are a PDF now
    console.log('Made', FILES.length + 2, 'files in', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
