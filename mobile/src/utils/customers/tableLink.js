// A table QR, as the app sees it. The code holds either the shop's web link (…/api/dinein/t/<shop>/<table>?k=…, from a phone camera)
// or the app link (<shop>://table/<table>?k=…, from the page that opens the app). Both carry the table number and the server's signature.
import api from '../../api/common/client';
import { useOrderMode } from '../../store/customers/useOrderMode';
import { useTableBill } from '../../store/customers/useTableBill';

// null when he may sit at this table; otherwise the sentence to show (his bill at another table is still open)
export function tableLock(table) {
    const b = useTableBill.getState().bill;
    if (b?.open && String(b.table) !== String(table)) return `You still have an open bill at table ${b.table}. Pay it before moving to another table.`;
    return null;
}

export function parseTableLink(url) {
    const m = /(?:\/dinein\/t\/[a-z0-9-]+\/|^[a-z][a-z0-9+.-]*:\/\/table\/)(\d{1,3})\/?\?(?:[^#]*&)?k=([A-Za-z0-9_-]+)/i.exec(String(url || '').trim());
    return m ? { table: m[1], k: m[2] } : null;
}

// Checks the code with the shop, then sets the table and the dine in mode. Returns { ok, table } or { ok: false, message }.
export async function applyTableLink(url) {
    const p = parseTableLink(url);
    if (!p) return { ok: false, message: 'This is not a table QR code of this shop' };
    try {
        const lock = tableLock(p.table);
        if (lock) return { ok: false, message: lock };
        const r = await api.post('/dinein/scan', p);
        useOrderMode.getState().setTable(r.data.table);   // choosing a table also switches to dine in
        return { ok: true, table: r.data.table };
    } catch (e) {
        return { ok: false, message: e?.response?.data?.error || 'Could not check this QR code. Please try again.' };
    }
}
