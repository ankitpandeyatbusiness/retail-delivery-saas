// Payment options for the owner's own payments (a monthly bill, an SMS top-up): pay with PhonePe / Google Pay / Paytm /
// any UPI app, a credit or debit card, or scan a QR from another phone. Looks and works like the customer's checkout.
// Opened with params { kind: 'rent' | 'sms' | 'dues', id? (the bill), amountPaise, title }. 'dues' pays every unpaid bill and late fee at once.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Image, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { PageHeader, Card, Button } from '../../components/owners/ui';
import { PayQrSheet } from '../../components/owners/moneyBits';
import PayShimmer from '../../components/customers/PayShimmer';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { standardUpiApps, detectInstalledUpiApps } from '../../utils/customers/upiApps';
import { payPlatform } from '../../utils/owners/payPlatform';
import { fetchRentInvoices, payRentInvoice, startTopup, fetchTopups, fetchDues, apiError } from '../../api/owners/shopApi';
import { rupees } from '../../utils/owners/riderRules';
import { showToast } from '../../components/customers/shop';
import { ListShimmer } from '../../components/owners/shimmer';
import { tr } from '../../i18n';

const digits = (v) => String(v || '').replace(/\D/g, '');
function groupNumber(v) {
    const d = digits(v).slice(0, 19);
    if (/^3[47]/.test(d)) return [d.slice(0, 4), d.slice(4, 10), d.slice(10, 15)].filter(Boolean).join(' ');
    return d.replace(/(.{4})/g, '$1 ').trim();
}
function luhn(num) {
    let sum = 0; let alt = false;
    for (let i = num.length - 1; i >= 0; i -= 1) { let n = Number(num[i]); if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; }
    return sum % 10 === 0;
}
const brandOf = (n) => (/^4/.test(n) ? 'Visa' : /^(5[1-5]|2[2-7])/.test(n) ? 'Mastercard' : /^3[47]/.test(n) ? 'American Express' : /^(60|65|81|82|508)/.test(n) ? 'RuPay' : '');

// one selectable row: an app logo (or a letter, or an icon), a title and a note, a radio on the right
function Method({ m, selected, onPress, last }) {
    const { primary, text, muted, border } = useBrand();
    return (
        <Pressable onPress={() => onPress(m)} style={({ pressed }) => [styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border }, pressed && { opacity: 0.7 }]}>
            {m.logo ? (
                <View style={[styles.box, { borderWidth: 1, borderColor: border, backgroundColor: '#FFFFFF' }]}><Image source={{ uri: m.logo }} style={{ width: 30, height: 30 }} resizeMode="contain" /></View>
            ) : m.mark ? (
                <View style={[styles.box, { backgroundColor: primary }]}><Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: 18 }}>{m.mark}</Text></View>
            ) : (
                <View style={[styles.box, { backgroundColor: selected ? primary : alpha(primary, 0.14) }]}><Ionicons name={m.icon} size={22} color={selected ? '#FFFFFF' : primary} /></View>
            )}
            <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={{ color: text, fontWeight: '800', fontSize: 15 }}>{m.label}</Text>
                <Text style={{ color: muted, fontSize: 12, marginTop: 1 }}>{m.desc}</Text>
            </View>
            <View style={[styles.radio, { borderColor: selected ? primary : muted }]}>{selected ? <View style={[styles.dot, { backgroundColor: primary }]} /> : null}</View>
        </Pressable>
    );
}

