// The customer app's FIXED screens (the shop cannot restyle them, only switch them on or off), drawn in the live phone preview exactly as the
// customer app draws them: same order of parts, same sizes (scaled to the preview phone), same words. Only the shop's colours, font and logo apply.
// Each page here mirrors a real screen in mobile/src/screens/customers/. When a real screen changes, change its twin here.
import React from 'react';
import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { USER } from './previewData';

// the preview phone is 320 wide, a real phone about 390: every size of the real screen is multiplied by this
const Z = 320 / 390;
const z = (n) => Math.round(n * Z * 10) / 10;
const HAIR = StyleSheet.hairlineWidth;

// a QR-like square (the real one comes from the server)
function FakeQr({ size, color }) {
    const n = 17;
    const cell = size / n;
    // the three big corner squares, then a scatter for the rest
    const finder = (lr, lc) => lr === 0 || lr === 6 || lc === 0 || lc === 6 || (lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4);
    const on = (r, c) => {
        if (r < 7 && c < 7) return finder(r, c);
        if (r < 7 && c >= n - 7) return finder(r, c - (n - 7));
        if (r >= n - 7 && c < 7) return finder(r - (n - 7), c);
        return ((r * 7 + c * 13 + r * c) % 5) < 2;
    };
    return (
        <View style={{ width: size, height: size, backgroundColor: '#FFFFFF', padding: 4 }}>
            {Array.from({ length: n }, (_, r) => (
                <View key={r} style={{ flexDirection: 'row', height: cell }}>
                    {Array.from({ length: n }, (_, c) => <View key={c} style={{ width: cell, height: cell, backgroundColor: on(r, c) ? color : 'transparent' }} />)}
                </View>
            ))}
        </View>
    );
}

