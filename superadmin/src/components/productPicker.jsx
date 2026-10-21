import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable } from 'react-native';
import { ActivityIndicator } from './Loading';
import { useTheme, spacing, font } from '../theme';
import { Sheet, SheetList } from './feedback';
import { SearchBar } from './inputs';
import { Button } from './ui';
import { VegMark } from './catalogBits';
import Icon from './Icon';
import usePagedList from '../hooks/usePagedList';
import { listRecords } from '../api/catalogApi';
import { rupees } from '../utils/format';

/*
 * Choose items of a shop (for a collection). `selected` is a list of product ids; max items can be picked.
 * onDone(ids, productsById) gives back the chosen ids and what is known about them (name, price).
 */
export default function ProductPicker({ visible, onClose, shopId, selected = [], max = 30, onDone }) {
    const t = useTheme();
    const [q, setQ] = useState('');
    const [dq, setDq] = useState('');
    const [picked, setPicked] = useState(selected);
    const [known, setKnown] = useState({});
    useEffect(() => { if (visible) setPicked(selected); }, [visible]);   // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { const id = setTimeout(() => setDq(q.trim()), 300); return () => clearTimeout(id); }, [q]);

    const list = usePagedList(
        (page) => listRecords(shopId, 'products', { page, limit: 30, active: 'true', ...(dq ? { q: dq } : {}) }).then((r) => {
            setKnown((k) => ({ ...k, ...Object.fromEntries(r.items.map((p) => [String(p._id), p])) }));
            return r;
        }),
        [shopId, dq, visible],
    );

    const toggle = (id) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= max ? cur : [...cur, id]));

    return (
        <Sheet visible={visible} onClose={onClose} title={`Choose items (${picked.length}/${max})`}>
            <SearchBar value={q} onChangeText={setQ} placeholder="Search items" />
            <View style={{ height: 320, marginTop: spacing.md }}>
                {list.state === 'loading' ? <ActivityIndicator color={t.primary} style={{ marginTop: 40 }} /> : (
                    <SheetList
                        data={list.items}
                        keyExtractor={(p) => String(p._id)}
                        onEndReached={list.loadMore}
                        ListEmptyComponent={<Text style={{ color: t.muted, textAlign: 'center', marginTop: 40 }}>No items found.</Text>}
                        renderItem={({ item: p }) => {
                            const id = String(p._id);
                            const on = picked.includes(id);
                            return (
                                <Pressable onPress={() => toggle(id)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, borderBottomWidth: 0.5, borderBottomColor: t.border }}>
                                    <VegMark isVeg={p.isVeg} />
                                    <View style={{ flex: 1, marginLeft: spacing.md }}>
                                        <Text style={{ color: t.text, fontWeight: '700', fontSize: font.md }} numberOfLines={1}>{p.name}</Text>
                                        <Text style={{ color: t.muted, fontSize: font.sm }}>{rupees(p.price)}</Text>
                                    </View>
                                    <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: on ? t.primary : 'transparent', borderWidth: on ? 0 : 1.5, borderColor: t.border, alignItems: 'center', justifyContent: 'center' }}>
                                        {on ? <Icon name="check" size={16} color="#FFFFFF" /> : null}
                                    </View>
                                </Pressable>
                            );
                        }}
                    />
                )}
            </View>
            <Button title={`Use ${picked.length} item${picked.length === 1 ? '' : 's'}`} onPress={() => { onDone(picked, known); onClose(); }} style={{ marginTop: spacing.md }} />
        </Sheet>
    );
}
