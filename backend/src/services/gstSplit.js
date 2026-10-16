// GST on the platform's own invoices (rent, setup, SMS top-ups): which tax heads apply.
//   Seller and buyer in the SAME state  -> CGST + SGST (half each)
//   Different states                    -> IGST (all of it)
// The seller's state comes from the platform business (state code, or the first two digits of its GSTIN). The buyer's state
// comes from his GSTIN, else the state saved in his shop address. When the buyer's state is not known the supply is treated
// as inside the seller's state (for a customer without a GSTIN the place of supply is where the service is supplied from).
const STATES = {
    '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
    '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', 10: 'Bihar', 11: 'Sikkim', 12: 'Arunachal Pradesh', 13: 'Nagaland',
    14: 'Manipur', 15: 'Mizoram', 16: 'Tripura', 17: 'Meghalaya', 18: 'Assam', 19: 'West Bengal', 20: 'Jharkhand', 21: 'Odisha',
    22: 'Chhattisgarh', 23: 'Madhya Pradesh', 24: 'Gujarat', 26: 'Dadra and Nagar Haveli and Daman and Diu', 27: 'Maharashtra',
    28: 'Andhra Pradesh (old)', 29: 'Karnataka', 30: 'Goa', 31: 'Lakshadweep', 32: 'Kerala', 33: 'Tamil Nadu', 34: 'Puducherry',
    35: 'Andaman and Nicobar Islands', 36: 'Telangana', 37: 'Andhra Pradesh', 38: 'Ladakh',
};

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '');
const BY_NAME = new Map(Object.entries(STATES).map(([code, name]) => [norm(name), String(code).padStart(2, '0')]));
BY_NAME.set('andhrapradesh', '37');
BY_NAME.set('jammuandkashmir', '01');
BY_NAME.set('up', '09');

const codeFromGstin = (g) => (/^\d{2}[A-Z0-9]{13}$/i.test(String(g || '')) ? String(g).slice(0, 2) : null);
const codeFromName = (n) => BY_NAME.get(norm(n)) || null;
const nameOf = (code) => STATES[code] || STATES[Number(code)] || null;

function stateOf({ stateCode, state, gstin }) {
    const code = (/^\d{2}$/.test(String(stateCode || '')) && stateCode) || codeFromGstin(gstin) || codeFromName(state);
    return code ? { code, name: nameOf(code) || state || '' } : null;
}

// seller / buyer: { stateCode?, state?, gstin? }.  gstAmount: the tax in rupees.
function split({ seller, buyer, gstAmount }) {
    const gst = round2(gstAmount || 0);
    const s = stateOf(seller || {});
    const b = stateOf(buyer || {}) || s;
    const intra = !s || !b || s.code === b.code;
    const cgst = intra ? round2(gst / 2) : 0;
    return {
        placeOfSupply: b ? { code: b.code, name: b.name } : undefined,
        intraState: intra,
        cgst,
        sgst: intra ? round2(gst - cgst) : 0,
        igst: intra ? 0 : gst,
    };
}

module.exports = { STATES, stateOf, codeFromGstin, codeFromName, nameOf, split, round2 };
