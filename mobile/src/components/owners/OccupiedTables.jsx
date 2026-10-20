// Under the order pipeline: every table somebody is sitting at, as a blinking block. Tap one for the whole story:
// who is there, what they ordered, add-ons, and the time of every order. A table that is asking for the bill, or has
// finished eating without paying, glows amber.
import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { SectionTitle } from './ui';
import BillSheet from './BillSheet';
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
    const load = useCallback(() => { fetchDineTables().then((r) => setTables((r.items || []).filter((t) => t.state !== 'free'))).catch(() => { }); }, []);
    useFocusEffect(useCallback(() => {
        if (!enabled) return undefined;
        load();
        const t = setInterval(load, 20000);
        const a = onNotification(load);
        const b = onOrderUpdate(load);
        return () => { clearInterval(t); a(); b(); };
    }, [enabled, load]));
    if (!enabled || !tables.length) return null;
    return (
        <View>
            <SectionTitle title={tr('Tables in use')} action={tr('All tables')} onAction={() => nav.navigate('OwnerDineIn')} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16 }}>
                {sortTables(tables).map((t) => <TableCell key={t.table} t={t} blink onPress={() => setOpen(t)} />)}
            </View>
            <BillSheet table={open} onClose={() => setOpen(null)} onDone={load} />
        </View>
    );
}
