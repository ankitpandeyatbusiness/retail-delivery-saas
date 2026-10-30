// The menu screens' building blocks: form fields, the picture box, choice groups, quick sizes, category hours,
// the "sold out for how long" sheet, and the item row. All of it wears the shop's brand through useBrand().
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, Switch, TextInput, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand, alpha } from '../common/kit';
import { PageHeader, Card, Pill, Chips, Button, Field, Sheet, Row, money } from './ui';
import { showToast, useSlideTick, seedOf } from '../customers/shop';
import { pickImage, pickImages, uploadImage } from '../../utils/owners/upload';
import { amountLabel, stockUnit, itemState, MAX_GROUPS, MAX_OPTIONS, DAYS, maskTime } from '../../utils/owners/menuRules';
import { clockTime } from '../../utils/owners/orderFlow';
import { LineShimmer } from './shimmer';
import { tr } from '../../i18n';
import KeyboardScroll, { useKeyboardLift } from '../common/KeyboardScroll';

/* ------------------------------ small things ------------------------------ */
// the small coloured square for veg / non-veg, as on food apps
export function VegMark({ isVeg, size = 14 }) {
    const c = isVeg ? '#16A34A' : '#DC2626';
    return (
        <View style={{ width: size, height: size, borderWidth: 1.5, borderColor: c, borderRadius: 3, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: size * 0.5, height: size * 0.5, borderRadius: size, backgroundColor: c }} />
        </View>
    );
}

export function Toggle({ value, onValueChange, disabled }) {
    const { primary, border } = useBrand();
    return (
        <Switch
            value={!!value}
            onValueChange={onValueChange}
            disabled={disabled}
            trackColor={{ false: border, true: alpha(primary, 0.55) }}
            thumbColor={value ? primary : '#F4F4F4'}
        />
    );
}

// a switch with a title and a note, as a row in a form card
export function ToggleRow({ title, subtitle, value, onValueChange, last, disabled }) {
    const { text, muted, border } = useBrand();
    return (
        <View style={[styles.toggleRow, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border }]}>
            <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={{ color: text, fontWeight: '800', fontSize: 15 }}>{title}</Text>
                {subtitle ? <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{subtitle}</Text> : null}
            </View>
            <Toggle value={value} onValueChange={onValueChange} disabled={disabled} />
        </View>
    );
}

export function Label({ children, hint }) {
    const { text, muted } = useBrand();
    return (
        <View style={{ marginBottom: 6 }}>
            <Text style={{ color: text, fontWeight: '800', fontSize: 13 }}>{children}</Text>
            {hint ? <Text style={{ color: muted, fontSize: 12, marginTop: 1 }}>{hint}</Text> : null}
        </View>
    );
}

export function Hint({ children, tone }) {
    const { muted, error } = useBrand();
    return <Text style={{ color: tone === 'warn' ? error : muted, fontSize: 12, marginTop: 6, marginBottom: 2 }}>{children}</Text>;
}

// a label above a field, an error or a hint below it
export function FormField({ label, hint, error, children, last }) {
    return (
        <View style={{ marginBottom: last ? 0 : 16 }}>
            {label ? <Label>{label}</Label> : null}
            {children}
            {error ? <Hint tone="warn">{error}</Hint> : hint ? <Hint>{hint}</Hint> : null}
        </View>
    );
}

export function TextBox({ label, hint, error, last, ...rest }) {
    return <FormField label={label} hint={hint} error={error} last={last}><Field {...rest} /></FormField>;
}

