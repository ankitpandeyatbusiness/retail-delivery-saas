// What every document the PLATFORM issues to a shop shares: the number, the two parties, and the tax split.
// GST rule 46: an invoice number is at most 16 characters (letters, digits, / and -). So:
//   no prefix    SUB/2026-27/0001  (rent / setup bill)   TOP/2026-27/0001  (SMS top-up)   CN/2026-27/0001  (credit note)
//   with prefix  BABC/26-27/0001   (B bill, T top-up, C credit note, then the prefix of up to 4 letters or digits)
// <prefix> is the "invoice prefix" of the business that issues them (Platform, Business details). A new prefix starts a new
// series from 0001, which is what a new GSTIN needs.
const Counter = require('../models/Counter');
const PlatformSettings = require('../models/PlatformSettings');
const gst = require('./gstSplit');

const IST_OFFSET_MS = 330 * 60 * 1000;
const KEYS = { SUB: 'subinv', TOP: 'topinv', CN: 'cnote' };
const KIND_CHAR = { SUB: 'B', TOP: 'T', CN: 'C' };   // one letter in front of a prefix, to stay within 16 characters

// Indian financial year (April to March) of a moment: 2026-10-05 -> "2026-27"
function financialYearOf(date = new Date()) {
    const d = new Date(date.getTime() + IST_OFFSET_MS);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const start = m >= 4 ? y : y - 1;
    return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

const cleanPrefix = (p) => String(p || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
const shortYear = (fy) => `${fy.slice(2, 4)}-${fy.slice(5)}`;   // 2026-27 -> 26-27

// Takes the next number. Returns { invoiceNo, undo }: call undo() if saving the document failed, so numbers stay continuous.
async function allocate(kind, { now = new Date(), prefix } = {}) {
    const p = prefix === undefined ? cleanPrefix((await PlatformSettings.findById('main').select('business.invoicePrefix').lean())?.business?.invoicePrefix) : cleanPrefix(prefix);
    const fy = financialYearOf(now);
    const base = KEYS[kind];
    const id = p ? `${base}:${p}:${fy}` : `${base}:${fy}`;   // no prefix keeps the counters that already exist
    const counter = await Counter.findOneAndUpdate({ _id: id }, { $inc: { seq: 1 } }, { returnDocument: 'after', upsert: true });
    return {
        invoiceNo: p ? `${KIND_CHAR[kind]}${p}/${shortYear(fy)}/${String(counter.seq).padStart(4, '0')}` : `${kind}/${fy}/${String(counter.seq).padStart(4, '0')}`,
        undo: () => Counter.updateOne({ _id: id, seq: counter.seq }, { $inc: { seq: -1 } }),
    };
}

// seller = the platform business (PlatformSettings.business), tenant = the shop. Copies of the details are saved on each document.
function parties(business, tenant) {
    const b = business || {};
    const biz = tenant.business || {};
    const addr = tenant.address || {};
    return {
        seller: {
            legalName: b.legalName, address: b.address, gstin: b.gstin, pan: b.pan, email: b.email, phone: b.phone,
            sacCode: b.sacCode, paymentInstructions: b.paymentInstructions, state: b.state, stateCode: b.stateCode,
        },
        buyer: {
            legalName: biz.legalName || tenant.name,
            address: [addr.line, addr.city, addr.state, addr.pincode].filter(Boolean).join(', '),
            gstin: biz.gstin,
            phone: tenant.phone,
            state: addr.state,
        },
    };
}

// the tax heads for an amount of GST between these two parties
function taxFor({ seller, buyer, gstAmount }) {
    const s = gst.split({ seller, buyer, gstAmount });
    return {
        placeOfSupply: s.placeOfSupply,
        taxSplit: { intraState: s.intraState, cgst: s.cgst, sgst: s.sgst, igst: s.igst },
    };
}

module.exports = { allocate, parties, taxFor, financialYearOf, cleanPrefix };
