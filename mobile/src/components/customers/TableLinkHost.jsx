// Listens for a table link (the page a table QR opens hands over to the app) and sets the table. Renders nothing.
import { useEffect } from 'react';
import { Linking } from 'react-native';
import { useAuthStore } from '../../store/common/useAuthStore';
import { applyTableLink, parseTableLink } from '../../utils/customers/tableLink';
import { showToast } from './shop';
import { tr } from '../../i18n';

export default function TableLinkHost({ onDone }) {
    const role = useAuthStore((s) => s.user?.role);
    const skip = role === 'admin' || role === 'rider';   // only customers sit at a table
    useEffect(() => {
        if (skip) return undefined;
        const handle = async (url) => {
            if (!parseTableLink(url)) return;
            const r = await applyTableLink(url);
            if (r.ok) { showToast(tr('You are at table {n}', { n: r.table })); onDone?.(); } else showToast(tr(r.message));
        };
        Linking.getInitialURL().then((u) => { if (u) handle(u); }).catch(() => { });
        const sub = Linking.addEventListener('url', (e) => handle(e.url));
        return () => sub.remove();
    }, [skip, onDone]);
    return null;
}