// A number the owner types. Keeps what is typed ("1." stays "1.") and reports a number, or undefined when empty.
export function NumberBox({ label, hint, error, value, onChange, integer, prefix, suffix, placeholder, last, style }) {
    const { text, muted, border, surface, error: bad } = useBrand();
    const [typed, setTyped] = useState(value === undefined || value === null ? '' : String(value));
    useEffect(() => {
        const now = typed === '' ? undefined : Number(typed);
        if (now !== value && !(Number.isNaN(now) && value === undefined)) setTyped(value === undefined || value === null ? '' : String(value));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);
    const change = (raw) => {
        let x = raw.replace(integer ? /[^\d]/g : /[^\d.]/g, '');
        if (!integer) x = x.replace(/^(\d*\.\d*).*$/, '$1');
        setTyped(x);
        onChange(x === '' || x === '.' ? undefined : Number(x));
    };
    return (
        <View style={[{ marginBottom: last ? 0 : 16 }, style]}>
            {label ? <Label>{label}</Label> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: error ? bad : border, borderRadius: 12, backgroundColor: surface, paddingHorizontal: 14, minHeight: 46 }}>
                {prefix ? <Text style={{ color: muted, fontWeight: '800', marginRight: 6 }}>{prefix}</Text> : null}
                <TextInput
                    value={typed}
                    onChangeText={change}
                    keyboardType={integer ? 'number-pad' : 'decimal-pad'}
                    placeholder={placeholder}
                    placeholderTextColor={muted}
                    maxLength={10}
                    style={{ flex: 1, color: text, fontSize: 15, paddingVertical: 10 }}
                />
                {suffix ? <Text style={{ color: muted, fontWeight: '800', marginLeft: 6 }}>{suffix}</Text> : null}
            </View>
            {error ? <Hint tone="warn">{error}</Hint> : hint ? <Hint>{hint}</Hint> : null}
        </View>
    );
}

// pick one of a few: a label and chips. options: [[value, label], ...]
export function ChoiceBox({ label, hint, error, options, value, onChange, last }) {
    return (
        <View style={{ marginBottom: last ? 0 : 12 }}>
            {label ? <Label hint={hint}>{label}</Label> : null}
            <Chips options={options} value={value} onChange={onChange} style={{ marginTop: 2 }} />
            {error ? <Hint tone="warn">{error}</Hint> : null}
        </View>
    );
}

// a titled group of fields on one card
export function Group({ title, hint, children, flush }) {
    const { text, muted } = useBrand();
    return (
        <View style={{ marginBottom: 4 }}>
            <Text style={{ color: text, fontSize: 16, fontWeight: '900', paddingHorizontal: 16, marginTop: 6, marginBottom: hint ? 2 : 10 }}>{title}</Text>
            {hint ? <Text style={{ color: muted, fontSize: 12, paddingHorizontal: 16, marginBottom: 10 }}>{hint}</Text> : null}
            <Card style={flush ? { paddingVertical: 2 } : undefined}>{children}</Card>
        </View>
    );
}

// The frame of a form page: back arrow + title, the fields scrolling, and the main button pinned to the bottom.
export function FormPage({ title, children, footer, right }) {
    const { background, border } = useBrand();
    const insets = useSafeAreaInsets();
    const [boxRef, lift] = useKeyboardLift();   // Android: the page, with its bar, is lifted above the keyboard
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={title} right={right} />
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
                <View ref={boxRef} collapsable={false} style={{ flex: 1, paddingBottom: lift }}>
                <KeyboardScroll contentContainerStyle={{ paddingTop: 6, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                    {children}
                </KeyboardScroll>
                {footer ? (
                    <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 10), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: border, backgroundColor: background }}>
                        {footer}
                    </View>
                ) : null}
                </View>
            </KeyboardAvoidingView>
        </View>
    );
}

