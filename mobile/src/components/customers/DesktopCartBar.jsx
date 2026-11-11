// The cart card in the bottom-right corner of the DESKTOP website. It slides up when the first dish is added, STAYS for as long as the cart has
// something in it (the customer can open the cart from it at any time), and slides away when the cart is empty. When a dish is added it says
// "Added to cart" with that dish for a moment and gives a small bump, then settles back to "Your cart" with the count and the total.
// It is hidden on the pages that are the cart or the payment themselves. Drawn only on the desktop website (DesktopFrame); the phone never
// mounts it, and `cartHooks.onAdd` (the signal it listens to) is empty everywhere else.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../common/kit';
import { useCartStore, cartHooks } from '../../store/customers/shopStores';
import { tr } from '../../i18n';

const OUT_MS = 340;
const FLASH_MS = 2600;
const HIDE_ON = ['Cart', 'PaymentMethods', 'CardDetails', 'OrderPlaced'];   // these ARE the cart / the payment
const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// The dishes in the cart as a little stack of photos. One dish: a big photo. Every dish added makes ALL the photos a little smaller and slides them
// closer, so up to three fit nicely in the same small bar (54 > 44 > 38 px, overlapping like a row of avatars). More than three dishes:
// the newest three and a "+N" circle. Sizes and places are CSS-transitioned, so the photos glide to their new size; a new photo grows in.
const SIZES = [54, 44, 38];   // up to three photos, then a "+N" circle
const BOX = 54;   // the stack is always this tall, so the card never changes height
function Thumb({ line, i, size, step, brand, last }) {
    const [inn, setInn] = useState(false);
    useEffect(() => { const id = requestAnimationFrame(() => setInn(true)); return () => cancelAnimationFrame(id); }, []);
    const ring = i > 0;   // overlapped photos get a ring in the card's colour, so they read as separate
    return (
        <View
            style={{
                position: 'absolute', left: i * step, top: (BOX - size) / 2, width: size, height: size, borderRadius: Math.round(size * 0.24), overflow: 'hidden',
                backgroundColor: brand.soft || brand.background, zIndex: i + 1, alignItems: 'center', justifyContent: 'center',
                borderWidth: ring ? 2 : 0, borderColor: brand.surface,
                opacity: inn ? 1 : 0, transform: [{ scale: inn ? 1 : 0.6 }],
                transitionProperty: 'left, top, width, height, border-radius, opacity, transform', transitionDuration: '340ms', transitionTimingFunction: 'cubic-bezier(0.22, 0.8, 0.2, 1)',
            }}
        >
            {line.image ? <Image source={{ uri: line.image }} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : <Ionicons name="restaurant-outline" size={Math.round(size * 0.42)} color={brand.muted} />}
        </View>
    );
}

function Thumbs({ lines, brand }) {
    // one photo per dish (the same dish with different choices counts once), in the order they were added
    const dishes = [];
    const seen = new Set();
    for (let k = lines.length - 1; k >= 0; k -= 1) { const id = String(lines[k].productId); if (!seen.has(id)) { seen.add(id); dishes.unshift(lines[k]); } }
    const shown = dishes.slice(-3);
    const extra = dishes.length - shown.length;
    const n = Math.max(1, shown.length);
    const size = SIZES[n - 1];
    const overlap = n > 1 ? Math.round(size * 0.34) : 0;
    const step = size - overlap;
    const slots = shown.length + (extra > 0 ? 1 : 0);
    const width = size + Math.max(0, slots - 1) * step;
    return (
        <View style={{ width, height: BOX, transitionProperty: 'width', transitionDuration: '340ms', transitionTimingFunction: 'cubic-bezier(0.22, 0.8, 0.2, 1)' }}>
            {shown.map((l, i) => <Thumb key={`${l.productId}`} line={l} i={i} size={size} step={step} brand={brand} />)}
            {extra > 0 ? (
                <View
                    style={{
                        position: 'absolute', left: shown.length * step, top: (BOX - size) / 2, width: size, height: size, borderRadius: size / 2, zIndex: 9,
                        backgroundColor: brand.primary, borderWidth: 2, borderColor: brand.surface, alignItems: 'center', justifyContent: 'center',
                        transitionProperty: 'left, top, width, height', transitionDuration: '340ms', transitionTimingFunction: 'cubic-bezier(0.22, 0.8, 0.2, 1)',
                    }}
                >
                    <Text style={{ color: brand.onPrimary || '#FFFFFF', fontSize: 11.5, fontWeight: '900' }}>+{extra}</Text>
                </View>
            ) : null}
        </View>
    );
}