function CardForm({ value, onChange, errors }) {
    const { text, muted, border, surface, error } = useBrand();
    const exp = useRef(null); const cvv = useRef(null); const nm = useRef(null);
    const raw = digits(value.number);
    const input = (extra) => ({ style: [styles.input, { color: text, borderColor: border, backgroundColor: surface }], placeholderTextColor: muted, ...extra });
    return (
        <View style={{ paddingTop: 6, paddingBottom: 4 }}>
            <Text style={[styles.lab, { color: muted }]}>{tr('Card number {v1}', { v1: brandOf(raw) ? `· ${brandOf(raw)}` : '' })}</Text>
            <TextInput {...input({ value: value.number, onChangeText: (x) => { const g = groupNumber(x); onChange({ ...value, number: g }); if (digits(g).length >= (/^3[47]/.test(digits(g)) ? 15 : 16)) exp.current?.focus(); }, placeholder: '1234 5678 9012 3456', keyboardType: 'number-pad', maxLength: 23 })} />
            {errors.number ? <Text style={[styles.err, { color: error }]}>{errors.number}</Text> : null}
            <View style={{ flexDirection: 'row', marginTop: 12 }}>
                <View style={{ flex: 1, marginRight: 10 }}>
                    <Text style={[styles.lab, { color: muted }]}>{tr('Expiry (MM/YY)')}</Text>
                    <TextInput ref={exp} {...input({ value: value.exp, onChangeText: (x) => { const d = digits(x).slice(0, 4); onChange({ ...value, exp: d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d }); if (d.length === 4) cvv.current?.focus(); }, placeholder: 'MM/YY', keyboardType: 'number-pad', maxLength: 5 })} />
                    {errors.exp ? <Text style={[styles.err, { color: error }]}>{errors.exp}</Text> : null}
                </View>
                <View style={{ flex: 1 }}>
                    <Text style={[styles.lab, { color: muted }]}>{tr('CVV')}</Text>
                    <TextInput ref={cvv} {...input({ value: value.cvv, onChangeText: (x) => onChange({ ...value, cvv: digits(x).slice(0, 4) }), placeholder: '•••', keyboardType: 'number-pad', secureTextEntry: true, maxLength: 4 })} />
                    {errors.cvv ? <Text style={[styles.err, { color: error }]}>{errors.cvv}</Text> : null}
                </View>
            </View>
            <Text style={[styles.lab, { color: muted, marginTop: 12 }]}>{tr('Name on card')}</Text>
            <TextInput ref={nm} {...input({ value: value.name, onChangeText: (x) => onChange({ ...value, name: x }), placeholder: 'Name', maxLength: 40, autoCapitalize: 'words' })} />
            <Text style={{ color: muted, fontSize: 12, marginTop: 10 }}>{tr('Your card is not saved. Your bank may ask for an OTP.')}</Text>
        </View>
    );
}

function cardProblems(c) {
    const e = {};
    const n = digits(c.number);
    if (n.length < 13 || !luhn(n)) e.number = 'Check the card number';
    const [mm, yy] = c.exp.split('/');
    const month = Number(mm); const year = 2000 + Number(yy);
    const now = new Date();
    if (!(month >= 1 && month <= 12) || !yy || yy.length !== 2 || year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) e.exp = 'Check the expiry date';
    if (c.cvv.length < (/^3[47]/.test(n) ? 4 : 3)) e.cvv = 'Check the CVV';
    return e;
}

