// The story of one table's bill: who sat there, and every round with its items, add-ons, notes and times.
// Used by the table popup (Tables) and the unpaid-bill popup (Orders -> Unpaid bills).
import React from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import { Pill } from './ui';
import PersonAvatar from './PersonAvatar';
import WaitTimer, { ServedIn } from '../common/WaitTimer';
import { tr } from '../../i18n';

export const rs = (n) => `₹${Math.round(n * 100) / 100}`;
export const hm = (d) => { if (!d) return ''; const x = new Date(d); const h = x.getHours(); return `${h % 12 || 12}:${String(x.getMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
const mins = (d) => Math.max(1, Math.round((Date.now() - new Date(d).getTime()) / 60000));
// the people who ordered at this table (from the rounds)
const guests = (bill) => { const m = new Map(); for (const r of bill.rounds) { const c = r.customer; if (!c) continue; const key = c.phone || c.name || r.id; if (!m.has(key)) m.set(key, { key, ...c }); } return [...m.values()]; };
const VIA = { cash: 'Cash', upi: 'UPI at the counter', online: 'Online' };
const STATE = { placed: 'Waiting', accepted: 'Accepted', preparing: 'Preparing', ready: 'Ready to serve', delivered: 'Served' };

export default function BillDetails({ bill }) {
    const { text, muted, ok, warn } = useBrand();
    return (
        <View>
                    <Text style={{ color: muted, marginBottom: 8 }}>{bill.closedAt ? tr('Seated at {time} · left at {time2}', { time: hm(bill.openedAt), time2: hm(bill.closedAt) }) : tr('Seated at {time} · {m} min ago', { time: hm(bill.openedAt), m: mins(bill.openedAt) })}</Text>
                    {(bill.guests?.length ? bill.guests : guests(bill)).map((g) => (
                        <View key={g.id || g.key} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                            <PersonAvatar photo={g.photo} size={36} />
                            <Text style={{ color: text, fontWeight: '800', flex: 1, marginLeft: 10 }} numberOfLines={1}>{g.name || tr('Customer')}{g.phone ? `  ·  ${g.phone}` : ''}</Text>
                            {g.phone ? <Pressable onPress={() => Linking.openURL('tel:' + g.phone)} hitSlop={8}><Ionicons name="call" size={20} color={ok} /></Pressable> : null}
                        </View>
                    ))}
                    {(bill.shares || []).length > 1 ? (
                        <View style={{ marginBottom: 10, padding: 10, borderRadius: 12, backgroundColor: alpha(muted, 0.1) }}>
                            <Text style={{ color: muted, fontWeight: '800', fontSize: 12.5, marginBottom: 4 }}>{tr('WHO ORDERED AND WHO PAID')}</Text>
                            {bill.shares.map((x) => (
                                <View key={x.userId} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 2 }}>
                                    <Text style={{ color: text, fontWeight: '800', flex: 1 }} numberOfLines={1}>{x.name || tr('Guest')}</Text>
                                    <Text style={{ color: muted, fontSize: 12.5 }}>{tr('ordered')} {rs(x.total)}  ·  </Text>
                                    <Text style={{ color: x.due > 0 ? warn : ok, fontWeight: '800', fontSize: 12.5 }}>{x.due > 0 ? `${tr('left')} ${rs(x.due)}` : tr('paid')}</Text>
                                </View>
                            ))}
                        </View>
                    ) : null}
                    {bill.rounds.map((r, i) => (
                        <View key={r.id} style={{ marginBottom: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: alpha(muted, 0.2) }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Text style={{ color: text, fontWeight: '900', flex: 1 }}>{tr('Round {n}', { n: i + 1 })}{r.by?.name ? ` · ${r.by.name}` : ''} · #{r.orderNo} · {hm(r.at)}</Text>
                                <Pill label={tr(STATE[r.status] || r.status)} color={r.status === 'delivered' ? ok : warn} />
                                <View style={{ marginLeft: 6 }}><Pill label={r.paid ? tr('Paid') : tr('Not paid')} color={r.paid ? ok : warn} /></View>
                            </View>
                            {r.items.map((it, k) => (
                                <View key={k} style={{ marginTop: 3 }}>
                                    <Text style={{ color: text }}>{it.quantity}× {it.name}  ·  {rs(it.total)}</Text>
                                    {it.addons?.length ? <Text style={{ color: muted, fontSize: 12.5 }}>+ {it.addons.join(', ')}</Text> : null}
                                    {it.note ? <Text style={{ color: muted, fontSize: 12.5 }}>“{it.note}”</Text> : null}
                                </View>
                            ))}
                            {r.paid ? <Text style={{ color: ok, fontWeight: '800', fontSize: 12.5, marginTop: 4 }}>{tr('Paid')}{r.paidBy?.name ? ` · ${r.paidBy.name}` : ''}{` · ${tr(VIA[r.paidVia] || 'At the counter')}`}{r.paidAt ? ` · ${hm(r.paidAt)}` : ''}</Text> : null}
                            {r.note ? <View style={{ marginTop: 6, padding: 8, borderRadius: 10, backgroundColor: alpha(warn, 0.16) }}><Text style={{ color: text, fontWeight: '900', fontSize: 14.5 }}>{r.note}</Text></View> : null}
                            <Text style={{ color: muted, fontSize: 12, marginTop: 4 }}>
                                {[`${tr('Ordered')} ${hm(r.times?.placed)}`, r.times?.accepted ? `${tr('Accepted')} ${hm(r.times.accepted)}` : '', r.times?.ready ? `${tr('Ready')} ${hm(r.times.ready)}` : '', r.times?.served ? `${tr('Served')} ${hm(r.times.served)}` : ''].filter(Boolean).join('  ·  ')}
                            </Text>
                            <View style={{ marginTop: 4 }}>{r.status === 'delivered' ? <ServedIn times={r.times} /> : <WaitTimer since={r.times?.placed || r.at} />}</View>
                        </View>
                    ))}
        </View>
    );
}
