// "Choose your table": the numbers of the shop's tables as buttons. (A table QR sets this by itself.)
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useBrand, alpha } from '../common/kit';
import { Sheet } from '../owners/ui';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { useTableBill } from '../../store/customers/useTableBill';
import { useOrderMode } from '../../store/customers/useOrderMode';
import { tableLock } from '../../utils/customers/tableLink';
import { showToast } from './shop';
import { SheetPortal } from '../common/SheetPortal';
import { useIsDesktopWeb } from '../../utils/common/layout';
import { tr } from '../../i18n';

export default function TableSheet({ visible, onClose }) {
    const { primary, onPrimary, text, border, muted } = useBrand();
    const count = useHomeStore((s) => s.full?.orders?.dineIn?.tableCount) || 10;
    const qrOnly = useHomeStore((s) => s.full?.orders?.dineIn?.qrRequired) === true;   // the shop takes table orders only from the table's QR
    const table = useOrderMode((s) => s.table);
    const setTable = useOrderMode((s) => s.setTable);
    const nav = useNavigation();
    const desk = useIsDesktopWeb();   // a browser at least 1024 px wide: a centred card instead of the phone's bottom sheet (false in the phone app)
    if (desk) return <DeskTableModal visible={visible} onClose={onClose} nav={nav} />;
    return (
        <Sheet visible={visible} onClose={onClose} title={tr('Choose your table')}>
            <Pressable onPress={() => { const b = useTableBill.getState().bill; if (b?.open) { showToast(tr(tableLock('') || '')); return; } onClose(); nav.navigate('ScanTable'); }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 14, backgroundColor: primary, marginBottom: 14 }}>
                <Ionicons name="qr-code-outline" size={18} color={onPrimary} />
                <Text style={{ color: onPrimary, fontWeight: '900', marginLeft: 8 }}>{tr('Scan the QR on your table')}</Text>
            </Pressable>
            <Text style={{ color: muted, fontSize: 13, marginBottom: 12 }}>{qrOnly ? tr('This shop takes table orders only from the QR on your table.') : tr('The number is on the sticker on your table.')}</Text>
            {qrOnly ? null : <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginRight: -8 }}>
                {Array.from({ length: count }, (_, i) => String(i + 1)).map((n) => {
                    const on = table === n;
                    return (
                        <Pressable
                            key={n} onPress={() => { const lock = tableLock(n); if (lock) { showToast(tr(lock)); return; } setTable(n); onClose(); }}
                            style={{ width: 58, height: 52, borderRadius: 14, marginRight: 8, marginBottom: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: on ? primary : border, backgroundColor: on ? primary : alpha(primary, 0.06) }}
                        >
                            <Text style={{ color: on ? onPrimary : text, fontWeight: '900', fontSize: 17 }}>{n}</Text>
                        </Pressable>
                    );
                })}
            </View>}
        </Sheet>
    );
}