export default function OwnerPayScreen() {
    const nav = useNavigation();
    const { kind, id, amountPaise, title, payablePaise, gstPaise, gstPercent } = useRoute().params || {};
    const toPay = payablePaise || amountPaise;   // an SMS top-up: the amount plus GST
    const { background, primary, text, muted, ok, border } = useBrand();
    const user = useAuthStore((s) => s.user);
    const [apps, setApps] = useState(null);
    const [picked, setPicked] = useState(null);       // 'upi:<pkg>' | 'upi:any' | 'card' | 'qr'
    const [card, setCard] = useState({ number: '', exp: '', cvv: '', name: user?.name || '' });
    const [errors, setErrors] = useState({});
    const [paying, setPaying] = useState(null);       // the app name while the payment runs
    const [done, setDone] = useState(false);
    const [qr, setQr] = useState(null);
    const [qrBusy, setQrBusy] = useState(false);

    useEffect(() => {
        let on = true;
        detectInstalledUpiApps().catch(() => { });
        standardUpiApps().then((a) => { if (on) setApps(a); });
        return () => { on = false; };
    }, []);

    // has the money arrived? (also asked when an app gives no proof)
    const confirmPaid = async () => {
        if (kind === 'rent') return !!(await fetchRentInvoices({ page: 1, limit: 20 })).items.find((x) => String(x._id) === String(id) && x.status === 'paid');
        if (kind === 'dues') return (await fetchDues()).count === 0;
        return false;
    };

    const finish = () => {
        setDone(true);
        useOwnerStore.getState().refresh();
        setTimeout(() => nav.goBack(), 1700);
    };

    const upiRows = (apps || []).map((a) => ({ key: `upi:${a.pkg}`, app: { pkg: a.pkg, label: a.label }, label: a.label, logo: a.logo, mark: a.mark || a.label.slice(0, 1), desc: `Pay with ${a.label}. It opens directly` }));
    const rows = [
        ...upiRows,
        { key: 'upi:any', app: { chooser: true, label: 'UPI' }, label: 'Other UPI app', icon: 'phone-portrait-outline', desc: 'Choose any UPI app on this phone' },
        { key: 'card', label: 'Credit / Debit card', icon: 'card-outline', desc: 'Visa, Mastercard, RuPay. You confirm with your bank OTP' },
        ...(kind === 'dues' ? [] : [{ key: 'qr', label: 'Scan a QR code', icon: 'qr-code-outline', desc: 'Pay from another phone by scanning a code' }]),   // a QR is made for one bill
    ];
    const current = rows.find((r) => r.key === picked);

    const pay = async () => {
        if (!current || paying) return;
        if (current.key === 'qr') {
            setQrBusy(true);
            try {
                setQr(kind === 'rent' ? { ...(await payRentInvoice(id)), id } : await startTopup({ amountPaise }));
            } catch (e) { showToast(apiError(e)); } finally { setQrBusy(false); }
            return;
        }
        let cardBody;
        if (current.key === 'card') {
            const er = cardProblems(card);
            if (Object.keys(er).length) { setErrors(er); return; }
            setErrors({});
            const [mm, yy] = card.exp.split('/');
            cardBody = { number: card.number, month: mm, year: yy, cvv: card.cvv, name: card.name.trim() };
        }
        setPaying(current.app?.label || 'your card');
        const r = await payPlatform({ kind, id, amountPaise, upiApp: current.app, card: cardBody, user, confirmPaid });
        setPaying(null);
        setCard((c) => ({ ...c, number: '', cvv: '' }));   // the card is never kept
        if (r.status === 'paid') finish();
        else if (r.status === 'pending') { showToast(r.message); nav.goBack(); }
        else showToast(r.message || tr('Payment did not go through'));
    };

    // QR sheet: the same checks as before
    const qrPoll = async () => {
        if (kind === 'rent') return confirmPaid();
        const r = await fetchTopups();
        return !!r.items?.find((t) => String(t.id || t._id) === String(qr.id) && t.status === 'paid');
    };

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Payment options')} />
            {done ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="checkmark-circle" size={92} color={ok} />
                    <Text style={{ color: ok, fontSize: 22, fontWeight: '900', marginTop: 10 }}>{tr('Payment received')}</Text>
                    <Text style={{ color: muted, marginTop: 4 }}>{rupees(toPay)} · {title}</Text>
                </View>
            ) : (
                <>
                    <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 150 }} keyboardShouldPersistTaps="handled">
                        <Card>
                            <Text style={{ color: muted, fontSize: 12, fontWeight: '700' }}>{title}</Text>
                            <Text style={{ color: text, fontSize: 34, fontWeight: '900', marginTop: 2 }}>{rupees(toPay)}</Text>
                            {gstPaise ? <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{tr('{rupees} added to your balance + {gstPercent}% GST {rupees3}', { rupees: rupees(amountPaise), gstPercent: gstPercent, rupees3: rupees(gstPaise) })}</Text> : null}
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
                                <Ionicons name="shield-checkmark" size={15} color={ok} />
                                <Text style={{ color: muted, fontSize: 12, marginLeft: 6 }}>{tr('Secure payment by Razorpay')}</Text>
                            </View>
                        </Card>
                        <Card style={{ paddingVertical: 4 }}>
                            {apps === null ? <ListShimmer count={3} rows /> : rows.map((m, i) => (
                                <View key={m.key}>
                                    <Method m={m} selected={picked === m.key} onPress={(x) => { setPicked(x.key); setErrors({}); }} last={i === rows.length - 1 && picked !== 'card'} />
                                    {m.key === 'card' && picked === 'card' ? <CardForm value={card} onChange={setCard} errors={errors} /> : null}
                                </View>
                            ))}
                        </Card>
                    </ScrollView>
                    <View style={[styles.dock, { backgroundColor: background, borderTopColor: border }]}>
                        <Button label={!current ? tr('Choose how to pay') : current.key === 'qr' ? tr('Show QR code') : tr('Pay {rupees}', { rupees: rupees(toPay) })} icon={current?.key === 'qr' ? 'qr-code' : 'lock-closed'} disabled={!current} busy={qrBusy} onPress={pay} />
                    </View>
                    {paying ? <PayShimmer appName={paying} /> : null}
                </>
            )}
            <PayQrSheet visible={!!qr} title={title} qr={qr} poll={qrPoll} onPaid={finish} onClose={() => setQr(null)} />
        </View>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13 },
    box: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
    radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginLeft: 10 },
    dot: { width: 10, height: 10, borderRadius: 5 },
    dock: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, paddingBottom: 24, borderTopWidth: StyleSheet.hairlineWidth },
    lab: { fontSize: 12, fontWeight: '700', marginBottom: 6 },
    input: { minHeight: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, fontSize: 15, fontWeight: '600' },
    err: { fontSize: 12, marginTop: 4 },
});
