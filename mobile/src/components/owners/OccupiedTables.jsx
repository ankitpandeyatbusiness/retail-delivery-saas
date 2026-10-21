// Under the order pipeline: every table somebody is sitting at, as a blinking block. Tap one for the whole story:
// who is there, what they ordered, add-ons, and the time of every order. A table that is asking for the bill, or has
// finished eating without paying, glows amber.
import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { SectionTitle } from './ui';
import BillSheet from './BillSheet';
import PartyPickSheet from './PartyPickSheet';
import { TableCell, sortTables } from '../../screens/owners/OwnerDineInScreen';
import { fetchDineTables } from '../../api/owners/shopApi';
import { onNotification, onOrderUpdate } from '../../api/common/socket';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { tr } from '../../i18n';

export default function OccupiedTables() {
    const nav = useNavigation();
    const enabled = !!useHomeStore((st) => st.full.orders.dineIn?.enabled);
    const [tables, setTables] = useState([]);
    const [open, setOpen] = useState(null);
    const [pick, setPick] = useState(null);   // a table with several bills: which one to open
    const openTable = (t) => { if ((t.parties || []).length > 1) setPick(t); else setOpen(t); };
    const load = useCallback(() => { fetchDineTables().then((r) => setTables((r.items || []).filter((t) => t.state !== 'free'))).catch(() => { }); }, []);
    useFocusEffect(useCallback(() => {
        load();   // even with Dine in switched off: guests who are still seated must stay visible
        if (!enabled) return undefined;
        const t = setInterval(load, 20000);
        const a = onNotification(load);
        const b = onOrderUpdate(load);
        return () => { clearInterval(t); a(); b(); };
    }, [enabled, load]));
    if (!tables.length) return null;
    return (
        <View>
            <SectionTitle title={tr('Tables in use')} action={tr('All tables')} onAction={() => nav.navigate('OwnerDineIn')} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16 }}>
                {sortTables(tables).map((t) => <TableCell key={t.table} t={t} blink onPress={() => openTable(t)} />)}
            </View>
            <PartyPickSheet visible={!!pick} title={pick ? tr('Table {t}: which bill?', { t: pick.table }) : ''} options={(pick?.parties || []).map((p) => ({ ...p, sub: p.state === 'bill_asked' ? tr('Wants the bill') : tr('Eating') }))} onPick={(p) => { setOpen({ ...pick, ...p }); setPick(null); }} onClose={() => setPick(null)} />
            <BillSheet table={open} onClose={() => setOpen(null)} onDone={load} />
        </View>
    );
}