/* ------------------------------ picture ------------------------------ */
// A picture for a record. Shows the current one, uploads a new one at once, and hands back its url.
//   kind: product | category | collection | banner      refId: needed for 'product' (item id, or a temporary one)
export function ImageField({ label = 'Picture', value, onChange, kind, refId, square, last }) {
    const { surface, border, muted, primary, error, text } = useBrand();
    const [busy, setBusy] = useState(false);
    const pick = async () => {
        if (busy) return;
        setBusy(true);
        try {
            const img = await pickImage({ square });
            if (!img) return;
            const m = await uploadImage({ kind, refId, ...img });
            onChange(m.url);
        } catch (e) { showToast(e.safe ? e.message : tr('Could not upload that picture')); } finally { setBusy(false); }
    };
    return (
        <View style={{ marginBottom: last ? 0 : 16 }}>
            <Label>{label}</Label>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Pressable onPress={pick} style={{ width: 88, height: 88, borderRadius: 14, backgroundColor: surface, borderWidth: 1, borderColor: border, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    {value ? <Image source={{ uri: value }} style={{ width: 88, height: 88 }} contentFit="cover" /> : <Ionicons name="image-outline" size={30} color={muted} />}
                    {busy ? <View style={StyleSheet.absoluteFill}><LineShimmer width={88} height={88} /></View> : null}
                </Pressable>
                <View style={{ flex: 1, marginLeft: 14 }}>
                    <Pressable onPress={pick} disabled={busy} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name="camera" size={18} color={primary} />
                        <Text style={{ color: primary, fontWeight: '800', marginLeft: 6 }}>{busy ? tr('Uploading…') : value ? tr('Change picture') : tr('Add picture')}</Text>
                    </Pressable>
                    {value ? (
                        <Pressable onPress={() => onChange('')} hitSlop={8} style={{ marginTop: 10 }}>
                            <Text style={{ color: error, fontWeight: '700', fontSize: 13 }}>{tr('Remove picture')}</Text>
                        </Pressable>
                    ) : <Text style={{ color: muted, fontSize: 12, marginTop: 4 }}>{tr('JPG, PNG or WebP, up to 5 MB')}</Text>}
                </View>
            </View>
        </View>
    );
}

// Up to 4 more pictures of a dish. The customer app slides through the main picture and these, by itself.
// Each one can be moved left or right, or made the main picture (the star). onMain(url) swaps it with the current main one.
// Several pictures can be picked at once. Each one being sent shows on its own thumbnail with a round loader and a cross to stop it (like WhatsApp).
export function MorePictures({ value = [], onChange, onMain, refId, disabled, kind = 'product', max = 4, label }) {
    const { surface, border, muted, primary, error } = useBrand();
    const [sending, setSending] = useState([]);   // [{ key, uri }] still being sent
    const latest = useRef(value);                 // pictures that finish together must not overwrite each other
    latest.current = value;
    const stopped = useRef(new Set());
    const add = async () => {
        const room = max - value.length - sending.length;
        if (disabled || room <= 0) return;
        const picked = await pickImages({ limit: room });
        const batch = picked.map((img, n) => ({ ...img, key: `${Date.now()}-${n}` }));
        if (!batch.length) return;
        setSending((s) => [...s, ...batch]);
        batch.forEach(async (img) => {
            try {
                const m = await uploadImage({ kind, refId, uri: img.uri, mimeType: img.mimeType });
                if (!stopped.current.has(img.key)) { latest.current = [...latest.current, m.url]; onChange(latest.current); }
            } catch (e) { if (!stopped.current.has(img.key)) showToast(e.safe ? e.message : tr('Could not upload that picture')); }
            finally { stopped.current.delete(img.key); setSending((s) => s.filter((x) => x.key !== img.key)); }
        });
    };
    const stop = (key) => { stopped.current.add(key); setSending((s) => s.filter((x) => x.key !== key)); };
    const move = (i, d) => {
        const j = i + d;
        if (j < 0 || j >= value.length) return;
        const next = [...value];
        [next[i], next[j]] = [next[j], next[i]];
        onChange(next);
    };
    const chip = (name, onPress, off, key) => (
        <Pressable key={key} onPress={onPress} disabled={off} hitSlop={4} style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)', opacity: off ? 0.3 : 1 }}>
            <Ionicons name={name} size={13} color="#FFFFFF" />
        </Pressable>
    );
    return (
        <View style={{ marginTop: 16 }}>
            <Label>{label || tr('More pictures (optional)')}</Label>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {value.map((u, i) => (
                    <View key={u} style={{ marginRight: 12, marginBottom: 14 }}>
                        <Image source={{ uri: u }} style={{ width: 84, height: 84, borderRadius: 12 }} contentFit="cover" />
                        <Pressable onPress={() => onChange(value.filter((x) => x !== u))} hitSlop={8} style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: error, alignItems: 'center', justifyContent: 'center' }}>
                            <Ionicons name="close" size={14} color="#FFFFFF" />
                        </Pressable>
                        {onMain ? <View style={{ position: 'absolute', top: 4, left: 4 }}>{chip('star', () => onMain(u), false, 's')}</View> : null}
                        <View style={{ position: 'absolute', bottom: 4, left: 4, right: 4, flexDirection: 'row', justifyContent: 'space-between' }}>
                            {chip('chevron-back', () => move(i, -1), i === 0, 'l')}
                            {chip('chevron-forward', () => move(i, 1), i === value.length - 1, 'r')}
                        </View>
                    </View>
                ))}
                {sending.map((x) => (
                    <View key={x.key} style={{ marginRight: 12, marginBottom: 14, width: 84, height: 84, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                        <Image source={{ uri: x.uri }} style={{ position: 'absolute', width: 84, height: 84 }} contentFit="cover" />
                        <View style={{ position: 'absolute', width: 84, height: 84, backgroundColor: 'rgba(0,0,0,0.45)' }} />
                        <ActivityIndicator size="large" color="#FFFFFF" />
                        <Pressable onPress={() => stop(x.key)} hitSlop={10} style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center', width: 36, height: 36 }}>
                            <Ionicons name="close" size={16} color="#FFFFFF" />
                        </Pressable>
                    </View>
                ))}
                {value.length + sending.length < max ? (
                    <Pressable onPress={add} disabled={disabled} style={{ width: 84, height: 84, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: border, backgroundColor: surface, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.5 : 1 }}>
                        <Ionicons name="add" size={26} color={primary} />
                    </Pressable>
                ) : null}
            </View>
            <Text style={{ color: muted, fontSize: 12 }}>{disabled ? tr('Add the main picture first.') : tr('They slide in this order. Use the arrows to move one, the star to make it the main picture.')}</Text>
        </View>
    );
}

// "20261101" -> "2026-11-01" while typing. Empty = no date.
export function DateBox({ label, hint, value, onChange, last }) {
    const { text, muted, border, surface, error } = useBrand();
    const bad = value && !/^\d{4}-\d{2}-\d{2}$/.test(value);
    const mask = (v) => {
        const d = v.replace(/[^\d]/g, '').slice(0, 8);
        if (d.length > 6) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
        if (d.length > 4) return `${d.slice(0, 4)}-${d.slice(4)}`;
        return d;
    };
    return (
        <View style={{ marginBottom: last ? 0 : 16 }}>
            {label ? <Label hint={hint}>{label}</Label> : null}
            <TextInput
                value={value || ''}
                onChangeText={(v) => onChange(mask(v))}
                placeholder={tr('YYYY-MM-DD')}
                placeholderTextColor={muted}
                keyboardType="number-pad"
                maxLength={10}
                style={{ minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: bad ? error : border, backgroundColor: surface, color: text, paddingHorizontal: 14, fontSize: 15, fontWeight: '600' }}
            />
            {bad ? <Hint tone="warn">{tr('Type the date as 2026-11-01')}</Hint> : null}
        </View>
    );
}

/* ------------------------------ choices on an item (sizes, add-ons) ------------------------------ */
// basePrice / onBasePrice: the item's selling price. A group with "each option has its own full price" keeps the cheapest option
// as the item's price and stores the others as the difference, so the totals the server works out stay exactly the real prices.
export function OptionGroupsEditor({ value = [], onChange, basePrice = 0, onBasePrice }) {
    const { text, muted, border, surface, error, primary } = useBrand();
    const setGroup = (gi, patch) => onChange(value.map((g, i) => (i === gi ? { ...g, ...patch } : g)));
    const setOption = (gi, oi, patch) => setGroup(gi, { options: value[gi].options.map((o, i) => (i === oi ? { ...o, ...patch } : o)) });
    return (
        <View>
            {value.map((g, gi) => (
                <View key={gi} style={{ borderWidth: 1, borderColor: border, borderRadius: 16, padding: 12, marginBottom: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <Text style={{ color: text, fontWeight: '900' }}>{tr('Choice {v1}', { v1: gi + 1 })}</Text>
                        <Pressable onPress={() => onChange(value.filter((_, i) => i !== gi))} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Ionicons name="trash-outline" size={17} color={error} />
                            <Text style={{ color: error, fontWeight: '700', marginLeft: 4 }}>{tr('Remove')}</Text>
                        </Pressable>
                    </View>
                    <TextBox label={tr('Question the customer sees')} value={g.name} maxLength={40} placeholder={tr('e.g. Choose size')} onChangeText={(x) => setGroup(gi, { name: x })} />
                    <View style={{ flexDirection: 'row' }}>
                        <NumberBox style={{ flex: 1, marginRight: 10 }} label={tr('Must pick at least')} integer value={g.min} onChange={(x) => setGroup(gi, { min: x ?? 0 })} hint={tr('0 = optional')} />
                        <NumberBox style={{ flex: 1 }} label={tr('Can pick up to')} integer value={g.max} onChange={(x) => setGroup(gi, { max: x ?? 1 })} hint={tr('1 = pick one')} />
                    </View>
                    <ToggleRow
                        title={tr('Each option has its own full price')}
                        subtitle={tr('For Half and Full, or Small and Big: type the real price of each, such as Half ₹150 and Full ₹280. The customer sees "From ₹150".')}
                        value={!!g.absolute}
                        onValueChange={(x) => {
                            if (x && value.some((o, i) => i !== gi && o.absolute)) { showToast(tr('Only one choice on an item can have its own full prices')); return; }
                            setGroup(gi, x ? { absolute: true, min: 1, max: 1 } : { absolute: false });
                        }}
                        last
                    />
                    {g.options.map((o, oi) => (
                        <View key={oi} style={{ backgroundColor: alpha(muted, 0.08), borderRadius: 12, padding: 10, marginBottom: 8 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
                                <View style={{ flex: 1.6, marginRight: 8 }}>
                                    <TextBox label={oi === 0 ? tr('Option') : undefined} value={o.name} maxLength={40} placeholder={tr('e.g. Large')} last onChangeText={(x) => setOption(gi, oi, { name: x })} />
                                </View>
                                <NumberBox
                                    style={{ flex: 1 }}
                                    label={oi === 0 ? (g.absolute ? tr('Price ₹') : tr('Extra ₹')) : undefined}
                                    value={g.absolute ? (basePrice || 0) + (o.price || 0) : o.price}
                                    last
                                    onChange={(x) => {
                                        if (!g.absolute) { setOption(gi, oi, { price: x ?? 0 }); return; }
                                        // the real prices of all options; the cheapest one becomes the item's price, the rest are the difference
                                        const abs = g.options.map((q, k) => (k === oi ? (x ?? 0) : (basePrice || 0) + (q.price || 0)));
                                        const paid = abs.filter((a) => a > 0);
                                        const nb = paid.length ? Math.min(...paid) : 0;
                                        if (onBasePrice) onBasePrice(nb);
                                        setGroup(gi, { options: g.options.map((q, k) => ({ ...q, price: Math.max(0, abs[k] - nb) })) });
                                    }}
                                />
                                <Pressable onPress={() => setGroup(gi, { options: g.options.filter((_, i) => i !== oi) })} hitSlop={8} style={{ height: 46, justifyContent: 'center', paddingLeft: 8 }}>
                                    <Ionicons name="close-circle" size={22} color={muted} />
                                </Pressable>
                            </View>
                            <ToggleRow title={tr('Selected by default')} value={!!o.isDefault} onValueChange={(x) => setOption(gi, oi, { isDefault: x })} />
                            <ToggleRow title={tr('Available')} value={o.isAvailable !== false} onValueChange={(x) => setOption(gi, oi, { isAvailable: x })} last />
                        </View>
                    ))}
                    {g.options.length < MAX_OPTIONS ? (
                        <Button label={tr('Add an option')} kind="ghost" icon="add" onPress={() => setGroup(gi, { options: [...g.options, { name: '', price: 0, isDefault: false, isAvailable: true }] })} />
                    ) : null}
                </View>
            ))}
            {value.length < MAX_GROUPS ? (
                <Button label={tr('Add a choice')} kind="ghost" icon="add-circle-outline" onPress={() => onChange([...value, { name: '', min: 0, max: 1, options: [{ name: '', price: 0, isDefault: false, isAvailable: true }] }])} />
            ) : null}
        </View>
    );
}

/* ------------------------------ amounts for weight and volume items ------------------------------ */
// value: { options:[g|ml], min, allowManual }
export function MeasureEditor({ sellBy, value, presets, onChange, error }) {
    const { primary, onPrimary, text, border, muted } = useBrand();
    const [small, big] = sellBy === 'volume' ? ['ml', 'L'] : ['g', 'kg'];
    const [typed, setTyped] = useState(undefined);
    const [unit, setUnit] = useState(small);

    // a new item starts with the platform's quick sizes already chosen
    useEffect(() => {
        if (!value.options.length) onChange({ ...value, options: presets.filter((p) => p <= 1000).slice(0, 3) });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sellBy]);
    useEffect(() => { setUnit(small); }, [small]);

    const options = [...new Set([...presets, ...value.options])].sort((a, b) => a - b);
    const has = (q) => value.options.includes(q);
    const toggle = (q) => onChange({ ...value, options: has(q) ? value.options.filter((x) => x !== q) : [...value.options, q].sort((a, b) => a - b) });
    const addTyped = () => {
        const q = Math.round((unit === big ? 1000 : 1) * Number(typed));
        if (!(q >= 10 && q <= 50000)) { showToast(tr('Type an amount from 10 g (ml) to 50 kg (L)')); return; }
        if (!has(q)) onChange({ ...value, options: [...value.options, q].sort((a, b) => a - b) });
        setTyped(undefined);
    };
    return (
        <View>
            <Label hint={tr('Tap to switch a size on or off')}>{tr('Quick sizes')}</Label>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {options.map((q) => (
                    <Pressable key={q} onPress={() => toggle(q)} style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, marginRight: 8, marginBottom: 8, borderWidth: 1, borderColor: has(q) ? primary : border, backgroundColor: has(q) ? primary : 'transparent' }}>
                        <Text style={{ color: has(q) ? onPrimary : text, fontWeight: '800' }}>{amountLabel(sellBy, q)}</Text>
                    </Pressable>
                ))}
            </View>
            <View style={{ height: 8 }} />
            <Label>{tr('Another size')}</Label>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                <NumberBox style={{ flex: 1 }} value={typed} onChange={setTyped} placeholder={tr('e.g. 750')} last />
                <Pressable onPress={() => setUnit(unit === small ? big : small)} style={{ height: 46, minWidth: 56, marginLeft: 8, borderRadius: 12, backgroundColor: alpha(primary, 0.12), alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 }}>
                    <Text style={{ color: primary, fontWeight: '900' }}>{unit} ⇄</Text>
                </Pressable>
                <Pressable onPress={addTyped} style={{ height: 46, marginLeft: 8, borderRadius: 12, backgroundColor: primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }}>
                    <Text style={{ color: onPrimary, fontWeight: '900' }}>{tr('Add')}</Text>
                </Pressable>
            </View>
            <View style={{ height: 16 }} />
            <ToggleRow title={tr('Customer can type their own amount')} subtitle={tr('For example 650 g or 1.25 kg')} value={value.allowManual} onValueChange={(x) => onChange({ ...value, allowManual: x })} last />
            <View style={{ height: 14 }} />
            <NumberBox label={tr('Smallest amount the customer can order ({small})', { small: small })} integer value={value.min} onChange={(x) => onChange({ ...value, min: x })} placeholder="50" error={error} last />
            <Hint>{tr('The customer sees the price worked out from the price per {v1}.', { v1: sellBy === 'volume' ? 'litre' : 'kg' })}</Hint>
        </View>
    );
}

/* ------------------------------ hours of a category ------------------------------ */
// value: [{ days:[mon..], open:'HH:MM', close:'HH:MM' }]   Empty = shown all day.
export function TimingEditor({ value = [], onChange }) {
    const { text, error, border, primary, onPrimary } = useBrand();
    const setSlot = (i, patch) => onChange(value.map((s, n) => (n === i ? { ...s, ...patch } : s)));
    return (
        <View>
            {value.map((s, i) => (
                <View key={i} style={{ borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: border, paddingTop: i ? 12 : 0, marginBottom: 12 }}>
                    <View style={{ flexDirection: 'row' }}>
                        <View style={{ flex: 1 }}><TextBox label={tr('From')} value={s.open} placeholder={tr('HH:MM')} keyboardType="number-pad" maxLength={5} last onChangeText={(x) => setSlot(i, { open: maskTime(x) })} /></View>
                        <View style={{ width: 10 }} />
                        <View style={{ flex: 1 }}><TextBox label={tr('To')} value={s.close} placeholder={tr('HH:MM')} keyboardType="number-pad" maxLength={5} last onChangeText={(x) => setSlot(i, { close: maskTime(x) })} /></View>
                    </View>
                    <View style={{ height: 12 }} />
                    <Label hint={tr('Leave all unselected for every day')}>{tr('Days')}</Label>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                        {DAYS.map(([d, l]) => {
                            const on = (s.days || []).includes(d);
                            return (
                                <Pressable key={d} onPress={() => setSlot(i, { days: on ? s.days.filter((x) => x !== d) : [...(s.days || []), d] })}
                                    style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, marginRight: 6, marginBottom: 6, borderWidth: 1, borderColor: on ? primary : border, backgroundColor: on ? primary : 'transparent' }}>
                                    <Text style={{ color: on ? onPrimary : text, fontWeight: '800', fontSize: 13 }}>{l}</Text>
                                </Pressable>
                            );
                        })}
                    </View>
                    <Pressable onPress={() => onChange(value.filter((_, n) => n !== i))} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                        <Ionicons name="trash-outline" size={17} color={error} />
                        <Text style={{ color: error, fontWeight: '700', marginLeft: 6 }}>{tr('Remove this time slot')}</Text>
                    </Pressable>
                </View>
            ))}
            {value.length < 6 ? (
                <Button label={tr('Add a time slot')} kind="ghost" icon="time-outline" onPress={() => onChange([...value, { days: [], open: '07:00', close: '11:00' }])} />
            ) : <Hint>{tr('Up to 6 time slots.')}</Hint>}
        </View>
    );
}

/* ------------------------------ sold out for how long ------------------------------ */
const SOLD_OUT = [
    ['For today', 'Comes back tomorrow morning by itself', { untilMorning: true }, 'moon-outline'],
    ['For 1 hour', 'Comes back by itself', { minutes: 60 }, 'time-outline'],
    ['For 2 hours', 'Comes back by itself', { minutes: 120 }, 'time-outline'],
    ['Until I switch it on', 'Stays off until you turn it on', {}, 'hand-left-outline'],
];

export function SoldOutSheet({ item, onClose, onPick }) {
    return (
        <Sheet visible={!!item} onClose={onClose} title={item ? tr('{name} is sold out', { name: item.name }) : ''}>
            {SOLD_OUT.map(([title, sub, body, icon], i) => (
                <Row key={title} icon={icon} title={title} subtitle={sub} last={i === SOLD_OUT.length - 1} onPress={() => onPick(item, { available: false, ...body })} />
            ))}
        </Sheet>
    );
}

/* ------------------------------ an item in the menu list ------------------------------ */
// Tap = edit. The switch is "in stock": off asks for how long. A counted item shows how many are left, with − and +.
export function ItemRow({ item, onOpen, onSwitch, onStep, onPortion, last }) {
    const { text, muted, border, primary, error, ok, surface } = useBrand();
    const state = itemState(item);
    const kg = item.sellBy === 'weight' ? '/kg' : item.sellBy === 'volume' ? '/L' : '';
    const u = stockUnit(item.sellBy);
    const counted = !!item.stock?.enabled;
    const dim = state !== 'on';
    // a dish with more pictures slides through them, like in the customer app
    const pics = [item.image, ...(Array.isArray(item.images) ? item.images : [])].filter(Boolean);
    const tick = useSlideTick(pics.length > 1);
    const pic = pics.length > 1 ? pics[(tick + seedOf(item)) % pics.length] : item.image;
    // Half / Full style portions with their own prices: a quick switch for each one
    const portions = (item.optionGroups || []).find((g) => g.absolute && (g.options || []).length > 1) || null;
    return (
        <Pressable onPress={onOpen} style={({ pressed }) => [styles.itemRow, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border }, pressed && { opacity: 0.75 }]}>
            {item.image ? (
                <Image source={{ uri: pic }} style={[styles.thumb, dim && { opacity: 0.5 }]} contentFit="cover" transition={pics.length > 1 ? 450 : 0} />
            ) : (
                <View style={[styles.thumb, { backgroundColor: alpha(muted, 0.12), alignItems: 'center', justifyContent: 'center' }]}><Ionicons name="restaurant-outline" size={22} color={muted} /></View>
            )}
            <View style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <VegMark isVeg={item.isVeg} size={12} />
                    <Text numberOfLines={1} style={{ color: dim ? muted : text, fontWeight: '800', fontSize: 15, marginLeft: 6, flexShrink: 1 }}>{item.name}</Text>
                </View>
                <Text style={{ color: muted, fontSize: 13, marginTop: 2 }}>
                    {money(item.price)}{kg}
                    {item.isBestseller ? tr('  ·  Bestseller') : ''}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                    {state === 'timed' ? <Pill label={tr('Back at {clockTime}', { clockTime: clockTime(item.unavailableUntil) })} color={error} icon="time-outline" /> : null}
                    {state === 'off' ? <Pill label={tr('Sold out')} color={error} /> : null}
                    {state === 'stock' ? <Pill label={tr('Stock finished')} color={error} /> : null}
                    {state === 'on' && counted ? <Pill label={tr('{v1} left', { v1: u.say(item.stock.qty) })} color={item.stock.qty <= (item.sellBy === 'piece' ? 5 : 1000) ? '#D97706' : ok} /> : null}
                    {counted && item.sellBy === 'piece' && onStep ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: state === 'on' ? 8 : 0 }}>
                            <Pressable onPress={() => onStep(item, -1)} hitSlop={8} style={[styles.step, { borderColor: border }]}><Ionicons name="remove" size={16} color={text} /></Pressable>
                            <Pressable onPress={() => onStep(item, 1)} hitSlop={8} style={[styles.step, { borderColor: border, marginLeft: 6 }]}><Ionicons name="add" size={16} color={text} /></Pressable>
                        </View>
                    ) : null}
                </View>
                {portions ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
                        {portions.options.map((o) => {
                            const live = o.isAvailable !== false;
                            return (
                                <Pressable key={o.id} onPress={() => onPortion && onPortion(item, portions, o, !live)} hitSlop={4}
                                    style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: live ? primary : border, backgroundColor: live ? alpha(primary, 0.1) : 'transparent', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5, marginRight: 6, marginBottom: 6 }}>
                                    <Ionicons name={live ? 'checkmark-circle' : 'close-circle'} size={14} color={live ? primary : muted} />
                                    <Text numberOfLines={1} style={{ color: live ? text : muted, fontWeight: '800', fontSize: 12, marginLeft: 4, textDecorationLine: live ? 'none' : 'line-through' }}>{o.name} · {money((item.price || 0) + (o.price || 0))}{!live && o.unavailableUntil ? `  ·  ${tr('back')} ${clockTime(o.unavailableUntil)}` : ''}</Text>
                                </Pressable>
                            );
                        })}
                    </View>
                ) : null}
            </View>
            <View style={{ alignItems: 'center', marginLeft: 8 }}>
                <Toggle value={state === 'on'} onValueChange={(on) => onSwitch(item, on)} />
                <Text style={{ color: muted, fontSize: 10, fontWeight: '700' }}>{tr('In stock')}</Text>
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    toggleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
    itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
    thumb: { width: 56, height: 56, borderRadius: 12 },
    step: { width: 28, height: 28, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