export default function DesktopCartBar({ navRef, routeName }) {
    const brand = useBrand();
    const lines = useCartStore((s) => s.lines);
    const [added, setAdded] = useState(null);      // the dish just added (shown while `flash`)
    const [flash, setFlash] = useState(false);
    const [pop, setPop] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [shown, setShown] = useState(false);     // true = in place, false = parked just outside (the CSS transition does the sliding)
    const flashT = useRef(null);
    const popT = useRef(null);
    const goneT = useRef(null);

    const visible = lines.length > 0 && !HIDE_ON.includes(routeName);

    // the hide button folds the card into a small round chip with the count (like the phone's cart bar); another dish added, or an empty
    // cart, brings the card back
    const [hidden, setHidden] = useState(false);
    const itemCount = lines.reduce((a, l) => a + l.quantity, 0);
    const lastCount = useRef(itemCount);
    useEffect(() => {
        if (itemCount > lastCount.current || itemCount === 0) setHidden(false);
        lastCount.current = itemCount;
    }, [itemCount]);

    // slide in / slide out
    useEffect(() => {
        clearTimeout(goneT.current);
        if (visible) {
            setMounted(true);
            const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));   // one frame outside, the next in place: that is the slide
            return () => cancelAnimationFrame(id);
        }
        setShown(false);
        goneT.current = setTimeout(() => setMounted(false), OUT_MS);
        return () => clearTimeout(goneT.current);
    }, [visible]);

    // a dish was added: say so for a moment
    useEffect(() => {
        const onAdd = (line) => {
            setAdded({ name: line.name, image: line.image });
            setFlash(true); setPop(true);
            clearTimeout(flashT.current); clearTimeout(popT.current);
            flashT.current = setTimeout(() => setFlash(false), FLASH_MS);
            popT.current = setTimeout(() => setPop(false), 180);
        };
        cartHooks.onAdd = onAdd;
        return () => { if (cartHooks.onAdd === onAdd) cartHooks.onAdd = null; clearTimeout(flashT.current); clearTimeout(popT.current); clearTimeout(goneT.current); };
    }, []);

    if (!mounted) return null;
    const count = lines.reduce((a, l) => a + l.quantity, 0);
    const total = lines.reduce((a, l) => a + l.price * l.quantity, 0);
    const last = lines[lines.length - 1];
    const dish = flash && added ? added : last;   // after the moment is over (or on a reload) the card shows the newest dish in the cart
    const open = () => { if (navRef && navRef.isReady()) navRef.navigate('Cart'); };


    const ease = 'cubic-bezier(0.22, 0.8, 0.2, 1)';
    const showCard = shown && !hidden;
    const showChip = shown && hidden;
    return (
        <View pointerEvents="box-none" style={{ position: 'absolute', right: 24, bottom: 24, zIndex: 60 }}>
            {/* the card */}
            <Pressable
                onPress={open}
                pointerEvents={showCard ? 'auto' : 'none'}
                accessibilityLabel={tr('View cart')}
                style={({ hovered }) => ({
                    width: 400, flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 16, backgroundColor: brand.surface,
                    borderWidth: 1, borderColor: flash || hovered ? brand.primary : brand.border,
                    boxShadow: '0 12px 36px rgba(0,0,0,0.38)', cursor: 'pointer',
                    opacity: showCard ? 1 : 0,
                    transform: [{ translateY: shown ? 0 : 20 }, { translateX: hidden ? 44 : shown ? 0 : 28 }, { scale: !showCard ? 0.94 : pop ? 1.035 : 1 }],
                    transitionProperty: 'opacity, transform, border-color', transitionDuration: `${OUT_MS}ms`, transitionTimingFunction: ease,
                })}
            >
                <Thumbs lines={lines} brand={brand} />
                <View style={{ flex: 1, marginLeft: 12, marginRight: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name={flash ? 'checkmark-circle' : 'bag-handle'} size={14} color={flash ? '#16A34A' : brand.primary} />
                        <Text style={{ color: brand.muted, fontSize: 11.5, fontWeight: '800', marginLeft: 5 }}>{flash ? tr('Added to cart') : tr('Your cart')}</Text>
                    </View>
                    <Text numberOfLines={1} style={{ color: brand.text, fontSize: 14, fontWeight: '800', marginTop: 2 }}>{flash && dish?.name ? dish.name : (count === 1 ? tr('1 item') : tr('{n} items', { n: count }))}</Text>
                    <Text numberOfLines={1} style={{ color: brand.muted, fontSize: 12, marginTop: 1 }}>{flash ? `${count === 1 ? tr('1 item') : tr('{n} items', { n: count })} · ${money(total)}` : money(total)}</Text>
                </View>
                <View style={{ height: 34, paddingHorizontal: 13, borderRadius: 17, backgroundColor: brand.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: brand.onPrimary || '#FFFFFF', fontSize: 12.5, fontWeight: '800' }}>{tr('View cart')}</Text>
                    <Ionicons name="arrow-forward" size={14} color={brand.onPrimary || '#FFFFFF'} style={{ marginLeft: 5 }} />
                </View>
                {/* hide: folds the card into the round chip */}
                <Pressable
                    onPress={() => setHidden(true)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={tr('Hide')}
                    style={({ hovered }) => ({ width: 30, height: 30, borderRadius: 15, marginLeft: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: hovered ? brand.border : brand.background, cursor: 'pointer' })}
                >
                    <Ionicons name="chevron-down" size={17} color={brand.muted} />
                </Pressable>
            </Pressable>

            {/* the chip: the card folded away; one tap brings it back */}
            <Pressable
                onPress={() => setHidden(false)}
                pointerEvents={showChip ? 'auto' : 'none'}
                accessibilityRole="button"
                accessibilityLabel={tr('Show cart')}
                style={({ hovered }) => ({
                    position: 'absolute', right: 0, bottom: 0, width: 56, height: 56, borderRadius: 28, backgroundColor: brand.primary, alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 10px 28px rgba(0,0,0,0.4)', cursor: 'pointer',
                    opacity: showChip ? 1 : 0, transform: [{ scale: showChip ? (hovered ? 1.08 : 1) : 0.5 }],
                    transitionProperty: 'opacity, transform', transitionDuration: `${OUT_MS}ms`, transitionTimingFunction: ease,
                })}
            >
                <Ionicons name="bag-handle" size={24} color={brand.onPrimary || '#FFFFFF'} />
                <View style={{ position: 'absolute', top: -3, right: -3, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 5, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(0,0,0,0.3)' }}>
                    <Text style={{ color: brand.primary, fontWeight: '900', fontSize: 12 }}>{count > 99 ? '99+' : count}</Text>
                </View>
            </Pressable>
        </View>
    );
}
