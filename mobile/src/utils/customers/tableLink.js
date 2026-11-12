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
    const s = String(url || '').trim();
    const m = /(?:\/dinein\/t\/[a-z0-9-]+\/|^[a-z][a-z0-9+.-]*:\/\/table\/)(\d{1,3})\/?\?(?:[^#]*&)?k=([A-Za-z0-9_-]+)/i.exec(s);
    if (m) return { table: m[1], k: m[2] };
    // the website opened from a table QR: https://<shop address>/?table=7&k=...
    const w = /[?&]table=(\d{1,3})&k=([A-Za-z0-9_-]+)/.exec(s);
    if (w) return { table: w[1], k: w[2] };
    // the printed short address, opened straight by the app (Android App Links / iPhone Universal Links): https://<address>/q/t/<shop>/7. The server signs it.
    const q = /^https:\/\/[^/]+\/q\/t\/[a-z0-9-]+\/(\d{1,3})\/?(?:[?#].*)?$/i.exec(s);
    return q ? { table: q[1], short: true } : null;
}

// Checks the code with the shop, then sets the table and the dine in mode. Returns { ok, table } or { ok: false, message }.
export async function applyTableLink(url) {
    const p = parseTableLink(url);
    if (!p) return { ok: false, message: 'This is not a table QR code of this shop' };
    try {
        const lock = tableLock(p.table);
        if (lock) return { ok: false, message: lock };
        const r = await api.post('/dinein/scan', p);
        useOrderMode.getState().setTable(r.data.table, p.k || r.data.k);   // choosing a table also switches to dine in
        return { ok: true, table: r.data.table };
    } catch (e) {
        return { ok: false, message: e?.response?.data?.error || 'Could not check this QR code. Please try again.' };
    }
}
