// Monthly bill: what is due, how this month is going, every bill (pay a pending one by UPI, open its PDF).
// Stays open even while the shop is paused for unpaid rent: it is the way out.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useBrand, alpha } from '../../components/common/kit';
import { PageHeader, Card, Pill, Button, SectionTitle, Empty, Stat, money } from '../../components/owners/ui';
import { fetchBillingStatus, fetchRentInvoices, fetchDues, rentInvoicePdfPath, creditNotePdfPath, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { downloadAndOpen } from '../../utils/owners/files';
import { dayTime } from '../../utils/owners/orderFlow';
import { showToast } from '../../components/customers/shop';
import { StatShimmer } from '../../components/owners/shimmer';
import { tr } from '../../i18n';

const monthName = (p) => {
    const [y, m] = String(p).split('-');
    return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(m) - 1] || ''} ${y}`;
};
const dayOf = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export default function OwnerRentScreen() {
    const nav = useNavigation();
    const { background, text, muted, error, ok, primary } = useBrand();
    const [bill, setBill] = useState(null);
    const [dues, setDues] = useState(null);
    const [invoices, setInvoices] = useState(null);
    const [more, setMore] = useState(false);
    const [page, setPage] = useState(1);
    const [busyId, setBusyId] = useState(null);
    const [err, setErr] = useState('');

    const load = useCallback(async (p = 1) => {
        try {
            const [b, i, du] = await Promise.all([p === 1 ? fetchBillingStatus() : Promise.resolve(null), fetchRentInvoices({ page: p, limit: 20 }), p === 1 ? fetchDues().catch(() => null) : Promise.resolve(null)]);
            if (b) setBill(b);
            if (p === 1) setDues(du);
            setInvoices((old) => (p === 1 ? i.items : [...(old || []), ...i.items]));
            setMore(!!i.hasMore); setPage(p); setErr('');
        } catch (e) { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not load your bills.')); setInvoices((x) => x || []); }
    }, []);
    useFocusEffect(useCallback(() => { load(1); }, [load]));

    // the payment options page: any UPI app, a card, or a QR code
    const pay = (inv) => nav.navigate('OwnerPay', { kind: 'rent', id: String(inv._id), amountPaise: Math.round(Number(inv.total) * 100), title: `Bill ${inv.invoiceNo}` });
    const pdf = async (inv) => {
        setBusyId(`pdf${inv._id}`);
        try { await downloadAndOpen({ path: rentInvoicePdfPath(inv._id), filename: `bill-${String(inv.invoiceNo).replace(/\W+/g, '-')}.pdf`, mime: 'application/pdf', title: inv.invoiceNo }); }
        catch (e) { showToast(e.safe ? e.message : tr('Could not open the bill')); } finally { setBusyId(null); }
    };

    const noteOf = async (inv) => {
        setBusyId(`cn${inv._id}`);
        try { await downloadAndOpen({ path: creditNotePdfPath(inv.creditNoteId), filename: `credit-note-${String(inv.invoiceNo).replace(/\W+/g, '-')}.pdf`, mime: 'application/pdf', title: 'Credit note' }); }
        catch (e) { showToast(e.safe ? e.message : tr('Could not open the credit note')); } finally { setBusyId(null); }
    };

    const payAll = () => nav.navigate('OwnerPay', { kind: 'dues', amountPaise: Math.round(Number(dues.grandTotal) * 100), title: `All dues (${dues.count} bills)` });
    const due = bill?.due?.amount || 0;
    // several unpaid bills, or any late fee: show the whole picture and one button to pay it all
    const showDues = !!dues && dues.count > 0 && (dues.count > 1 || dues.lateFeeTotal > 0 || (dues.looseLateFees || []).length > 0);

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Monthly bill')} />
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 32 }}>
                {bill ? (
                    <>
                        <Card tone={due > 0 ? error : undefined}>
                            <Text style={{ color: muted, fontSize: 12, fontWeight: '700' }}>{due > 0 ? tr('To pay') : tr('Nothing to pay')}</Text>
                            <Text style={{ color: due > 0 ? error : ok, fontSize: 34, fontWeight: '900', marginTop: 2 }}>{money(due)}</Text>
                            {due > 0 ? (
                                <Text style={{ color: muted, marginTop: 4 }}>
                                    {bill.paused ? tr('Your menu and settings are locked until this is paid. Orders, riders and money still work.') : bill.graceDaysLeft != null ? tr('{graceDaysLeft} {v2} left before the shop panel is locked.', { graceDaysLeft: bill.graceDaysLeft, v2: bill.graceDaysLeft === 1 ? 'day' : 'days' }) : ''}
                                </Text>
                            ) : <Text style={{ color: muted, marginTop: 4 }}>{tr('You are up to date.')}</Text>}
                        </Card>

                        {showDues ? (
                            <>
                                <SectionTitle title={tr('What you owe')} />
                                <Card tone={error}>
                                    {dues.rows.map((r) => (
                                        <View key={r.id} style={{ marginBottom: 12 }}>
                                            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                                                <Text style={{ color: text, fontWeight: '900', flex: 1 }}>{r.label}</Text>
                                                <Text style={{ color: text, fontWeight: '900' }}>{money(r.total)}</Text>
                                            </View>
                                            <Text style={{ color: muted, fontSize: 12 }}>{tr('{invoiceNo} · due {dayOf}{v3}', { invoiceNo: r.invoiceNo, dayOf: dayOf(r.dueDate), v3: r.daysOverdue > 0 ? ` · ${r.daysOverdue} days late` : '' })}</Text>
                                            {r.lateFees.map((f) => (
                                                <View key={f.id} style={{ marginTop: 6, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: error }}>
                                                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                                                        <Text style={{ color: error, fontWeight: '800', flex: 1 }}>{tr('Late fee, overdue month {month}', { month: f.month })}</Text>
                                                        <Text style={{ color: error, fontWeight: '800' }}>{money(f.total)}</Text>
                                                    </View>
                                                    <Text style={{ color: muted, fontSize: 12 }}>{tr('{percent}% of {money} = {money3}{v4} · {dayOf} to {dayOf6}', { percent: f.percent, money: money(f.onAmount), money3: money(f.base), v4: f.gst ? ` + GST ${money(f.gst)}` : '', dayOf: dayOf(f.from), dayOf6: dayOf(f.to) })}</Text>
                                                </View>
                                            ))}
                                        </View>
                                    ))}
                                    {(dues.looseLateFees || []).map((f) => (
                                        <View key={f.id} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                                            <Text style={{ color: error, fontWeight: '800', flex: 1 }}>{f.description}</Text>
                                            <Text style={{ color: error, fontWeight: '800' }}>{money(f.total)}</Text>
                                        </View>
                                    ))}
                                    <View style={{ height: 1, backgroundColor: alpha(muted, 0.3), marginVertical: 6 }} />
                                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: muted }}>{tr('Rent and bills')}</Text><Text style={{ color: text, fontWeight: '800' }}>{money(dues.rentTotal)}</Text></View>
                                    {dues.lateFeeTotal > 0 ? <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}><Text style={{ color: muted }}>{tr('Late fees (with GST)')}</Text><Text style={{ color: error, fontWeight: '800' }}>{money(dues.lateFeeTotal)}</Text></View> : null}
                                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}><Text style={{ color: text, fontWeight: '900', fontSize: 16 }}>{tr('Total to pay')}</Text><Text style={{ color: error, fontWeight: '900', fontSize: 20 }}>{money(dues.grandTotal)}</Text></View>
                                    <Text style={{ color: muted, fontSize: 12, marginTop: 8 }}>{tr('{text} Paying now stops it from growing.', { text: dues.rule.text })}</Text>
                                    <View style={{ marginTop: 12 }}><Button label={tr('Pay all {money}', { money: money(dues.grandTotal) })} icon="card" onPress={payAll} /></View>
                                </Card>
                            </>
                        ) : null}

                        <Card>
                            {bill.free?.active ? (
                                <Text style={{ color: ok, fontWeight: '800', marginBottom: 8 }}>{tr('Free period{v1}{v2}', { v1: bill.free.ordersLeft != null ? ` · ${bill.free.ordersLeft} free orders left` : '', v2: bill.free.endsAt ? ` · until ${dayOf(bill.free.endsAt)}` : '' })}</Text>
                            ) : null}
                            <View style={{ flexDirection: 'row' }}>
                                <Stat label={tr('Orders in {monthName}', { monthName: monthName(bill.thisMonth.period) })} value={String(bill.thisMonth.billableOrders)} />
                                <Stat label={tr('Rate')} value={bill.thisMonth.tierLabel || '—'} hint={bill.thisMonth.fee != null ? tr('{money} so far', { money: money(bill.thisMonth.fee) }) : undefined} />
                            </View>
                            {bill.nextBill ? <Text style={{ color: muted, fontSize: 12, marginTop: 10 }}>{tr('Next bill on {dayOf}. {note}', { dayOf: dayOf(bill.nextBill.billedOn), note: bill.nextBill.note })}</Text> : null}
                        </Card>
                    </>
                ) : !err ? <StatShimmer /> : null}

                {bill?.plan ? (
                    <>
                        <SectionTitle title={tr('Your monthly fee plan')} />
                        <Card>
                            {bill.plan.kind === 'fixed' ? (
                                <Text style={{ color: text, fontWeight: '800' }}>{tr('A fixed fee of {money} every month, however many orders you get.', { money: money(bill.plan.fee) })}</Text>
                            ) : (
                                <>
                                    <Text style={{ color: muted, fontSize: 12, marginBottom: 6 }}>{tr('The monthly fee depends on how many orders you deliver in the month.')}</Text>
                                    {bill.plan.tiers.map((t, i) => {
                                        const n = bill.thisMonth.billableOrders;
                                        const here = n >= t.from && (t.to === null || n <= t.to);
                                        return (
                                            <View key={t.label} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 10, marginVertical: 2, borderRadius: 12, backgroundColor: here ? alpha(primary, 0.12) : 'transparent' }}>
                                                <View style={{ flex: 1 }}>
                                                    <Text style={{ color: text, fontWeight: '800' }}>{t.label}</Text>
                                                    {here ? <Text style={{ color: primary, fontSize: 12, fontWeight: '700', marginTop: 1 }}>{tr('You are here · {n} so far this month', { n: n })}</Text> : null}
                                                </View>
                                                <Text style={{ color: text, fontWeight: '900' }}>{money(t.fee)}</Text>
                                            </View>
                                        );
                                    })}
                                </>
                            )}
                            <Text style={{ color: muted, fontSize: 12, marginTop: 8 }}>{tr('GST is added if it applies. If the plan changes you get a message, and bills already issued do not change.')}</Text>
                        </Card>
                    </>
                ) : null}

                <SectionTitle title={tr('All bills')} />
                {err && !invoices?.length ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={err} /> : null}
                {invoices && !invoices.length && !err ? <Empty icon="receipt-outline" title={tr('No bills yet')} hint={tr('Your first bill appears after the free period.')} /> : null}
                {(invoices || []).map((inv) => (
                    <Card key={inv._id}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <View style={{ flex: 1, minWidth: 0 }}>
                                <Text style={{ color: text, fontWeight: '900', fontSize: 15 }}>{inv.period ? monthName(inv.period) : (inv.description || tr('Bill'))}</Text>
                                <Text style={{ color: muted, fontSize: 12, marginTop: 1 }}>{inv.invoiceNo}{inv.status === 'pending' ? tr(' · due {dayOf}', { dayOf: dayOf(inv.dueDate) }) : inv.paidAt ? tr(' · paid {dayOf}', { dayOf: dayOf(inv.paidAt) }) : ''}</Text>
                            </View>
                            <View style={{ alignItems: 'flex-end' }}>
                                <Text style={{ color: text, fontWeight: '900', fontSize: 16 }}>{money(inv.total)}</Text>
                                <View style={{ marginTop: 4 }}>
                                    {inv.status === 'paid' ? <Pill label={tr('Paid')} color={ok} /> : inv.status === 'void' ? <Pill label={tr('Cancelled')} color={muted} /> : <Pill label={inv.overdue ? tr('Overdue') : tr('To pay')} color={error} />}
                                </View>
                            </View>
                        </View>
                        <View style={{ flexDirection: 'row', marginTop: 12 }}>
                            {inv.status === 'pending' ? <View style={{ flex: 1, marginRight: 6 }}><Button label={tr('Pay now')} icon="card" onPress={() => pay(inv)} /></View> : null}
                            <View style={{ flex: 1, marginLeft: inv.status === 'pending' ? 6 : 0 }}><Button label={tr('Open bill (PDF)')} icon="document-text" kind="ghost" busy={busyId === `pdf${inv._id}`} onPress={() => pdf(inv)} /></View>
                        </View>
                        {inv.status === 'void' && inv.creditNoteId ? <View style={{ marginTop: 8 }}><Button label={tr('Credit note (PDF)')} icon="document-text" kind="ghost" busy={busyId === `cn${inv._id}`} onPress={() => noteOf(inv)} /></View> : null}
                    </Card>
                ))}
                {more ? <View style={{ paddingHorizontal: 16 }}><Button label={tr('Show more')} kind="ghost" onPress={() => load(page + 1)} /></View> : null}
            </ScrollView>
        </View>
    );
}
