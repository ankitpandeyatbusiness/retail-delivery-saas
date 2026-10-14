import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Badge } from './ui';
import Icon from './Icon';
import { useTheme, spacing, radius, font } from '../theme';
import { rupees, ago, titleCase } from '../utils/format';

// status -> label and colour. Colours: blue = new, amber = in the kitchen, teal = on the way, green = done, red = stopped.
export const STATUS = {
    placed: { label: 'New', tone: 'info', edge: 'info' },
    accepted: { label: 'Accepted', tone: 'primary', edge: 'primary' },
    preparing: { label: 'Preparing', tone: 'warn', edge: 'warn' },
    ready: { label: 'Ready', tone: 'success', edge: 'success' },
    out_for_delivery: { label: 'Out for delivery', tone: 'success', edge: 'success' },
    delivered: { label: 'Delivered', tone: 'success', edge: 'success' },
    cancelled: { label: 'Cancelled', tone: 'danger', edge: 'danger' },
    undelivered: { label: 'Not delivered', tone: 'danger', edge: 'danger' },
};
export const ACTIVE = ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery'];

export const FLOW = {
    delivery: ['placed', 'accepted', 'preparing', 'out_for_delivery', 'delivered'],
    other: ['placed', 'accepted', 'preparing', 'ready', 'delivered'],
};
export const nextOf = (order) => {
    const flow = order.orderType === 'delivery' ? FLOW.delivery : FLOW.other;
    const i = flow.indexOf(order.status);
    return i >= 0 && i < flow.length - 1 ? flow[i + 1] : null;
};

export const TYPE_ICON = { delivery: 'rider', pickup: 'box', dine_in: 'food' };
export const TYPE_LABEL = { delivery: 'Delivery', pickup: 'Pickup', dine_in: 'Dine in' };
export const payLabel = (p) => {
    if (!p) return '—';
    const m = { cod: 'Cash', upi: 'UPI', card: 'Card', wallet: 'Wallet' }[p.method] || titleCase(p.method);
    return p.method === 'cod' ? m : `${m} · ${titleCase(p.status || 'pending')}`;
};
export const maskedPhone = (p) => (/^\d{10}$/.test(p || '') ? `${p.slice(0, 2)}XXXXXX${p.slice(-2)}` : p || '');

export function StatusBadge({ status }) {
    const s = STATUS[status] || { label: titleCase(status || ''), tone: 'neutral' };
    return <Badge label={s.label} tone={s.tone} />;
}

// one order in a list: coloured edge shows the state
export function OrderRow({ order, onPress, showShop = true }) {
    const t = useTheme();
    const s = STATUS[order.status] || { edge: 'neutral' };
    const edge = { info: t.info, primary: t.primary, warn: t.warn, success: t.success, danger: t.danger, neutral: t.muted }[s.edge];
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [st.row, { backgroundColor: t.surface, opacity: pressed ? 0.9 : 1 }, t.shadow]}
        >
            <View style={[st.edge, { backgroundColor: edge }]} />
            <View style={{ flex: 1, padding: spacing.md, paddingLeft: spacing.lg }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }}>#{order.orderNo}</Text>
                    <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }}>{rupees(order.pricing?.total)}</Text>
                </View>
                {showShop && order.shopName ? <Text style={{ color: t.primary, fontWeight: '700', fontSize: font.sm, marginTop: 2 }} numberOfLines={1}>{order.shopName}</Text> : null}
                <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }} numberOfLines={1}>
                    {order.customer?.name || 'Customer'} · {maskedPhone(order.customer?.phone)}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
                    <StatusBadge status={order.status} />
                    <Badge label={TYPE_LABEL[order.orderType] || order.orderType} icon={TYPE_ICON[order.orderType]} />
                    <Badge label={payLabel(order.payment)} tone={order.payment?.status === 'paid' ? 'success' : 'neutral'} />
                    <Text style={{ color: t.muted, fontSize: font.xs }}>{ago(order.createdAt)}</Text>
                </View>
            </View>
        </Pressable>
    );
}

const st = StyleSheet.create({
    row: { flexDirection: 'row', borderRadius: radius.lg, overflow: 'hidden', marginBottom: spacing.sm },
    edge: { width: 5 },
});