// ---------------- the desktop website: a centred card ----------------
// Drawn through the sheet layer (like the address picker) so a toast ("this table is taken...") still shows above it. `nav` comes in from
// TableSheet, because the layer is outside the screens and could not find the navigator itself.
function DeskTableModal({ visible, onClose, nav }) {
    const { primary, onPrimary, text, border, muted, surface, background } = useBrand();
    const count = useHomeStore((s) => s.full?.orders?.dineIn?.tableCount) || 10;
    const qrOnly = useHomeStore((s) => s.full?.orders?.dineIn?.qrRequired) === true;
    const table = useOrderMode((s) => s.table);
    const setTable = useOrderMode((s) => s.setTable);
    const [mounted, setMounted] = useState(visible);
    const [on, setOn] = useState(false);   // false = parked just outside; the CSS transition does the fade and slide

    useEffect(() => {
        if (visible) {
            setMounted(true);
            const id = requestAnimationFrame(() => requestAnimationFrame(() => setOn(true)));
            return () => cancelAnimationFrame(id);
        }
        setOn(false);
        const t = setTimeout(() => setMounted(false), 260);
        return () => clearTimeout(t);
    }, [visible]);
    useEffect(() => {
        if (!visible || typeof window === 'undefined') return undefined;
        const key = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', key);
        return () => window.removeEventListener('keydown', key);
    }, [visible, onClose]);

    if (!mounted) return null;
    const ease = 'cubic-bezier(0.22, 0.8, 0.2, 1)';
    const scan = () => {
        const b = useTableBill.getState().bill;
        if (b?.open) { showToast(tr(tableLock('') || '')); return; }
        onClose();
        nav.navigate('ScanTable');
    };
    const pick = (n) => {
        const lock = tableLock(n);
        if (lock) { showToast(tr(lock)); return; }
        setTable(n);
        onClose();
    };

    return (
        <SheetPortal>
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: 24 }} pointerEvents={on ? 'auto' : 'none'}>
                <Pressable
                    onPress={onClose}
                    style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)', opacity: on ? 1 : 0, transitionProperty: 'opacity', transitionDuration: '260ms' }}
                />
                <View
                    style={{
                        width: '100%', maxWidth: 560, borderRadius: 24, borderWidth: 1, borderColor: border, backgroundColor: surface, padding: 28,
                        boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
                        opacity: on ? 1 : 0, transform: [{ scale: on ? 1 : 0.95 }, { translateY: on ? 0 : 14 }],
                        transitionProperty: 'opacity, transform', transitionDuration: '260ms', transitionTimingFunction: ease,
                    }}
                >
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 22 }}>
                        <View style={{ flex: 1 }}>
                            <Text style={{ color: text, fontSize: 26, fontWeight: '900', letterSpacing: -0.4 }}>{tr('Choose your table')}</Text>
                            <Text style={{ color: muted, fontSize: 14, marginTop: 4 }}>{qrOnly ? tr('This shop takes table orders only from the QR on your table.') : tr('The number is on the sticker on your table.')}</Text>
                        </View>
                        <Pressable
                            onPress={onClose}
                            hitSlop={8}
                            accessibilityLabel={tr('Close')}
                            style={({ hovered }) => ({ width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: hovered ? muted : border, backgroundColor: hovered ? border : background, alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transitionProperty: 'background-color, border-color', transitionDuration: '160ms' })}
                        >
                            <Ionicons name="close" size={19} color={text} />
                        </Pressable>
                    </View>

                    {table ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, backgroundColor: `${primary}1A`, borderWidth: 1, borderColor: `${primary}40` }}>
                            <Ionicons name="restaurant" size={17} color={primary} />
                            <Text style={{ color: text, fontSize: 14, fontWeight: '800', marginLeft: 10 }}>{tr('Table {n}', { n: table })}</Text>
                            <Text style={{ color: muted, fontSize: 13, marginLeft: 8 }}>{tr('is your table now')}</Text>
                        </View>
                    ) : null}

                    <Pressable
                        onPress={scan}
                        accessibilityRole="button"
                        style={({ hovered }) => ({
                            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 56, borderRadius: 14, backgroundColor: primary, cursor: 'pointer',
                            filter: hovered ? 'brightness(1.12)' : 'brightness(1)', boxShadow: hovered ? `0 12px 30px ${primary}55` : '0 0 0 rgba(0,0,0,0)',
                            transitionProperty: 'filter, box-shadow', transitionDuration: '180ms',
                        })}
                    >
                        <Ionicons name="qr-code-outline" size={20} color={onPrimary} />
                        <Text style={{ color: onPrimary, fontWeight: '900', fontSize: 15.5, marginLeft: 10 }}>{tr('Scan the QR on your table')}</Text>
                    </Pressable>

                    {qrOnly ? null : (
                        <>
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 22 }}>
                                <View style={{ flex: 1, height: 1, backgroundColor: border }} />
                                <Text style={{ color: muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, marginHorizontal: 14 }}>{tr('OR PICK THE NUMBER')}</Text>
                                <View style={{ flex: 1, height: 1, backgroundColor: border }} />
                            </View>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                                {Array.from({ length: count }, (_, i) => String(i + 1)).map((n) => {
                                    const sel = table === n;
                                    return (
                                        <Pressable
                                            key={n}
                                            onPress={() => pick(n)}
                                            accessibilityRole="button"
                                            accessibilityState={{ selected: sel }}
                                            style={({ hovered }) => ({
                                                width: 68, height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, cursor: 'pointer',
                                                borderColor: sel ? primary : hovered ? primary : border,
                                                backgroundColor: sel ? primary : hovered ? `${primary}1F` : background,
                                                transform: [{ scale: hovered && !sel ? 1.05 : 1 }],
                                                transitionProperty: 'background-color, border-color, transform', transitionDuration: '160ms',
                                            })}
                                        >
                                            <Text style={{ color: sel ? onPrimary : text, fontWeight: '900', fontSize: 18 }}>{n}</Text>
                                        </Pressable>
                                    );
                                })}
                            </View>
                        </>
                    )}
                </View>
            </View>
        </SheetPortal>
    );
}
