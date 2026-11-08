// The service inquiries (party booking, tiffin, the shop's own services) where a customer wrote and the owner has not opened the conversation yet.
// The server keeps that as ownerUnread: it is set when the inquiry arrives or the customer writes again, and cleared the moment the owner opens it.
// Real time: a new inquiry or a customer's message comes by the live connection, and opening the conversation (on this phone or another) changes it back.
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useMenuFlags } from '../../utils/owners/menuFlags';
import { inquiries as inquiryApi } from '../../api/owners/shopApi';
import { onChatMessage, onChatStatus, onNotification } from '../../api/common/socket';

export function useInquiriesWaiting() {
    const servicesOn = useMenuFlags((s) => s.servicesOn);   // the super admin's switch for Services
    const [items, setItems] = useState([]);
    const load = useCallback(() => {
        if (!servicesOn) { setItems([]); return Promise.resolve(); }
        return inquiryApi.list({ status: 'all' })
            .then((r) => setItems((r.items || []).filter((x) => x.ownerUnread > 0 && x.status !== 'closed')))
            .catch(() => { });
    }, [servicesOn]);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    useEffect(() => {
        let timer = null;
        const soon = () => { clearTimeout(timer); timer = setTimeout(load, 300); };   // several messages close together make one load
        const offs = [
            onNotification((n) => { if (String(n?.type || '').startsWith('inquiry_')) soon(); }),
            onChatMessage((p) => { if (!p?.kind || p.kind === 'inquiry') soon(); }),
            onChatStatus((p) => { if (!p?.kind || p.kind === 'inquiry') soon(); }),   // read on another phone
        ];
        const app = AppState.addEventListener('change', (st) => { if (st === 'active') soon(); });   // a message sent while the phone slept is lost
        return () => { offs.forEach((off) => off()); app.remove(); clearTimeout(timer); };
    }, [load]);
    return { items, reload: load };
}
