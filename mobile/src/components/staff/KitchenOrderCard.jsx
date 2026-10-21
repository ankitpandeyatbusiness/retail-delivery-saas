// One order on the kitchen screen: big number, where it goes, the dishes the way a cook reads them, and one big button for the next step.
// It follows the light and dark look (every colour comes from the shop's theme), and a late order turns red.
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import { VegDot } from '../customers/shop';
import { BigButton, UndoLink, useMinuteClock, clock, minsSince, minWord } from './staffBits';
import { tr } from '../../i18n';

function where(o) {
    if (o.orderType === 'dine_in') return { icon: 'restaurant', text: o.tableNo ? (tr('Table {n}', { n: o.tableNo }) + (o.party ? ` · ${o.party}` : '')) : tr('Dine in') };
    if (o.orderType === 'pickup') return { icon: 'bag-handle', text: o.scheduledFor ? tr('Pickup {time}', { time: clock(o.scheduledFor) }) : tr('Pickup') };
    return { icon: 'bicycle', text: tr('Delivery') };
}

export default function KitchenOrderCard({ o, lateMin, busy, onAct, onProblem, onUndo }) {
    const { surface, border, text, muted, primary, onPrimary, ok, error, warn } = useBrand();
    useMinuteClock();
    const w = where(o);
    const ready = o.stage === 'ready';
    const cooking = o.stage === 'cooking';
    // the clock on the card: how long it has waited (new), how long it has been cooking, or how long it has been ready
    const mins = ready ? minsSince(o.readyAt || o.acceptedAt) : cooking ? minsSince(o.startedAt || o.startAt) : Math.max(0, minsSince(o.startAt));
    const lateNow = !ready && minsSince(o.startAt) >= lateMin;
    const edge = lateNow ? error : ready ? ok : cooking ? primary : border;

    return (
        <View style={{ backgroundColor: surface, borderColor: lateNow ? alpha(error, 0.55) : border, borderWidth: lateNow ? 1.5 : 1, borderLeftColor: edge, borderLeftWidth: 5, borderRadius: 18, padding: 14, marginHorizontal: 16, marginBottom: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ color: text, fontSize: 24, fontWeight: '900' }}>#{o.orderNo}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 10, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 99, backgroundColor: alpha(primary, 0.14), flexShrink: 1 }}>
                    <Ionicons name={w.icon} size={13} color={primary} style={{ marginRight: 4 }} />
                    <Text numberOfLines={1} style={{ color: primary, fontWeight: '800', fontSize: 12.5, flexShrink: 1 }}>{w.text}</Text>
                </View>
                <View style={{ flex: 1 }} />
                <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: lateNow ? error : ready ? ok : text, fontWeight: '900', fontSize: 16 }}>{ready ? tr('Ready') : minWord(mins)}</Text>
                    <Text style={{ color: lateNow ? error : muted, fontSize: 11.5, fontWeight: '700' }}>
                        {ready ? tr('{time} ago', { time: minWord(mins) }) : lateNow ? tr('Late') : cooking ? tr('Cooking') : o.early ? tr('Starts {time}', { time: clock(o.startAt) }) : tr('Waiting')}
                    </Text>
                </View>
            </View>
            {o.who ? <Text style={{ color: muted, fontWeight: '700', marginTop: 4 }}>{o.who}</Text> : null}
            {o.intent && o.intent !== 'on_time' ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 99, backgroundColor: alpha(o.intent === 'arrived' ? ok : primary, 0.16) }}>
                    <Ionicons name={o.intent === 'arrived' ? 'location' : o.intent === 'coming' ? 'walk' : 'time'} size={13} color={o.intent === 'arrived' ? ok : primary} style={{ marginRight: 4 }} />
                    <Text style={{ color: o.intent === 'arrived' ? ok : primary, fontWeight: '800', fontSize: 12.5 }}>{o.intent === 'arrived' ? tr('Customer is here') : o.intent === 'coming' ? tr('Customer is coming') : o.intent === 'late' ? tr('Customer is late') : tr('Needs more time')}</Text>
                </View>
            ) : null}

            <View style={{ marginTop: 10 }}>
                {o.items.map((l, i) => (
                    <View key={`${l.productId}-${i}`} style={{ flexDirection: 'row', paddingVertical: 6, borderTopWidth: i ? 0.5 : 0, borderTopColor: border }}>
                        <Text style={{ width: 44, color: primary, fontWeight: '900', fontSize: 22 }}>{l.measure ? '' : `${l.quantity}×`}</Text>
                        <View style={{ flex: 1, minWidth: 0 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                {l.isVeg !== null ? <View style={{ marginRight: 6 }}><VegDot isVeg={l.isVeg} /></View> : null}
                                <Text style={{ color: text, fontWeight: '800', fontSize: 17, flexShrink: 1 }}>{l.measure ? `${l.measure} ` : ''}{l.name}</Text>
                            </View>
                            {l.options.length ? <Text style={{ color: muted, fontWeight: '600', fontSize: 14, marginTop: 1 }}>{l.options.join(' · ')}</Text> : null}
                            {l.note ? (
                                <View style={{ alignSelf: 'flex-start', marginTop: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: alpha(warn, 0.18) }}>
                                    <Text style={{ color: warn, fontWeight: '800', fontSize: 13.5 }}>{l.note}</Text>
                                </View>
                            ) : null}
                        </View>
                    </View>
                ))}
            </View>

            {o.note ? (
                <View style={{ flexDirection: 'row', marginTop: 8, padding: 10, borderRadius: 12, backgroundColor: alpha(warn, 0.14) }}>
                    <Ionicons name="chatbubble-ellipses-outline" size={16} color={warn} style={{ marginRight: 8, marginTop: 1 }} />
                    <Text style={{ color: text, fontWeight: '700', flex: 1, fontSize: 14.5 }}>{o.note}</Text>
                </View>
            ) : null}

            {o.problem ? (
                o.problem.handledAt ? (
                    <Text style={{ color: ok, fontWeight: '700', fontSize: 12.5, marginTop: 8 }}>
                        {o.problem.handledAction === 'tell' ? tr('The owner has told the customer. Please carry on.') : tr('The owner says: please carry on.')}
                    </Text>
                ) : (
                    <Text style={{ color: warn, fontWeight: '700', fontSize: 12.5, marginTop: 8 }}>
                        {tr('You told the owner')}: {o.problem.dish ? `${o.problem.dish} · ` : ''}{o.problem.kind === 'out_of_stock' ? tr('a dish is finished') : o.problem.kind === 'cannot_make' ? tr('cannot be made') : o.problem.note}
                    </Text>
                )
            ) : null}

            {ready ? (
                <Text style={{ color: muted, fontWeight: '600', marginTop: 10, fontSize: 13 }}>
                    {o.orderType === 'delivery' ? tr('Packed. Waiting for the delivery partner.') : o.orderType === 'dine_in' ? tr('Waiting to be served.') : tr('Waiting for the customer.')}
                    {o.readyByName ? `  ·  ${o.readyByName}` : ''}
                </Text>
            ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
                    <Pressable onPress={onProblem} hitSlop={8} style={({ pressed }) => ({ paddingVertical: 12, paddingRight: 14, opacity: pressed ? 0.6 : 1 })} accessibilityRole="button" accessibilityLabel={tr('Tell the owner about a problem')}>
                        <Ionicons name="alert-circle-outline" size={26} color={warn} />
                    </Pressable>
                    <View style={{ flex: 1 }}>
                        {cooking
                            ? <BigButton label={tr('Ready')} icon="checkmark-done" busy={busy} bg={ok} ink="#FFFFFF" onPress={() => onAct('ready')} />
                            : <BigButton label={tr('Start cooking')} icon="flame" busy={busy} bg={primary} ink={onPrimary} onPress={() => onAct('start')} />}
                    </View>
                </View>
            )}
            <UndoLink undo={o.undo} busy={busy} onPress={onUndo} />
            {cooking && o.startedByName ? <Text style={{ color: muted, fontSize: 12, marginTop: 6 }}>{tr('Started by {name}', { name: o.startedByName })}</Text> : null}
        </View>
    );
}