export function makeFixed({ useP, Tx, Gate, alpha }) {
    /* ------------------------------ the owners' kit, as the customer screens use it ------------------------------ */
    // FormPage: the back arrow and title, the form scrolling, the main button pinned to the bottom with a thin line above it
    function FormPage({ title, children, footer, feature, label }) {
        const { T, nav } = useP();
        return (
            <View style={{ flex: 1, backgroundColor: T.background }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: z(16), paddingTop: z(8), paddingBottom: z(10) }}>
                    <Pressable onPress={nav.pop} hitSlop={10} style={{ paddingRight: z(14) }}><Ionicons name="arrow-back" size={z(24)} color={T.text} /></Pressable>
                    <Tx numberOfLines={1} style={{ flex: 1, color: T.text, fontSize: z(18), fontWeight: '900' }}>{title}</Tx>
                </View>
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: z(6), paddingBottom: z(40) }}>
                    {feature ? <Gate feature={feature} label={label}>{children}</Gate> : children}
                </ScrollView>
                {footer ? <View style={{ paddingHorizontal: z(16), paddingTop: z(10), paddingBottom: z(10), borderTopWidth: HAIR, borderTopColor: T.border, backgroundColor: T.background }}>{footer}</View> : null}
            </View>
        );
    }
    const Card = ({ children, style }) => {
        const { T } = useP();
        return <View style={[{ borderRadius: z(18), borderWidth: HAIR, borderColor: T.border, backgroundColor: T.surface, padding: z(14), marginHorizontal: z(16), marginBottom: z(12) }, style]}>{children}</View>;
    };
    const Group = ({ title, children }) => {
        const { T } = useP();
        return (
            <View style={{ marginBottom: z(4) }}>
                <Tx style={{ color: T.text, fontSize: z(16), fontWeight: '900', paddingHorizontal: z(16), marginTop: z(6), marginBottom: z(10) }}>{title}</Tx>
                <Card>{children}</Card>
            </View>
        );
    };
    const Label = ({ children, hint }) => {
        const { T } = useP();
        return (
            <View style={{ marginBottom: z(6) }}>
                <Tx style={{ color: T.text, fontWeight: '800', fontSize: z(13) }}>{children}</Tx>
                {hint ? <Tx style={{ color: T.muted, fontSize: z(12), marginTop: 1 }}>{hint}</Tx> : null}
            </View>
        );
    };
    const TextBox = ({ label, value, placeholder, last }) => {
        const { T } = useP();
        return (
            <View style={{ marginBottom: last ? 0 : z(16) }}>
                <Label>{label}</Label>
                <View style={{ borderWidth: 1, borderColor: T.border, borderRadius: z(12), paddingHorizontal: z(14), paddingVertical: z(11), minHeight: z(46), justifyContent: 'center', backgroundColor: T.surface }}>
                    <Tx style={{ color: value ? T.text : T.muted, fontSize: z(15) }}>{value || placeholder}</Tx>
                </View>
            </View>
        );
    };
    const Button = ({ label, icon, kind = 'primary', style }) => {
        const { T } = useP();
        const fill = kind === 'primary' ? T.primary : 'transparent';
        const ink = kind === 'primary' ? T.onPrimary : T.text;
        return (
            <View style={[{ minHeight: z(48), flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: T.radius, backgroundColor: fill, borderColor: kind === 'ghost' ? T.border : fill }, style]}>
                {icon ? <Ionicons name={icon} size={z(18)} color={ink} style={{ marginRight: z(8) }} /> : null}
                <Tx style={{ color: ink, fontWeight: '800', fontSize: z(15), paddingVertical: z(14) }}>{label}</Tx>
            </View>
        );
    };
    const Pill = ({ label, color }) => (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: z(10), paddingVertical: z(4), borderRadius: 99, alignSelf: 'flex-start', backgroundColor: alpha(color, 0.14) }}>
            <Tx style={{ color, fontWeight: '800', fontSize: z(12) }}>{label}</Tx>
        </View>
    );

    /* ------------------------------ Reserve a table (BookTableScreen) ------------------------------ */
    function BookTablePage() {
        const { T } = useP();
        const days = [['Today', '04'], ['Thu', '05'], ['Fri', '06'], ['Sat', '07'], ['Sun', '08'], ['Mon', '09']];
        const slots = [['19:00', '6 free'], ['19:30', '4 free'], ['20:00', '3 free', true], ['20:30', 'Full', false, true], ['21:00', '5 free'], ['21:30', '7 free']];
        // [no, seats, state]  state: free | taken | small
        const tables = [[1, 2, 'small'], [2, 2, 'small'], [3, 4, 'free'], [4, 4, 'taken'], [5, 4, 'free'], [6, 6, 'free'], [7, 6, 'free'], [8, 8, 'taken']];
        const chosen = 5;
        const legend = (color, label, fill) => (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: z(14) }}>
                <View style={{ width: z(14), height: z(14), borderRadius: z(4), borderWidth: 1.5, borderColor: color, backgroundColor: fill || 'transparent', marginRight: z(6) }} />
                <Tx style={{ color: T.muted, fontSize: z(12) }}>{label}</Tx>
            </View>
        );
        return (
            <FormPage title="Reserve a table" feature="tableBooking" label="Table booking" footer={<Button label={`Pay ₹200 deposit · Table ${chosen}`} icon="calendar" />}>
                <View style={{ paddingHorizontal: z(16) }}>
                    <Label>Day</Label>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: z(14) }}>
                        {days.map(([a, b], i) => {
                            const on = i === 1;
                            return (
                                <View key={b} style={{ width: z(58), paddingVertical: z(10), marginRight: z(8), borderRadius: z(14), alignItems: 'center', borderWidth: 1, borderColor: on ? T.primary : T.border, backgroundColor: on ? T.primary : T.surface }}>
                                    <Tx style={{ color: on ? T.onPrimary : T.muted, fontSize: z(12) }}>{a}</Tx>
                                    <Tx style={{ color: on ? T.onPrimary : T.text, fontWeight: '900', fontSize: z(18) }}>{b}</Tx>
                                </View>
                            );
                        })}
                    </ScrollView>
                    <Label>Guests</Label>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: z(14) }}>
                        {['remove', 'add'].map((ic, k) => (
                            <React.Fragment key={ic}>
                                <View style={{ width: z(44), height: z(44), borderRadius: z(22), borderWidth: 1, borderColor: T.border, alignItems: 'center', justifyContent: 'center', backgroundColor: T.surface }}>
                                    <Ionicons name={ic} size={z(22)} color={T.text} />
                                </View>
                                {k === 0 ? <Tx style={{ color: T.text, fontWeight: '900', fontSize: z(22), minWidth: z(64), textAlign: 'center' }}>4</Tx> : null}
                            </React.Fragment>
                        ))}
                    </View>
                    <Label>Time</Label>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: z(6) }}>
                        {slots.map(([time, sub, on, full]) => (
                            <View key={time} style={{ minWidth: z(84), marginRight: z(8), marginBottom: z(8), paddingVertical: z(11), paddingHorizontal: z(12), borderRadius: z(12), alignItems: 'center', borderWidth: 1, borderColor: on ? T.primary : T.border, backgroundColor: on ? T.primary : T.surface }}>
                                <Tx style={{ color: on ? T.onPrimary : T.text, fontWeight: '900', fontSize: z(15) }}>{time}</Tx>
                                <Tx style={{ color: on ? T.onPrimary : full ? T.errorText : T.muted, fontSize: z(10) }}>{sub}</Tx>
                            </View>
                        ))}
                    </View>
                    <View style={{ marginTop: z(6) }}>
                        <Label hint="Tap a free table">Choose your table</Label>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: z(4) }}>
                            {tables.map(([no, seats, state]) => {
                                const on = no === chosen;
                                const free = state === 'free';
                                return (
                                    <View key={no} style={{ width: z(74), height: z(74), marginRight: z(10), marginBottom: z(10), borderRadius: z(14), alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: on ? T.primary : free ? T.primary : T.border, backgroundColor: on ? T.primary : free ? T.surface : alpha(T.border, 0.35), opacity: free ? 1 : 0.55 }}>
                                        <Tx style={{ color: on ? T.onPrimary : T.text, fontWeight: '900', fontSize: z(20) }}>{no}</Tx>
                                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                            <Ionicons name="people" size={z(12)} color={on ? T.onPrimary : T.muted} />
                                            <Tx style={{ color: on ? T.onPrimary : T.muted, fontSize: z(12), marginLeft: 3 }}>{seats}</Tx>
                                        </View>
                                        {state === 'taken' ? <Tx style={{ position: 'absolute', top: 4, fontSize: z(9), color: T.muted }}>Taken</Tx> : null}
                                        {state === 'small' ? <Tx style={{ position: 'absolute', top: 4, fontSize: z(9), color: T.muted }}>Too small</Tx> : null}
                                    </View>
                                );
                            })}
                        </View>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: z(8) }}>
                            {legend(T.primary, 'Free')}{legend(T.primary, 'Your choice', T.primary)}{legend(T.border, 'Taken', alpha(T.border, 0.35))}
                        </View>
                    </View>
                    <View style={{ backgroundColor: T.surface, borderRadius: z(14), borderWidth: 1, borderColor: T.border, padding: z(14), marginVertical: z(10) }}>
                        <Tx style={{ color: T.primary, fontWeight: '900', fontSize: z(18) }}>Deposit ₹200</Tx>
                        <Tx style={{ color: T.muted, fontSize: z(13), marginTop: 4 }}>₹50 per person. It is taken off your bill.</Tx>
                        <Tx style={{ color: T.muted, fontSize: z(13), marginTop: 2 }}>Full refund if you cancel at least 2 hours before.</Tx>
                    </View>
                </View>
                <Group title="Your details">
                    <TextBox label="Your name" value="Ananya" />
                    <TextBox label="Phone number" value="98765 43210" />
                    <TextBox label="Note (optional)" placeholder="Birthday, high chair..." last />
                </Group>
            </FormPage>
        );
    }

    /* ------------------------------ My reservations (MyBookingsScreen) ------------------------------ */
    function MyBookingsPage() {
        const { T } = useP();
        const tabs = ['Upcoming', 'Confirmed', 'Cancelled', 'Past'];
        return (
            <FormPage title="My reservations" feature="tableBooking" label="Table booking">
                <View style={{ height: z(38), marginTop: z(4), marginBottom: z(6) }}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: z(16), alignItems: 'center' }}>
                        {tabs.map((l, i) => (
                            <View key={l} style={{ marginRight: z(8), paddingHorizontal: z(16), height: z(38), justifyContent: 'center', borderRadius: z(19), borderWidth: 1, borderColor: i === 0 ? T.primary : T.border, backgroundColor: i === 0 ? T.primary : T.surface }}>
                                <Tx style={{ color: i === 0 ? T.onPrimary : T.text, fontWeight: '800', fontSize: z(13) }}>{l}</Tx>
                            </View>
                        ))}
                    </ScrollView>
                </View>
                <View style={{ paddingTop: z(6) }}>
                    <Card>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <View style={{ flex: 1 }}>
                                <Tx style={{ color: T.text, fontWeight: '900', fontSize: z(17) }}>Thu 5 Nov · 20:00 · Table 5</Tx>
                                <Tx style={{ color: T.muted, marginTop: 2, fontSize: z(14) }}>4 guests · ₹200 Deposit paid</Tx>
                            </View>
                            <Pill label="Booked" color={T.primary} />
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: T.primary, backgroundColor: T.surface, borderRadius: z(14), paddingHorizontal: z(14), minHeight: z(48), marginTop: z(10) }}>
                            <Ionicons name="chatbubbles-outline" size={z(22)} color={T.primary} />
                            <Tx style={{ flex: 1, marginLeft: z(10), color: T.text, fontWeight: '800', fontSize: z(15) }}>Chat with the restaurant</Tx>
                        </View>
                        <Tx style={{ color: T.ok, fontWeight: '800', marginTop: z(8), fontSize: z(14) }}>The restaurant confirmed your table</Tx>
                        <Button label="Hide ticket" icon="chevron-up" kind="ghost" style={{ marginTop: z(10) }} />
                        <View style={{ marginTop: z(12), borderRadius: z(18), borderWidth: 1, borderColor: T.border, backgroundColor: T.surface, padding: z(16), alignItems: 'center' }}>
                            <Tx style={{ color: T.muted, fontWeight: '800', fontSize: z(12), letterSpacing: 1 }}>YOUR TABLE</Tx>
                            <View style={{ flexDirection: 'row', marginTop: z(10), marginBottom: z(14) }}>
                                <View style={{ alignItems: 'center', paddingHorizontal: z(14) }}>
                                    <Tx style={{ color: T.muted, fontSize: z(11) }}>TABLE</Tx>
                                    <Tx style={{ color: T.text, fontWeight: '900', fontSize: z(28) }}>5</Tx>
                                </View>
                                <View style={{ alignItems: 'center', paddingHorizontal: z(14), borderLeftWidth: 1, borderLeftColor: T.border }}>
                                    <Tx style={{ color: T.muted, fontSize: z(11) }}>DATE</Tx>
                                    <Tx style={{ color: T.text, fontWeight: '900', fontSize: z(18), marginTop: z(6) }}>Thu 5 Nov</Tx>
                                </View>
                                <View style={{ alignItems: 'center', paddingHorizontal: z(14), borderLeftWidth: 1, borderLeftColor: T.border }}>
                                    <Tx style={{ color: T.muted, fontSize: z(11) }}>TIME</Tx>
                                    <Tx style={{ color: T.text, fontWeight: '900', fontSize: z(18), marginTop: z(6) }}>20:00</Tx>
                                </View>
                            </View>
                            <FakeQr size={z(200)} color="#111111" />
                            <Tx style={{ color: T.text, fontWeight: '900', fontSize: z(16), marginTop: z(12), letterSpacing: 2 }}>BK7F3K</Tx>
                            <Tx style={{ color: T.muted, fontSize: z(12), marginTop: 4, textAlign: 'center' }}>4 guests · Show this QR at the door</Tx>
                        </View>
                        <Button label="Download receipt" icon="document-text-outline" kind="ghost" style={{ marginTop: z(10) }} />
                        <Button label="Cancel booking" kind="ghost" style={{ marginTop: z(10) }} />
                    </Card>
                    <Card>
                        <Tx style={{ color: T.text, fontWeight: '900', fontSize: z(16) }}>Waiting for a table</Tx>
                        <Tx style={{ color: T.muted, marginTop: 2, fontSize: z(14) }}>Sat 7 Nov · 20:30 · 2 guests</Tx>
                        <Tx style={{ color: T.muted, fontSize: z(12), marginTop: z(6) }}>We will tell you if a table comes free.</Tx>
                        <Button label="Leave the waitlist" kind="ghost" style={{ marginTop: z(10) }} />
                    </Card>
                    <View style={{ paddingHorizontal: z(16), marginTop: z(4) }}><Button label="Reserve a table" icon="add" /></View>
                </View>
            </FormPage>
        );
    }


    /* ------------------------------ the same small parts the real screens share ------------------------------ */
    const SectionTitle = ({ title }) => {
        const { T } = useP();
        return <Tx style={{ color: T.text, fontSize: z(16), fontWeight: '900', paddingHorizontal: z(16), marginTop: z(6), marginBottom: z(10) }}>{title}</Tx>;
    };
    // the chip of the cart and table cards (a tinted fill when on)
    const Chip = ({ label, on }) => {
        const { T } = useP();
        return (
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: z(14), paddingVertical: z(8), borderWidth: 1, borderRadius: z(20), marginRight: z(8), marginBottom: z(8), backgroundColor: on ? alpha(T.primary, 0.14) : T.surface, borderColor: on ? T.primary : T.border }}>
                <Tx numberOfLines={1} style={{ fontSize: z(13), fontWeight: '700', color: on ? T.primary : T.text }}>{label}</Tx>
            </View>
        );
    };
    // the choice buttons of a form (ChoiceBox / Chips)
    const Choices = ({ options, value }) => {
        const { T } = useP();
        return (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: z(2), marginRight: z(-8) }}>
                {options.map((o) => {
                    const on = o === value;
                    return (
                        <View key={o} style={{ flexGrow: 1, minWidth: z(76), marginRight: z(8), marginBottom: z(8), paddingHorizontal: z(14), paddingVertical: z(11), borderRadius: z(12), alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: on ? T.primary : T.border, backgroundColor: on ? T.primary : 'transparent' }}>
                            <Tx numberOfLines={1} style={{ color: on ? T.onPrimary : T.text, fontWeight: '800', fontSize: z(14) }}>{o}</Tx>
                        </View>
                    );
                })}
            </View>
        );
    };
    // a full-width pager bar of the page: used by the pages that pin buttons at the bottom themselves
    const Header = ({ title, over }) => {
        const { T, nav } = useP();
        return (
            <View style={[{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: z(16), paddingTop: z(8), paddingBottom: z(10) }, over ? { position: 'absolute', top: 0, left: 0, right: 0 } : { backgroundColor: T.background }]}>
                <Pressable onPress={nav.pop} hitSlop={10} style={{ paddingRight: z(14) }}><Ionicons name="arrow-back" size={z(24)} color={over ? '#FFFFFF' : T.text} /></Pressable>
                <Tx numberOfLines={1} style={{ flex: 1, color: over ? '#FFFFFF' : T.text, fontSize: z(18), fontWeight: '900' }}>{title}</Tx>
            </View>
        );
    };
    const Empty = ({ icon, title, hint }) => {
        const { T } = useP();
        return (
            <View style={{ alignItems: 'center', justifyContent: 'center', padding: z(32) }}>
                <Ionicons name={icon} size={z(44)} color={T.muted} />
                <Tx style={{ color: T.text, fontWeight: '800', fontSize: z(16), marginTop: z(10) }}>{title}</Tx>
                {hint ? <Tx style={{ color: T.muted, textAlign: 'center', marginTop: 4, maxWidth: z(280) }}>{hint}</Tx> : null}
            </View>
        );
    };
    const PageBody = ({ title, feature, label, children, fixedBottom }) => {
        const { T } = useP();
        return (
            <View style={{ flex: 1, backgroundColor: T.background }}>
                <Header title={title} />
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: z(6), paddingBottom: fixedBottom || z(32) }}>
                    {feature ? <Gate feature={feature} label={label}>{children}</Gate> : children}
                </ScrollView>
            </View>
        );
    };

    /* ------------------------------ Scan table QR (ScanTableScreen) ------------------------------ */
    function ScanTablePage() {
        const { C } = useP();
        const on = C.orders?.dineIn?.enabled === true;
        return (
            <View style={{ flex: 1, backgroundColor: '#000' }}>
                <LinearGradient colors={['#1d1d22', '#08080a']} style={StyleSheet.absoluteFill} />
                <Header title="Scan table QR" over />
                <View style={{ position: 'absolute', left: 0, right: 0, top: '32%', alignItems: 'center' }} pointerEvents="none">
                    <View style={{ width: z(230), height: z(230), borderRadius: z(24), borderWidth: 3, borderColor: '#fff' }} />
                    <Tx style={{ color: '#fff', fontWeight: '800', marginTop: z(16) }}>Point at the QR on your table</Tx>
                </View>
                {on ? null : <Gate feature="dineIn" label="Dine-in"><View /></Gate>}
            </View>
        );
    }

    /* ------------------------------ Table bill (TableBillScreen) ------------------------------ */
    function TableBillPage() {
        const { T } = useP();
        const warn = '#D98200';
        const row = (l, v, o) => (
            <View style={{ flexDirection: 'row', marginTop: o.mt }}>
                <Tx style={{ flex: 1, color: o.strong ? T.text : T.muted, fontWeight: o.strong ? '900' : '700', fontSize: o.size }}>{l}</Tx>
                <Tx style={{ color: o.color || T.text, fontWeight: '900', fontSize: o.vsize }}>{v}</Tx>
            </View>
        );
        const item = (name, qty, add, total) => (
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: z(6) }}>
                <View style={{ width: z(52), height: z(52), borderRadius: z(12), marginRight: z(12), backgroundColor: alpha(T.muted, 0.12), alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="restaurant-outline" size={z(22)} color={T.muted} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                    <Tx style={{ color: T.text, fontWeight: '700', fontSize: z(14) }} numberOfLines={2}>{name}</Tx>
                    <Tx style={{ color: T.muted, fontWeight: '600', fontSize: z(12.5), marginTop: 1 }} numberOfLines={1}>{qty}×{add ? '  ·  ' + add : ''}</Tx>
                </View>
                <Tx style={{ color: T.muted, fontWeight: '700', marginLeft: z(8), fontSize: z(14) }}>{total}</Tx>
            </View>
        );
        const dot = (ic) => (
            <View style={{ width: z(36), height: z(36), borderRadius: z(18), alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={ic} size={z(20)} color={T.text} />
            </View>
        );
        return (
            <View style={{ flex: 1, backgroundColor: T.background }}>
                <Header title="Table 5 bill" />
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: z(200) }}>
                    <Gate feature="dineIn" label="Dine-in">
                        <Card>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Ionicons name="hourglass" size={z(22)} color={warn} />
                                <View style={{ flex: 1, marginLeft: z(10) }}>
                                    <Tx style={{ color: T.text, fontWeight: '900', fontSize: z(14) }}>Taking too long?</Tx>
                                    <Tx style={{ color: T.muted, fontSize: z(12.5), marginTop: 2 }}>Send the kitchen a gentle reminder.</Tx>
                                </View>
                            </View>
                            <Button label="Please bring it fast 🙏" icon="notifications" kind="ghost" style={{ marginTop: z(10) }} />
                        </Card>

                        <View style={{ marginBottom: z(14) }}>
                            <Card>
                                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: z(10) }}>
                                    <Ionicons name="hand-left" size={z(20)} color={T.primary} />
                                    <Tx style={{ color: T.text, fontWeight: '900', marginLeft: z(8), fontSize: z(14) }}>Need something?</Tx>
                                </View>
                                <Button label="Call the waiter" icon="hand-left" style={{ marginBottom: z(10), marginHorizontal: z(-6), minHeight: z(54) }} />
                                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                                    {['Water', 'Spoon / plate / tissue', 'Clean the table', 'Something else'].map((l) => <Chip key={l} label={l} />)}
                                </View>
                            </Card>
                        </View>

                        <View style={{ marginBottom: z(14) }}>
                            <SectionTitle title="Round 1 · 7:42 pm" />
                            <Card>
                                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: z(6) }}>
                                    <Pill label="Being prepared" color={warn} />
                                    <View style={{ marginLeft: z(6) }}><Pill label="Not paid" color={warn} /></View>
                                </View>
                                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: z(6) }}>
                                    <Ionicons name="flame" size={z(14)} color={T.primary} style={{ marginRight: 5 }} />
                                    <Tx style={{ color: T.primary, fontWeight: '800', fontSize: z(13), flexShrink: 1 }}>Being cooked right now · Ready in about 10 min</Tx>
                                </View>
                                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: z(6) }}>
                                    <Ionicons name="hourglass" size={z(14)} color={T.ok} />
                                    <Tx style={{ color: T.ok, fontWeight: '900', fontSize: z(13), marginLeft: 4 }}>Waiting 4:12</Tx>
                                </View>
                                {item('Paneer Butter Masala', 1, '', '₹260')}
                                {item('Butter Naan', 3, '', '₹150')}
                                <View style={{ flexDirection: 'row', paddingTop: z(8), marginTop: z(6), borderTopWidth: 1, borderTopColor: alpha(T.border, 0.7) }}>
                                    <Tx style={{ flex: 1, color: T.muted, fontWeight: '700', fontSize: z(14) }}>Round total</Tx>
                                    <Tx style={{ color: T.text, fontWeight: '900', fontSize: z(14) }}>₹410</Tx>
                                </View>
                                <Tx style={{ color: warn, fontWeight: '800', marginTop: z(10), fontSize: z(14) }}>Ordered by mistake? Cancel this round</Tx>
                            </Card>
                        </View>
                        <View style={{ marginBottom: z(14), opacity: 0.5 }}>
                            <SectionTitle title="Round 2 · 7:05 pm" />
                            <Card>
                                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: z(6) }}>
                                    <Pill label="Served" color={T.ok} />
                                    <View style={{ marginLeft: z(6) }}><Pill label="Paid" color={T.ok} /></View>
                                </View>
                                <Tx style={{ color: T.ok, fontWeight: '800', fontSize: z(12.5), marginBottom: z(6) }}>Served in 14 min</Tx>
                                {item('Masala Chai', 2, '', '₹60')}
                                <View style={{ flexDirection: 'row', paddingTop: z(8), marginTop: z(6), borderTopWidth: 1, borderTopColor: alpha(T.border, 0.7) }}>
                                    <Tx style={{ flex: 1, color: T.muted, fontWeight: '700', fontSize: z(14) }}>Round total</Tx>
                                    <Tx style={{ color: T.text, fontWeight: '900', fontSize: z(14) }}>₹60</Tx>
                                </View>
                            </Card>
                        </View>

                        <Card>
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: z(6) }}>
                                <Ionicons name="heart" size={z(20)} color={T.primary} />
                                <Tx style={{ color: T.text, fontWeight: '900', marginLeft: z(8), flex: 1, fontSize: z(14) }}>Tip for the waiter</Tx>
                            </View>
                            <Tx style={{ color: T.muted, fontSize: z(12.5), marginBottom: z(10) }}>Optional. It is added to your bill and goes to the staff.</Tx>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                                <Chip label="No tip" on />{['₹20', '₹50', '₹100'].map((l) => <Chip key={l} label={l} />)}<Chip label="Other" />
                            </View>
                        </Card>

                        <Card>
                            {row('Total so far', '₹470', { size: z(14), vsize: z(14), mt: 0 })}
                            {row('Already paid', '- ₹60', { size: z(14), vsize: z(14), mt: z(6), color: T.ok })}
                            <View style={{ flexDirection: 'row', marginTop: z(10), paddingTop: z(10), borderTopWidth: 1, borderTopColor: alpha(T.border, 0.7) }}>
                                <Tx style={{ flex: 1, color: T.text, fontWeight: '900', fontSize: z(17) }}>To pay</Tx>
                                <Tx style={{ color: T.text, fontWeight: '900', fontSize: z(20) }}>₹410</Tx>
                            </View>
                            <Tx style={{ color: T.muted, fontSize: z(12.5), marginTop: z(8) }}>Pay online from here, or in cash or UPI at the counter.</Tx>
                        </Card>

                        <Card>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Ionicons name="people" size={z(20)} color={T.primary} />
                                <Tx style={{ color: T.text, fontWeight: '900', marginLeft: z(8), flex: 1, fontSize: z(14) }}>Split the bill</Tx>
                            </View>
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: z(12) }}>
                                <Tx style={{ flex: 1, color: T.muted, fontWeight: '700', fontSize: z(14) }}>How many are eating?</Tx>
                                <View style={{ flexDirection: 'row', alignItems: 'center', padding: 4, borderRadius: z(24), borderWidth: 1, borderColor: T.border, backgroundColor: T.surface }}>
                                    {dot('remove')}
                                    <Tx style={{ color: T.text, fontWeight: '900', fontSize: z(18), minWidth: z(44), textAlign: 'center' }}>2</Tx>
                                    {dot('add')}
                                </View>
                            </View>
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: z(14), padding: z(14), borderRadius: z(14), backgroundColor: alpha(T.ok, 0.1) }}>
                                <Tx style={{ flex: 1, color: T.text, fontWeight: '800', fontSize: z(14) }}>Each pays</Tx>
                                <Tx style={{ color: T.ok, fontWeight: '900', fontSize: z(22) }}>₹205</Tx>
                            </View>
                        </Card>
                    </Gate>
                </ScrollView>
                <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: z(16), paddingBottom: z(24), backgroundColor: T.background, borderTopWidth: 1, borderTopColor: alpha(T.border, 0.7) }}>
                    <Button label="Pay ₹410 online" icon="card" style={{ marginBottom: z(8) }} />
                    <View style={{ flexDirection: 'row', marginHorizontal: z(-4) }}>
                        <Button label="Order more" icon="add" kind="ghost" style={{ flex: 1, margin: z(4) }} />
                        <Button label="Ask for the bill" icon="receipt" kind="ghost" style={{ flex: 1.3, margin: z(4) }} />
                    </View>
                </View>
            </View>
        );
    }

    /* ------------------------------ Services (ServicesScreen + ServiceHeroCard) ------------------------------ */
    function ServicesPage() {
        const { T } = useP();
        const cards = [['cafe-outline', 'Birthday cake order', 'From ₹800'], ['restaurant-outline', 'Catering for a party', '₹250 per plate'], ['sparkles-outline', 'Table decoration', 'Price on request']];
        return (
            <PageBody title="Services" feature="services" label="Services">
                <View style={{ paddingTop: z(4) }}>
                    {cards.map(([ic, name, price], i) => (
                        <View key={name} style={{ marginHorizontal: z(16), marginBottom: z(14), borderRadius: z(22), shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4 }}>
                            <View style={{ height: z(156), borderRadius: z(22), overflow: 'hidden', backgroundColor: T.primary }}>
                                <LinearGradient colors={[T.primaryLight || T.primary, T.primary, T.primaryDark || T.primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill}>
                                    <Ionicons name={ic} size={z(170)} color="rgba(255,255,255,0.16)" style={{ position: 'absolute', right: z(-22), bottom: z(-26) }} />
                                    <View style={{ position: 'absolute', left: z(-40), top: z(-40), width: z(150), height: z(150), borderRadius: z(75), backgroundColor: 'rgba(255,255,255,0.07)' }} />
                                </LinearGradient>
                                <LinearGradient pointerEvents="none" colors={i === 2 ? ['rgba(0,0,0,0.45)', 'rgba(0,0,0,0.82)'] : ['rgba(0,0,0,0.05)', 'rgba(0,0,0,0.72)']} style={StyleSheet.absoluteFill} />
                                {i === 2 ? (
                                    <View style={{ position: 'absolute', top: z(12), right: z(12), flexDirection: 'row', alignItems: 'center', paddingHorizontal: z(10), paddingVertical: z(6), borderRadius: z(16), backgroundColor: 'rgba(255,255,255,0.9)' }}>
                                        <Ionicons name="pause-circle" size={z(15)} color="#B45309" style={{ marginRight: 5 }} />
                                        <Tx style={{ color: '#B45309', fontWeight: '800', fontSize: z(12) }}>Temporarily unavailable</Tx>
                                    </View>
                                ) : null}
                                <View style={{ position: 'absolute', left: z(16), right: z(16), bottom: z(14), flexDirection: 'row', alignItems: 'flex-end' }}>
                                    <View style={{ flex: 1, minWidth: 0, paddingRight: z(10) }}>
                                        <Tx numberOfLines={1} style={{ color: '#fff', fontSize: z(21), fontWeight: '900' }}>{name}</Tx>
                                        <Tx numberOfLines={1} style={{ color: 'rgba(255,255,255,0.92)', fontSize: z(13.5), fontWeight: '700', marginTop: 3 }}>{price}</Tx>
                                    </View>
                                    <View style={{ width: z(38), height: z(38), borderRadius: z(19), backgroundColor: 'rgba(255,255,255,0.24)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)', alignItems: 'center', justifyContent: 'center' }}>
                                        <Ionicons name="arrow-forward" size={z(19)} color="#fff" />
                                    </View>
                                </View>
                            </View>
                        </View>
                    ))}
                </View>
            </PageBody>
        );
    }

    /* ------------------------------ One service and its inquiry form (ServiceFormScreen) ------------------------------ */
    function InquiryPage() {
        const { T } = useP();
        const facts = [['people-outline', 'From 2 guests'], ['time-outline', 'Ask 24 hours ahead']];
        const bullets = ['Fresh cake made to order', 'Name or message on the cake', 'Free delivery within 5 km'];
        return (
            <FormPage
                title="Birthday cake order"
                feature="services"
                label="Services"
                footer={(
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={{ flex: 1, paddingRight: z(12) }}>
                            <Tx style={{ color: T.muted, fontSize: z(11.5), fontWeight: '700' }}>Price</Tx>
                            <Tx numberOfLines={1} style={{ color: T.text, fontWeight: '900', fontSize: z(16) }}>From ₹800</Tx>
                        </View>
                        <View style={{ width: z(150) }}><Button label="Inquire" icon="send" /></View>
                    </View>
                )}
            >
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: z(16), marginTop: z(16) }}>
                    {facts.map(([ic, l]) => (
                        <View key={l} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: z(12), paddingVertical: z(7), borderRadius: z(16), backgroundColor: alpha(T.primary, 0.12), marginRight: z(8), marginBottom: z(8) }}>
                            <Ionicons name={ic} size={z(14)} color={T.primary} style={{ marginRight: z(6) }} />
                            <Tx style={{ color: T.text, fontWeight: '700', fontSize: z(12.5) }}>{l}</Tx>
                        </View>
                    ))}
                </View>
                <View style={{ backgroundColor: T.surface, borderRadius: z(20), borderWidth: 1, borderColor: T.border, padding: z(16), marginHorizontal: z(16), marginTop: z(4), marginBottom: z(6) }}>
                    <Tx style={{ color: T.text, lineHeight: z(21), fontSize: z(14.5) }}>Custom birthday cakes baked fresh for your day. Tell us the flavour, the size and the message.</Tx>
                    <Tx style={{ color: T.text, fontWeight: '900', fontSize: z(15), marginTop: z(14), marginBottom: 2 }}>What you get</Tx>
                    {bullets.map((b) => (
                        <View key={b} style={{ flexDirection: 'row', marginTop: z(8) }}>
                            <Ionicons name="checkmark-circle" size={z(18)} color={T.primary} style={{ marginRight: z(10), marginTop: 1 }} />
                            <Tx style={{ color: T.text, flex: 1, lineHeight: z(20), fontSize: z(14) }}>{b}</Tx>
                        </View>
                    ))}
                </View>
                <View style={{ height: z(8) }} />
                <Group title="Your details">
                    <TextBox label="Your name" value="Ananya" />
                    <TextBox label="Phone number" value="98765 43210" last />
                </Group>
                <Group title="Tell us more">
                    <View style={{ marginBottom: z(16) }}>
                        <Label>When do you need it? *</Label>
                        <View style={{ minHeight: z(46), borderRadius: z(12), borderWidth: 1, borderColor: T.border, backgroundColor: T.surface, paddingHorizontal: z(14), flexDirection: 'row', alignItems: 'center' }}>
                            <Tx style={{ flex: 1, color: T.muted, fontSize: z(15), fontWeight: '600' }}>Tap to pick a day</Tx>
                            <Ionicons name="calendar-outline" size={z(18)} color={T.muted} />
                        </View>
                    </View>
                    <View style={{ marginBottom: z(12) }}>
                        <Label>Cake size</Label>
                        <Choices options={['500 g', '1 kg', '2 kg']} value="1 kg" />
                    </View>
                    <TextBox label="Name on the cake" placeholder="Optional" last />
                </Group>
                <Group title="Your message">
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: z(8) }}>
                        {['Is it available this weekend?', 'Please share the price'].map((l) => (
                            <View key={l} style={{ marginRight: z(8), marginBottom: z(8), paddingHorizontal: z(12), paddingVertical: z(8), borderRadius: z(16), borderWidth: 1, borderColor: T.border, backgroundColor: T.surface }}>
                                <Tx style={{ color: T.text, fontSize: z(13) }}>{l}</Tx>
                            </View>
                        ))}
                    </View>
                    <TextBox label="Message" placeholder="Tap a text above or write your own" last />
                </Group>
            </FormPage>
        );
    }

    /* ------------------------------ My inquiries (MyInquiriesScreen) ------------------------------ */
    function MyInquiriesPage() {
        const { T } = useP();
        const rows = [['Birthday cake order', '6 Nov 2026', 'Shop: Ready by 6 pm for ₹950. Shall I confirm?', 'Price sent', T.muted, true], ['Catering for a party', '3 Nov 2026', 'Please share the price', 'New', T.muted, false]];
        return (
            <PageBody title="My inquiries" feature="services" label="Services">
                <View style={{ paddingTop: z(0) }}>
                    {rows.map(([name, date, last, st, color, unread]) => (
                        <Card key={name}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                {unread ? <View style={{ width: z(10), height: z(10), borderRadius: z(5), backgroundColor: T.errorText, marginRight: z(8) }} /> : null}
                                <Tx numberOfLines={1} style={{ color: T.text, fontWeight: '900', fontSize: z(16), flex: 1 }}>{name}</Tx>
                                <Pill label={st} color={color} />
                            </View>
                            <Tx style={{ color: T.muted, fontSize: z(12), marginTop: 2 }}>{date}</Tx>
                            <Tx numberOfLines={2} style={{ color: T.text, marginTop: z(6), fontSize: z(14) }}>{last}</Tx>
                        </Card>
                    ))}
                </View>
            </PageBody>
        );
    }

    /* ------------------------------ one inquiry I sent (InquiryScreen) ------------------------------ */
    function InquiryDetailPage() {
        const { T } = useP();
        const asked = [['When do you need it?', 'Sat 8 Nov 2026'], ['Cake size', '1 kg'], ['Name on the cake', 'Aanya']];
        return (
            <PageBody title="Birthday cake order" feature="services" label="Services">
                <View style={{ paddingHorizontal: z(16), marginBottom: z(8) }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: T.primary, backgroundColor: T.surface, borderRadius: z(14), paddingHorizontal: z(14), minHeight: z(48) }}>
                        <Ionicons name="chatbubbles-outline" size={z(22)} color={T.primary} />
                        <Tx style={{ flex: 1, marginLeft: z(10), color: T.text, fontWeight: '800', fontSize: z(15) }}>Chat with the shop</Tx>
                    </View>
                </View>
                <View style={{ paddingTop: z(8) }}>
                    <Card>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Tx style={{ color: T.text, fontWeight: '900', fontSize: z(17), flex: 1 }}>Birthday cake order</Tx>
                            <Pill label="Price sent" color={T.muted} />
                        </View>
                        <Tx style={{ color: T.muted, marginTop: 2, fontSize: z(14) }}>6 Nov 2026</Tx>
                    </Card>
                    <Group title="What I asked">
                        {asked.map(([l, v]) => (
                            <View key={l} style={{ flexDirection: 'row', marginTop: 4 }}>
                                <Tx style={{ color: T.muted, fontSize: z(13), flex: 2 }}>{l}</Tx>
                                <Tx style={{ color: T.text, fontSize: z(14), fontWeight: '700', flex: 3 }}>{v}</Tx>
                            </View>
                        ))}
                    </Group>
                </View>
            </PageBody>
        );
    }


    /* ------------------------------ bits shared by the bulk screens ------------------------------ */
    const VegMark = ({ veg = true, size = 14 }) => {
        const c = veg ? '#16A34A' : '#DC2626';
        return <View style={{ width: z(size), height: z(size), borderWidth: 1.5, borderColor: c, borderRadius: 3, alignItems: 'center', justifyContent: 'center' }}><View style={{ width: z(size * 0.5), height: z(size * 0.5), borderRadius: z(size), backgroundColor: c }} /></View>;
    };
    const Thumb = ({ size = 56 }) => {
        const { T } = useP();
        return <View style={{ width: z(size), height: z(size), borderRadius: z(12), backgroundColor: T.border, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="fast-food-outline" size={z(size * 0.42)} color={T.muted} /></View>;
    };
    // one counter: a minus, the number, a plus
    const Qty = ({ value, min = 0 }) => {
        const { T } = useP();
        const btn = { width: z(34), height: z(34), borderRadius: z(10), alignItems: 'center', justifyContent: 'center' };
        const canMinus = value > Math.max(0, min) && value > 0;
        return (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={[btn, { borderWidth: 1, borderColor: T.border, backgroundColor: T.surface, opacity: canMinus ? 1 : 0.4 }]}><Ionicons name="remove" size={z(18)} color={T.text} /></View>
                <Tx style={{ minWidth: z(52), textAlign: 'center', color: value ? T.text : T.border, fontWeight: '900', fontSize: z(16), paddingVertical: 4 }}>{value || '0'}</Tx>
                <View style={[btn, { backgroundColor: T.primary }]}><Ionicons name="add" size={z(18)} color={T.onPrimary} /></View>
            </View>
        );
    };
    const Toggle = ({ on }) => {
        const { T } = useP();
        return (
            <View style={{ width: z(46), height: z(26), borderRadius: z(13), backgroundColor: on ? T.primary : T.border, padding: 3, alignItems: on ? 'flex-end' : 'flex-start' }}>
                <View style={{ width: z(20), height: z(20), borderRadius: z(10), backgroundColor: '#FFFFFF' }} />
            </View>
        );
    };
    const ToggleRow = ({ title, subtitle, on, last }) => {
        const { T } = useP();
        return (
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: z(12), borderBottomWidth: last ? 0 : HAIR, borderBottomColor: T.border }}>
                <View style={{ flex: 1, paddingRight: z(12) }}>
                    <Tx style={{ color: T.text, fontWeight: '800', fontSize: z(15) }}>{title}</Tx>
                    {subtitle ? <Tx style={{ color: T.muted, fontSize: z(12), marginTop: 2 }}>{subtitle}</Tx> : null}
                </View>
                <Toggle on={on} />
            </View>
        );
    };
    const Req = ({ children, hint }) => {
        const { T } = useP();
        return (
            <View style={{ marginBottom: z(6) }}>
                <Tx style={{ color: T.text, fontWeight: '800', fontSize: z(13) }}>{children}<Tx style={{ color: T.errorText, fontWeight: '900' }}> *</Tx></Tx>
                {hint ? <Tx style={{ color: T.muted, fontSize: z(12), marginTop: 1 }}>{hint}</Tx> : null}
            </View>
        );
    };
    const IconChip = ({ label, icon, on }) => {
        const { T } = useP();
        return (
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: z(14), paddingVertical: z(8), borderWidth: 1, borderRadius: z(20), marginRight: z(8), marginBottom: z(8), backgroundColor: on ? alpha(T.primary, 0.14) : T.surface, borderColor: on ? T.primary : T.border }}>
                {icon ? <Ionicons name={icon} size={z(14)} color={on ? T.primary : T.text} style={{ marginRight: z(6) }} /> : null}
                <Tx numberOfLines={1} style={{ fontSize: z(13), fontWeight: '700', color: on ? T.primary : T.text }}>{label}</Tx>
            </View>
        );
    };
    const PickBox = ({ icon, value, placeholder, iconColor }) => {
        const { T } = useP();
        return (
            <View style={{ minHeight: z(46), borderRadius: z(12), borderWidth: 1, borderColor: T.border, backgroundColor: T.surface, paddingHorizontal: z(14), paddingVertical: z(10), flexDirection: 'row', alignItems: 'center' }}>
                {iconColor ? <Ionicons name={icon} size={z(18)} color={iconColor} style={{ marginRight: z(8) }} /> : null}
                <Tx numberOfLines={2} style={{ flex: 1, color: value ? T.text : T.muted, fontSize: z(15), fontWeight: '600' }}>{value || placeholder}</Tx>
                {iconColor || !icon ? null : <Ionicons name={icon} size={z(18)} color={T.muted} />}
            </View>
        );
    };
    const Sum = ({ k, v, bold }) => {
        const { T } = useP();
        return (
            <View style={{ flexDirection: 'row', paddingVertical: 2 }}>
                <Tx style={{ flex: 1, color: bold ? T.text : T.muted, fontWeight: bold ? '900' : '600', fontSize: z(14) }}>{k}</Tx>
                <Tx style={{ color: T.text, fontWeight: bold ? '900' : '700', fontSize: z(14) }}>{v}</Tx>
            </View>
        );
    };
    const ChatBar = ({ label }) => {
        const { T } = useP();
        return (
            <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: T.primary, backgroundColor: T.surface, borderRadius: z(14), paddingHorizontal: z(14), minHeight: z(48) }}>
                <Ionicons name="chatbubbles-outline" size={z(22)} color={T.primary} />
                <Tx style={{ flex: 1, marginLeft: z(10), color: T.text, fontWeight: '800', fontSize: z(15) }}>{label}</Tx>
            </View>
        );
    };
    const BulkBar = () => {
        const { T } = useP();
        const r = Math.max(T.radius, 14);
        return (
            <LinearGradient colors={[T.primaryLight || T.primary, T.primaryDark || T.primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: z(14), paddingVertical: z(12), borderRadius: r }}>
                <View style={{ width: z(34), height: z(34), borderRadius: z(17), backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' }}><Ionicons name="cube" size={z(18)} color={T.onPrimary} /></View>
                <View style={{ flex: 1, marginLeft: z(10) }}>
                    <Tx style={{ color: T.onPrimary, fontWeight: '900', fontSize: z(11.5), letterSpacing: 1, opacity: 0.9 }}>BULK ORDER</Tx>
                    <Tx numberOfLines={1} style={{ color: T.onPrimary, fontWeight: '800', fontSize: z(14) }}>3 dishes · 85 pieces</Tx>
                </View>
                <Tx style={{ color: T.onPrimary, fontWeight: '900', fontSize: z(14) }}>View bulk cart</Tx>
                <Ionicons name="chevron-forward" size={z(18)} color={T.onPrimary} />
            </LinearGradient>
        );
    };
    const BulkPill = ({ label, color }) => <Pill label={label} color={color} />;

    /* ------------------------------ Bulk order, step 1 (BulkOrderScreen) ------------------------------ */
    function BulkOrderPage() {
        const { T } = useP();
        const dishHead = (name, veg, price, note, got, min) => (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Thumb />
                <View style={{ flex: 1, marginLeft: z(12) }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <VegMark veg={veg} />
                        <Tx numberOfLines={2} style={{ flex: 1, color: T.text, fontWeight: '800', fontSize: z(15), marginLeft: z(8) }}>{name}</Tx>
                    </View>
                    {price ? <Tx style={{ color: T.muted, fontWeight: '700', marginTop: 2, fontSize: z(14) }}>{price}</Tx> : null}
                    {note ? <Tx style={{ color: got ? T.ok : T.primary, fontSize: z(12), fontWeight: '800', marginTop: 2 }}>{got ? '✓ ' + note : note}</Tx> : null}
                    {min ? <Tx style={{ color: T.muted, fontSize: z(12), marginTop: 2 }}>Least you can order: {min}</Tx> : null}
                </View>
            </View>
        );
        const wrap = { paddingVertical: z(12), borderBottomWidth: 1, borderBottomColor: T.border };
        return (
            <FormPage title="Bulk order" feature="bulkOrders" label="Bulk orders" footer={<BulkBar />}>
                <Group title="Pick the dishes">
                    <Tx style={{ color: T.muted, fontSize: z(12), marginBottom: z(10) }}>The minimum bulk order is ₹5000. Hold + to add 10 at a time, or type the number.</Tx>
                    <TextBox placeholder="Search a dish" last />
                    <Tx style={{ color: T.primary, fontWeight: '900', marginTop: z(14), marginBottom: 2, fontSize: z(12.5) }}>STARTERS</Tx>
                    <View style={wrap}>
                        {dishHead('Paneer Tikka', true, '₹220', '50 or more: 10% off', true, 20)}
                        <View style={{ alignItems: 'flex-end', marginTop: z(8) }}><Qty value={60} min={20} /></View>
                    </View>
                    <View style={wrap}>
                        {dishHead('Chicken Seekh Kebab', false, '₹260', '30 or more: 8% off', false, 0)}
                        <View style={{ alignItems: 'flex-end', marginTop: z(8) }}><Qty value={0} /></View>
                    </View>
                    <Tx style={{ color: T.primary, fontWeight: '900', marginTop: z(14), marginBottom: 2, fontSize: z(12.5) }}>MAIN COURSE</Tx>
                    <View style={wrap}>
                        {dishHead('Veg Biryani', true, '', '', false, 0)}
                        {[['Half', '₹180', 10, 15], ['Full', '₹320', 10, 10]].map(([n, p, mn, v]) => (
                            <View key={n} style={{ flexDirection: 'row', alignItems: 'center', marginTop: z(8) }}>
                                <Tx style={{ flex: 1, color: T.text, fontSize: z(14) }}>{n}  <Tx style={{ color: T.muted }}>{p}</Tx><Tx style={{ color: T.muted, fontSize: z(12) }}>{'  · min ' + mn}</Tx></Tx>
                                <Qty value={v} min={mn} />
                            </View>
                        ))}
                    </View>
                    <View style={{ ...wrap, borderBottomWidth: 0 }}>
                        {dishHead('Dal Makhani', true, '', '', false, 0)}
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: z(8) }}>
                            <Ionicons name="add-circle-outline" size={z(18)} color={T.primary} style={{ marginRight: z(6) }} />
                            <Tx style={{ color: T.primary, fontWeight: '800', fontSize: z(14) }}>Choose options and add</Tx>
                        </View>
                    </View>
                </Group>
            </FormPage>
        );
    }

    /* ------------------------------ Bulk cart (BulkCartScreen) ------------------------------ */
    function BulkCartPage() {
        const { T } = useP();
        const line = (name, label, calc, v, last, ok) => (
            <View style={{ paddingVertical: z(10), borderBottomWidth: last ? 0 : 1, borderBottomColor: T.border }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Thumb size={52} />
                    <View style={{ flex: 1, marginLeft: z(12) }}>
                        <Tx numberOfLines={2} style={{ color: T.text, fontWeight: '800', fontSize: z(15) }}>{name}</Tx>
                        {label ? <Tx style={{ color: T.muted, fontSize: z(12.5) }}>{label}</Tx> : null}
                        <Tx style={{ color: ok ? T.ok : T.muted, fontSize: z(12), marginTop: 1 }}>{calc}</Tx>
                    </View>
                </View>
                <View style={{ alignItems: 'flex-end', marginTop: z(8) }}><Qty value={v} /></View>
            </View>
        );
        const input = (txt) => (
            <View style={{ borderColor: T.border, backgroundColor: T.surface, borderWidth: 1, borderRadius: z(12), paddingHorizontal: z(14), paddingVertical: z(10), marginTop: z(6) }}>
                <Tx style={{ color: T.muted, fontSize: z(15) }}>{txt}</Tx>
            </View>
        );
        return (
            <FormPage
                title="BULK ORDER"
                feature="bulkOrders"
                label="Bulk orders"
                footer={(
                    <View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: z(8) }}>
                            <Tx style={{ color: T.muted, flex: 1, fontSize: z(14) }}>Estimate, the shop confirms the final price</Tx>
                            <Tx style={{ color: T.text, fontWeight: '900', fontSize: z(20) }}>₹14,820</Tx>
                        </View>
                        <Button label="Ask the shop for a quote" icon="send" />
                    </View>
                )}
            >
                <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginHorizontal: z(16), marginBottom: z(6), paddingHorizontal: z(12), paddingVertical: z(5), borderRadius: 99, backgroundColor: alpha(T.primary, 0.12) }}>
                    <Ionicons name="cube" size={z(14)} color={T.primary} style={{ marginRight: z(6) }} />
                    <Tx style={{ color: T.primary, fontWeight: '900', fontSize: z(12.5), flexShrink: 1 }}>This is a bulk order: the shop sends a quote first. You pay after you accept it.</Tx>
                </View>

                <Group title="Delivery">
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                        <IconChip label="Pickup" icon="bag-handle-outline" />
                        <IconChip label="Delivery" icon="bicycle-outline" on />
                    </View>
                    <View style={{ height: z(10) }} />
                    <Req hint="Earliest: Fri 7 Nov, 1:00 pm · The shop needs 24 hours notice">Delivery date and time</Req>
                    <View style={{ marginBottom: z(10) }}><PickBox icon="calendar-outline" value="Sat, 8 Nov 2026" /></View>
                    <View style={{ marginBottom: z(16) }}>
                        <Req>Time</Req>
                        <PickBox icon="time-outline" value="13:00" />
                    </View>
                    <Req>Delivery address</Req>
                    <PickBox icon="location-outline" iconColor={T.primary} value="Plot 14, Sector 9, Lucknow 226010" />
                </Group>

                <Group title="Your dishes">
                    <Tx style={{ color: T.muted, fontSize: z(12), marginBottom: z(6) }}>The minimum bulk order is ₹5000. Hold + to add 10 at a time, or type the number.</Tx>
                    {line('Paneer Tikka', '', '60 × ₹198  (bulk price, was ₹220) = ₹11,880', 60, false, true)}
                    {line('Veg Biryani', 'Half', '15 × ₹180 = ₹2,700', 15, false)}
                    {line('Butter Naan', '', '40 × ₹60 = ₹2,400', 40, true)}
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: z(10) }}>
                        <Ionicons name="add-circle-outline" size={z(18)} color={T.primary} style={{ marginRight: z(6) }} />
                        <Tx style={{ color: T.primary, fontWeight: '800', fontSize: z(14) }}>Add more dishes</Tx>
                    </View>
                </Group>

                <Group title="Instructions for the kitchen">
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                        {['Less spicy', 'No onion', 'Extra crispy'].map((l, i) => <IconChip key={l} label={l} on={i === 0} />)}
                    </View>
                    {input('E.g., less spicy, no onion, extra crispy...')}
                    <Tx style={{ color: T.muted, fontSize: z(12), marginTop: z(6) }}>The cook hears this before your food is made.</Tx>
                </Group>

                <Group title="Delivery Instructions">
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        {['Leave at the gate', 'Call on arrival', 'Do not ring the bell'].map((l, i) => <IconChip key={l} label={l} on={i === 1} />)}
                    </ScrollView>
                    {input('E.g., Any specific landmark or instructions...')}
                </Group>

                <Group title="Price">
                    <Sum k="Items" v="₹16,980" />
                    <Sum k="GST" v="₹849" />
                    <Sum k="Packaging" v="₹300" />
                    <Sum k="Delivery" v="₹120" />
                    <Sum k="Estimated total" v="₹14,820" bold />
                    <Tx style={{ color: T.ok, fontWeight: '800', marginTop: z(6), fontSize: z(14) }}>You save ₹1,320 with bulk prices</Tx>
                    <Tx style={{ color: T.muted, fontSize: z(12), marginTop: z(6) }}>The shop will send its own quote. You pay only after you accept it.</Tx>
                </Group>

                <Group title="A few things the shop needs">
                    <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: z(12), paddingVertical: z(8), borderRadius: z(12), borderWidth: 1, borderColor: T.primary, marginBottom: z(14) }}>
                        <Ionicons name="refresh-circle-outline" size={z(18)} color={T.primary} style={{ marginRight: z(6) }} />
                        <Tx style={{ color: T.primary, fontWeight: '800', fontSize: z(14) }}>Use my last details</Tx>
                    </View>
                    <ToggleRow title="Send cutlery" subtitle="Plates, spoons and so on" on />
                    <View style={{ marginBottom: z(12) }}>
                        <Label>Packing</Label>
                        <Choices options={['Individual boxes', 'Big trays', 'Any']} value="Big trays" />
                    </View>
                    <View style={{ marginBottom: z(16) }}>
                        <Req>Contact person</Req>
                        <PickBox icon="" value="Ananya Sharma" />
                    </View>
                    <View style={{ marginBottom: z(16) }}>
                        <Req>Phone number</Req>
                        <PickBox icon="" value="9876543210" />
                    </View>
                    <TextBox label="Phone of the person at the place (optional)" placeholder="" />
                    <TextBox label="Company name (optional)" placeholder="" />
                    <TextBox label="GST number for the invoice (optional)" placeholder="" />
                    <TextBox label="Anything else" placeholder="Spice level, timing, who receives it..." last />
                </Group>
            </FormPage>
        );
    }

    /* ------------------------------ A bulk order and its quote (BulkOrderDetailScreen) ------------------------------ */
    function BulkOrderDetailPage() {
        const { T } = useP();
        const qline = (name, opt, calc, total, was, okc) => (
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: z(5) }}>
                <View style={{ marginRight: z(10) }}><Thumb size={40} /></View>
                <View style={{ flex: 1, paddingRight: z(8) }}>
                    <Tx style={{ color: T.text, fontWeight: '700', fontSize: z(14) }}>{name}{opt ? ' · ' + opt : ''}</Tx>
                    <Tx style={{ color: okc ? T.ok : T.muted, fontSize: z(12) }}>{calc}</Tx>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                    {was ? <Tx style={{ color: T.muted, fontSize: z(12), textDecorationLine: 'line-through' }}>{was}</Tx> : null}
                    <Tx style={{ color: T.text, fontWeight: '800', fontSize: z(14) }}>{total}</Tx>
                </View>
            </View>
        );
        const delta = (k, was, now, bold) => (
            <View style={{ flexDirection: 'row', paddingVertical: 2, alignItems: 'center' }}>
                <Tx style={{ flex: 1, color: bold ? T.text : T.muted, fontWeight: bold ? '900' : '600', fontSize: z(14) }}>{k}</Tx>
                {was ? <Tx style={{ color: T.muted, textDecorationLine: 'line-through', marginRight: z(8), fontSize: z(14) }}>{was}</Tx> : null}
                <Tx style={{ color: T.text, fontWeight: bold ? '900' : '700', fontSize: z(14) }}>{now}</Tx>
            </View>
        );
        const rule = <View style={{ height: 1, backgroundColor: T.border, marginVertical: z(8) }} />;
        return (
            <View style={{ flex: 1, backgroundColor: T.background }}>
                <Header title="Bulk order BK-1042" />
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: z(40) }}>
                    <Gate feature="bulkOrders" label="Bulk orders">
                        <Card>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Tx style={{ flex: 1, color: T.text, fontWeight: '900', fontSize: z(16) }}>Delivery · Sat, 8 Nov, 1:00 pm</Tx>
                                <BulkPill label="Quote received" color={T.primary} />
                            </View>
                            <Tx style={{ color: T.muted, marginTop: z(6), fontSize: z(14) }}>Plot 14, Sector 9, Lucknow 226010</Tx>
                            <Tx style={{ color: T.muted, marginTop: z(6), fontSize: z(12.5) }}>With cutlery · Big trays</Tx>
                        </Card>
                        <View style={{ paddingHorizontal: z(16), marginTop: z(12) }}><ChatBar label="Chat with the shop" /></View>

                        <Card style={{ marginTop: z(12) }}>
                            <Tx style={{ color: T.text, fontWeight: '900', marginBottom: z(6), fontSize: z(14) }}>What the shop changed</Tx>
                            {delta('Items', '₹16,980', '₹16,200')}
                            {delta('Shop discount (5%)', null, '− ₹810')}
                            {delta('Delivery', '₹120', 'Free')}
                            {rule}
                            {delta('Your estimate became', '₹14,820', '₹14,010', true)}
                        </Card>

                        <SectionTitle title="The shop's quote" />
                        <Card>
                            {qline('Paneer Tikka', '', '60 × ₹190 (bulk price) = ₹11,400', '₹11,400', '₹11,880', true)}
                            {qline('Veg Biryani', 'Half', '15 × ₹180 = ₹2,700', '₹2,700')}
                            {qline('Butter Naan', '', '40 × ₹60 = ₹2,400', '₹2,400')}
                            {rule}
                            <Sum k="Items" v="₹16,500" />
                            <Sum k="Shop discount (5%)" v="− ₹810" />
                            <Sum k="GST" v="₹785" />
                            <Sum k="Packaging" v="₹300" />
                            <Sum k="Delivery" v="Free" />
                            <Sum k="Total" v="₹14,010" bold />
                            <View style={{ marginTop: z(10) }}>
                                <Sum k="To pay now to confirm (30%)" v="₹4,203" bold />
                                <Sum k="Balance, on delivery" v="₹9,807" />
                                <Tx style={{ color: T.text, fontSize: z(13), marginTop: z(6) }}>The shop needs about 24 hours to make this</Tx>
                                <Tx style={{ color: T.muted, fontSize: z(12), marginTop: z(6) }}>This quote is valid until Thu, 6 Nov, 9:00 pm</Tx>
                                <Tx style={{ color: T.text, marginTop: z(8), fontSize: z(14) }}>The shop says: We can deliver by 12:30 pm.</Tx>
                            </View>
                        </Card>

                        <View style={{ paddingHorizontal: z(16), marginTop: z(12) }}>
                            <Button label="Accept and pay ₹4,203 now" icon="lock-closed" style={{ marginBottom: z(6) }} />
                            <Tx style={{ color: T.muted, fontSize: z(12), marginBottom: z(10) }}>Cancel at least 24 hours before the time and the whole advance comes back. Later, the shop keeps it.</Tx>
                        </View>
                        <View style={{ paddingHorizontal: z(16), marginTop: z(12) }}>
                            <Button label="Ask for a change" icon="create-outline" kind="ghost" style={{ marginBottom: z(10) }} />
                            <Button label="Cancel this request" icon="close-circle-outline" kind="ghost" />
                        </View>
                    </Gate>
                </ScrollView>
            </View>
        );
    }

    /* ------------------------------ My bulk orders (MyBulkOrdersScreen) ------------------------------ */
    function MyBulkPage() {
        const { T } = useP();
        const rows = [['BK-1042', 'Quote received', T.primary, 'Delivery · Sat, 8 Nov, 1:00 pm', 'Quote ₹14,010'], ['BK-1031', 'Confirmed', T.ok, 'Pickup · Mon, 3 Nov, 6:00 pm', 'Quote ₹6,420'], ['BK-1017', 'Declined by the shop', T.errorText, 'Delivery · Sun, 26 Oct, 2:00 pm', 'Estimate ₹9,100']];
        return (
            <PageBody title="My bulk orders" feature="bulkOrders" label="Bulk orders">
                {rows.map(([code, st, color, when, price]) => (
                    <Card key={code}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Tx style={{ flex: 1, color: T.text, fontWeight: '900', fontSize: z(16) }}>{code}</Tx>
                            <BulkPill label={st} color={color} />
                        </View>
                        <Tx style={{ color: T.muted, marginTop: 4, fontSize: z(14) }}>{when}</Tx>
                        <Tx style={{ color: T.text, fontWeight: '800', marginTop: 4, fontSize: z(14) }}>{price}</Tx>
                    </Card>
                ))}
                <View style={{ paddingHorizontal: z(16), marginTop: z(8) }}><Button label="New bulk order" icon="add" /></View>
            </PageBody>
        );
    }

    /* ------------------------------ My points (MyPointsScreen) ------------------------------ */
    function PointsPage() {
        const { T } = useP();
        const warn = '#D98200';
        const gold = '#D99A00';
        const TCard = ({ tone, children }) => <Card style={tone ? { borderColor: alpha(tone, 0.35) } : null}>{children}</Card>;
        const earn = [['restaurant', '1 point for every ₹10 you spend on food'], ['gift', '50 bonus points on your first order'], ['star', '10 points for reviewing the food'], ['bicycle', '5 points for rating the delivery']];
        const hist = [['Order delivered · #1042', 'today, 6:40 pm', '+42', 'ok'], ['Used on an order · #1031', 'Mon, 3 Nov', '-200', 'text'], ['Food review', 'Sun, 2 Nov', '+10', 'ok'], ['First order bonus', '28 Oct', '+50', 'ok']];
        return (
            <PageBody title="My points" feature="points" label="Points">
                <TCard tone={T.primary}>
                    <Tx style={{ color: T.muted, fontWeight: '700', fontSize: z(12) }}>YOUR POINTS</Tx>
                    <Tx style={{ color: T.text, fontSize: z(40), fontWeight: '900', marginTop: 2 }}>340</Tx>
                    <Tx style={{ color: T.ok, fontWeight: '800', marginTop: 2, fontSize: z(14) }}>Worth ₹34 off your next order</Tx>
                </TCard>
                <TCard tone={gold}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Tx style={{ fontSize: z(30) }}>🥇</Tx>
                        <View style={{ flex: 1, marginLeft: z(12) }}>
                            <Tx style={{ color: gold, fontWeight: '900', fontSize: z(18) }}>Gold level</Tx>
                            <Tx style={{ color: T.muted, fontSize: z(12.5), marginTop: 2 }}>10% extra points on every order</Tx>
                        </View>
                    </View>
                    <View style={{ marginTop: z(12) }}>
                        <View style={{ height: z(8), borderRadius: z(4), backgroundColor: alpha(T.muted, 0.2), overflow: 'hidden' }}>
                            <View style={{ width: '68%', height: '100%', backgroundColor: '#5B6CF0' }} />
                        </View>
                        <Tx style={{ color: T.muted, fontSize: z(12.5), marginTop: z(6) }}>Spend ₹3,200 more to reach Platinum (15% extra points)</Tx>
                    </View>
                    <Tx style={{ color: T.muted, fontSize: z(12), marginTop: z(8) }}>Based on what you spent on food in the last 12 months: ₹6,800</Tx>
                </TCard>
                <TCard tone={warn}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name="time" size={z(22)} color={warn} />
                        <View style={{ flex: 1, marginLeft: z(10) }}>
                            <Tx style={{ color: T.text, fontWeight: '900', fontSize: z(14) }}>42 points on the way</Tx>
                            <Tx style={{ color: T.muted, fontSize: z(12.5), marginTop: 2 }}>They reach you by 6:40 pm tomorrow</Tx>
                        </View>
                    </View>
                </TCard>

                <SectionTitle title="How to earn" />
                <Card>
                    {earn.map(([ic, l]) => (
                        <View key={l} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: z(7) }}>
                            <Ionicons name={ic} size={z(18)} color={T.primary} />
                            <Tx style={{ flex: 1, color: T.text, marginLeft: z(10), fontWeight: '600', fontSize: z(14) }}>{l}</Tx>
                        </View>
                    ))}
                    <Tx style={{ color: T.muted, fontSize: z(12.5), marginTop: z(8) }}>Points reach you 24 hours after the order is delivered, so a refund never takes them back.</Tx>
                </Card>

                <SectionTitle title="How to use" />
                <Card>
                    <Tx style={{ color: T.text, fontWeight: '700', fontSize: z(14) }}>100 points = ₹10 off</Tx>
                    <Tx style={{ color: T.muted, fontSize: z(12.5), marginTop: z(6) }}>Turn on "Use points" in your cart. Points can pay up to 20% of the food bill. Points last 12 months.</Tx>
                </Card>

                <SectionTitle title="History" />
                <Card>
                    {hist.map(([a, b, v, tone], i) => (
                        <View key={a} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: z(10), borderTopWidth: i ? 1 : 0, borderTopColor: alpha(T.border, 0.7) }}>
                            <View style={{ flex: 1 }}>
                                <Tx style={{ color: T.text, fontWeight: '700', fontSize: z(14) }}>{a}</Tx>
                                <Tx style={{ color: T.muted, fontSize: z(12), marginTop: 2 }}>{b}</Tx>
                            </View>
                            <Tx style={{ color: tone === 'ok' ? T.ok : T.text, fontWeight: '900', fontSize: z(16) }}>{v}</Tx>
                        </View>
                    ))}
                </Card>
            </PageBody>
        );
    }

    /* ------------------------------ Refer a friend (ReferFriendScreen) ------------------------------ */
    function ReferPage() {
        const { T } = useP();
        const stat = (label, value, color) => (
            <View style={{ flex: 1, minWidth: 0 }}>
                <Tx style={{ color: T.muted, fontSize: z(12), fontWeight: '700' }} numberOfLines={1}>{label}</Tx>
                <Tx style={{ color: color || T.text, fontSize: z(22), fontWeight: '900', marginTop: 2 }} numberOfLines={1}>{value}</Tx>
            </View>
        );
        return (
            <PageBody title="Refer a friend" feature="refer" label="Refer a friend" fixedBottom={z(40)}>
                <Card>
                    <View style={{ alignItems: 'center', paddingVertical: z(6) }}>
                        <Ionicons name="gift" size={z(40)} color={T.primary} />
                        <Tx style={{ color: T.text, fontWeight: '900', fontSize: z(18), textAlign: 'center', marginTop: z(8) }}>Your friend gets 15% off. You get 50 points.</Tx>
                        <Tx style={{ color: T.muted, textAlign: 'center', marginTop: z(6), fontSize: z(12.5) }}>The offer is for their first table order (up to ₹150). You get your points when that first meal is paid.</Tx>
                        <View style={{ marginTop: z(14), paddingVertical: z(12), paddingHorizontal: z(26), borderRadius: z(14), backgroundColor: alpha(T.primary, 0.12), borderWidth: 1.5, borderColor: T.primary, borderStyle: 'dashed' }}>
                            <Tx style={{ color: T.primary, fontWeight: '900', fontSize: z(28), letterSpacing: 4 }}>ANK7Q2</Tx>
                        </View>
                        <Button label="Share my code" icon="share-social" style={{ alignSelf: 'stretch', marginTop: z(16) }} />
                    </View>
                </Card>
                <Card>
                    <View style={{ flexDirection: 'row' }}>
                        {stat('Friends joined', '4')}{stat('Had a first meal', '2')}{stat('Points earned', '100', T.ok)}
                    </View>
                </Card>
                <Card>
                    <Tx style={{ color: T.text, fontWeight: '900', fontSize: z(14) }}>Have a friend's code?</Tx>
                    <Tx style={{ color: T.muted, fontSize: z(12.5), marginTop: 2 }}>Enter it before your first order to get the friend offer.</Tx>
                    <View style={{ marginTop: z(10), borderWidth: 1, borderColor: T.border, backgroundColor: T.surface, borderRadius: z(12), padding: z(12) }}>
                        <Tx style={{ color: T.muted, fontWeight: '900', letterSpacing: 3, fontSize: z(16) }}>ABC123</Tx>
                    </View>
                    <Button label="Use this code" icon="checkmark" style={{ marginTop: z(10), opacity: 0.45 }} />
                </Card>
            </PageBody>
        );
    }


    /* ------------------------------ Account (AccountScreen): the tiles, then only the groups this shop has switched on ------------------------------ */
    function AccountPage() {
        const { T, C, nav } = useP();
        const bookingOn = C.features.tableBooking === true;
        const bulkOn = C.features.bulkOrders === true;
        const servicesOn = C.features.services === true;
        const pointsOn = C.loyalty?.customer?.enabled !== false && C.plan?.features?.loyalty !== false;
        const referOn = C.orders?.dineIn?.enabled === true && C.orders?.dineIn?.referOn === true;
        const favOn = C.features.favourites === true;
        const tile = (icon, label, sub, go, badge) => (
            <View key={label} style={{ width: '48.5%', marginBottom: z(12) }}>
                <Pressable onPress={go} style={{ borderWidth: 1, borderRadius: z(18), padding: z(14), minHeight: z(112), backgroundColor: T.surface, borderColor: T.border }}>
                    <View style={{ width: z(46), height: z(46), borderRadius: z(16), alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(T.primary, 0.12) }}>
                        <Ionicons name={icon} size={z(22)} color={T.primary} />
                        {badge ? <View style={{ position: 'absolute', top: -5, right: -6, minWidth: z(18), height: z(18), borderRadius: z(9), paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: T.primary }}><Tx style={{ color: '#FFFFFF', fontSize: z(10), fontWeight: '900' }}>{badge}</Tx></View> : null}
                    </View>
                    <Tx numberOfLines={1} style={{ fontSize: z(15), fontWeight: '900', marginTop: z(12), color: T.text }}>{label}</Tx>
                    <Tx numberOfLines={1} style={{ fontSize: z(11.5), marginTop: 2, color: T.muted }}>{sub}</Tx>
                </Pressable>
            </View>
        );
        const Grp = ({ title, children }) => (
            <View style={{ marginHorizontal: z(16), marginTop: z(18) }}>
                {title ? <Tx style={{ fontSize: z(11), fontWeight: '800', letterSpacing: 1, marginBottom: z(8), marginLeft: 4, color: T.muted }}>{title}</Tx> : null}
                <View style={{ borderWidth: 1, borderRadius: z(18), overflow: 'hidden', backgroundColor: T.surface, borderColor: T.border }}>{children}</View>
            </View>
        );
        const Item = ({ icon, label, sub, go, danger, last, right }) => {
            const c = danger ? T.errorText : T.primary;
            return (
                <Pressable onPress={go} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: z(14), paddingVertical: z(14), borderBottomWidth: last ? 0 : HAIR, borderBottomColor: T.border }}>
                    <View style={{ width: z(36), height: z(36), borderRadius: z(18), alignItems: 'center', justifyContent: 'center', marginRight: z(12), backgroundColor: alpha(c, 0.12) }}><Ionicons name={icon} size={z(18)} color={c} /></View>
                    <View style={{ flex: 1, paddingRight: right ? z(8) : 0 }}>
                        <Tx style={{ fontSize: z(14), fontWeight: '700', color: danger ? T.errorText : T.text }}>{label}</Tx>
                        {sub ? <Tx style={{ fontSize: z(11), marginTop: 2, color: T.muted }} numberOfLines={right ? 2 : 1}>{sub}</Tx> : null}
                    </View>
                    {right || <Ionicons name="chevron-forward" size={z(18)} color={T.muted} />}
                </Pressable>
            );
        };
        const go = (k) => () => nav.push(k);
        return (
            <ScrollView showsVerticalScrollIndicator={false} style={{ backgroundColor: T.background }} contentContainerStyle={{ paddingBottom: 90 }}>
                <Tx style={{ fontSize: z(24), fontWeight: '900', letterSpacing: -0.5, paddingHorizontal: z(16), paddingTop: z(14), color: T.text }}>Account</Tx>
                <View style={{ marginHorizontal: z(16), marginTop: z(14) }}>
                    <LinearGradient colors={[T.primaryLight, T.primaryDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: z(24), padding: z(18), overflow: 'hidden' }}>
                        <View style={{ position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)', top: z(-50), right: z(-30), width: z(160), height: z(160) }} />
                        <View style={{ position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)', bottom: z(-60), left: z(40), width: z(110), height: z(110), opacity: 0.6 }} />
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <View style={{ marginRight: z(14) }}>
                                <View style={{ padding: 3, borderRadius: 40, borderWidth: 2, borderColor: 'rgba(255,255,255,0.7)' }}>
                                    <View style={{ width: z(60), height: z(60), borderRadius: z(30), backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' }}>
                                        <Tx style={{ color: T.onPrimary, fontSize: z(24), fontWeight: '800' }}>{(USER.name || 'A').slice(0, 1)}</Tx>
                                    </View>
                                </View>
                                <View style={{ position: 'absolute', right: -2, bottom: -2, width: z(22), height: z(22), borderRadius: z(11), borderWidth: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: T.surface, borderColor: T.border }}><Ionicons name="camera" size={z(12)} color={T.primary} /></View>
                            </View>
                            <View style={{ flex: 1 }}>
                                <Tx numberOfLines={1} style={{ fontSize: z(21), fontWeight: '900', letterSpacing: -0.4, color: T.onPrimary }}>{USER.name}</Tx>
                                <Tx style={{ fontSize: z(12.5), marginTop: 2, opacity: 0.88, color: T.onPrimary }}>{USER.phone}</Tx>
                            </View>
                            <Pressable onPress={() => nav.sheet('edit')} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: z(12), paddingHorizontal: z(12), paddingVertical: z(8) }}>
                                <Ionicons name="create-outline" size={z(15)} color={T.onPrimary} />
                                <Tx style={{ fontSize: z(13), fontWeight: '800', marginLeft: 4, color: T.onPrimary }}>Edit</Tx>
                            </Pressable>
                        </View>
                    </LinearGradient>
                </View>

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginHorizontal: z(16), marginTop: z(16) }}>
                    {tile('receipt-outline', 'Orders', 'Track and reorder', () => nav.tab('orders'))}
                    {tile('location-outline', 'Addresses', 'Where we deliver', () => nav.sheet('address'))}
                    {favOn ? tile('heart-outline', 'Favourites', 'Dishes you love', go('favourites')) : tile('pricetags-outline', 'Offers', 'Coupons for you', go('offers'))}
                    {tile('notifications-outline', 'Notifications', '2 unread', go('notifications'), '2')}
                    {referOn ? tile('gift-outline', 'Refer a friend', 'Share your code', go('refer')) : null}
                </View>

                {servicesOn || bookingOn || bulkOn ? (
                    <Grp title="SERVICES">
                        {bookingOn ? <Item icon="calendar-outline" label="Reserve a table" sub="Pick a day, a time and your group" go={go('booktable')} /> : null}
                        {bookingOn ? <Item icon="calendar-number-outline" label="My reservations" sub="Your tables and the code to show" go={go('mybookings')} last={!servicesOn && !bulkOn} /> : null}
                        {bulkOn ? <Item icon="cube-outline" label="Bulk order" sub="Pick dishes and quantities for an office, a function or a party. The shop sends you a quote." go={go('bulkorder')} /> : null}
                        {bulkOn ? <Item icon="receipt-outline" label="My bulk orders" sub="Your requests, quotes and invoices" go={go('mybulk')} last={!servicesOn} /> : null}
                        {servicesOn ? <Item icon="briefcase-outline" label="Services" sub="Tiffin, party booking and more" go={go('services')} /> : null}
                        {servicesOn ? <Item icon="chatbubbles-outline" label="My inquiries" sub="Replies from the shop" go={go('myinquiries')} last /> : null}
                    </Grp>
                ) : null}

                {pointsOn ? (
                    <Grp title="REWARDS">
                        <Item icon="gift-outline" label="My points" sub="Earn points and get money off" go={go('points')} last />
                    </Grp>
                ) : null}

                <Grp title="PREFERENCES">
                    <Item icon="language-outline" label="Language" sub="English" />
                    <View style={{ paddingHorizontal: z(14), paddingVertical: z(14), borderBottomWidth: HAIR, borderBottomColor: T.border }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <View style={{ width: z(36), height: z(36), borderRadius: z(18), alignItems: 'center', justifyContent: 'center', marginRight: z(12), backgroundColor: alpha(T.primary, 0.12) }}><Ionicons name="contrast-outline" size={z(18)} color={T.primary} /></View>
                            <View style={{ flex: 1 }}>
                                <Tx style={{ fontSize: z(14), fontWeight: '700', color: T.text }}>Appearance</Tx>
                                <Tx style={{ fontSize: z(11), marginTop: 2, color: T.muted }}>Follows your phone's dark mode</Tx>
                            </View>
                        </View>
                        <View style={{ flexDirection: 'row', height: z(40), borderRadius: z(12), borderWidth: 1, padding: 3, marginTop: z(12), borderColor: T.border }}>
                            {[['System', 'phone-portrait-outline'], ['Light', 'sunny-outline'], ['Dark', 'moon-outline']].map(([l, ic], i) => (
                                <View key={l} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: z(9), backgroundColor: i === 0 ? T.primary : 'transparent' }}>
                                    <Ionicons name={ic} size={z(14)} color={i === 0 ? T.onPrimary : T.muted} />
                                    <Tx style={{ fontSize: z(12.5), fontWeight: '800', marginLeft: 5, color: i === 0 ? T.onPrimary : T.muted }}>{l}</Tx>
                                </View>
                            ))}
                        </View>
                    </View>
                    <Item icon="megaphone-outline" label="Offers and promotions" sub="Order updates always reach you, even when this is off" last right={<Toggle on />} />
                </Grp>

                <Grp title="HELP">
                    <Item icon="call-outline" label={'Contact ' + C.name} sub="Call +91 98765 43210" last />
                </Grp>

                <Grp title="MANAGE">
                    <Item icon="information-circle-outline" label="About Us" />
                    <Item icon="log-out-outline" label="Log out" go={() => nav.reset(['login'])} />
                    <Item icon="trash-outline" label="Delete account" danger last />
                </Grp>

                <Tx style={{ textAlign: 'center', fontSize: z(11), marginTop: z(26), color: T.muted }}>{C.name} · v1.0</Tx>
            </ScrollView>
        );
    }

    return { AccountPage, BookTablePage, MyBookingsPage, ScanTablePage, TableBillPage, ServicesPage, InquiryPage, MyInquiriesPage, InquiryDetailPage, BulkOrderPage, BulkCartPage, BulkOrderDetailPage, MyBulkPage, PointsPage, ReferPage, FormPage, PageBody, Header, Empty, Chip, Choices, SectionTitle, Card, Group, Label, TextBox, Button, Pill, FakeQr, z };
}
