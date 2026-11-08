// The photos of a service, shown like the banners on the home screen: rounded cards that slide by themselves (always forward),
// swipe left and right, three dots below. "See all photos" opens a grid; tap a photo there (or in the slider) for full screen,
// where the guest can swipe on to the next photo.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, Pressable, Modal, StatusBar, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand } from '../common/kit';
import { ImageViewer } from '../common/PhotoViewer';
import { tr } from '../../i18n';

const GAP = 12;
const SIDE = 16;

// The grid of every photo (open === -1). A tap on a photo opens it in the shared viewer (components/common/PhotoViewer): pinch with two fingers to zoom
// in and out, drag a zoomed photo, double tap to zoom, swipe down or tap the cross to close, arrows for the next photo.
function PhotosModal({ photos, open, onClose }) {
    const { width } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const { background, text } = useBrand();
    const [view, setView] = useState(null);   // index of the photo that is open in the viewer
    const visible = open === -1;
    useEffect(() => { if (!visible) setView(null); }, [visible]);
    const cell = Math.floor((width - SIDE * 2 - 8 * 2) / 3);
    return (
        <Modal visible={visible} animationType="fade" statusBarTranslucent onRequestClose={onClose}>
            <StatusBar barStyle="light-content" />
            <View style={{ flex: 1, backgroundColor: background, paddingTop: insets.top }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 }}>
                    <Text style={{ color: text, fontWeight: '900', fontSize: 18, flex: 1 }}>{tr('Photos')} ({photos.length})</Text>
                    <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={26} color={text} /></Pressable>
                </View>
                <FlatList
                    data={photos} numColumns={3} keyExtractor={(u, i) => `${u}-${i}`}
                    contentContainerStyle={{ paddingHorizontal: SIDE, paddingBottom: insets.bottom + 20 }}
                    columnWrapperStyle={{ marginBottom: 8, justifyContent: 'flex-start' }}
                    renderItem={({ item, index }) => (
                        <Pressable onPress={() => setView(index)} style={{ marginRight: index % 3 === 2 ? 0 : 8 }}>
                            <Image source={{ uri: item }} style={{ width: cell, height: cell, borderRadius: 12 }} contentFit="cover" />
                        </Pressable>
                    )}
                />
            </View>
            {view !== null ? <ImageViewer visible uris={photos} start={view} onClose={() => setView(null)} /> : null}
        </Modal>
    );
}

export default function PhotoCarousel({ photos }) {
    const list = useMemo(() => (photos || []).filter(Boolean), [photos]);
    const { width } = useWindowDimensions();
    const { primary, border } = useBrand();
    const w = width - SIDE * 2;
    const snap = w + GAP;
    const ref = useRef(null);
    const idx = useRef(0);
    const [cur, setCur] = useState(0);
    const [open, setOpen] = useState(null);   // null closed, -1 the grid, 0.. a photo full screen

    // the same one-way loop as the home banners: three copies in a row, we live in the middle one and jump back without animation
    const n = list.length;
    const loop = n > 1;
    const data = useMemo(() => (loop ? [...list, ...list, ...list] : list), [list, loop]);
    const home = (i) => { idx.current = i; ref.current?.scrollToOffset({ offset: i * snap, animated: false }); };
    const settle = (i) => {
        if (!loop) return;
        let k = i;
        if (k >= 2 * n) k -= n; else if (k < n) k += n;
        if (k !== i) home(k); else idx.current = i;
        setCur(k % n);
    };
    useEffect(() => { if (loop) { const t = setTimeout(() => home(n), 0); return () => clearTimeout(t); } return undefined; }, [n, snap]);   // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (!loop || open !== null) return undefined;   // no sliding behind a photo that is open
        const t = setInterval(() => {
            const next = idx.current + 1;
            idx.current = next;
            ref.current?.scrollToOffset({ offset: next * snap, animated: true });
            setCur(next % n);
            setTimeout(() => settle(next), 650);
        }, 4500);
        return () => clearInterval(t);
    }, [n, snap, open]);   // eslint-disable-line react-hooks/exhaustive-deps

    if (!n) return null;
    return (
        <View style={{ marginBottom: 14 }}>
            <FlatList
                ref={ref} data={data} horizontal showsHorizontalScrollIndicator={false}
                getItemLayout={(_, i) => ({ length: w, offset: i * snap, index: i })}
                snapToInterval={snap} decelerationRate="fast" disableIntervalMomentum
                onMomentumScrollEnd={(e) => {
                    const i = Math.round(e.nativeEvent.contentOffset.x / snap);
                    if (loop) settle(i); else { idx.current = i; setCur(i); }
                }}
                keyExtractor={(u, i) => `${u}-${i}`} contentContainerStyle={{ paddingHorizontal: SIDE, paddingVertical: 8 }} ItemSeparatorComponent={() => <View style={{ width: GAP }} />}
                renderItem={({ item, index }) => (
                    <Pressable onPress={() => setOpen(loop ? index % n : index)} style={{ width: w, height: 190, borderRadius: 24, overflow: 'hidden' }}>
                        <Image source={{ uri: item }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                    </Pressable>
                )}
            />
            {n > 1 ? (
                <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 4 }}>
                    {list.map((u, i) => <View key={`${u}-${i}`} style={[{ width: 6, height: 6, borderRadius: 3, marginHorizontal: 3 }, i === cur ? { width: 20, backgroundColor: primary } : { backgroundColor: border }]} />)}
                </View>
            ) : null}
            {n > 1 ? (
                <Pressable onPress={() => setOpen(-1)} hitSlop={8} style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                    <Text style={{ color: primary, fontWeight: '800' }}>{tr('See all {n} photos', { n })}</Text>
                    <Ionicons name="grid-outline" size={15} color={primary} style={{ marginLeft: 6 }} />
                </Pressable>
            ) : null}
            {/* a tap on a photo in the slider: straight to the zoomable viewer; the grid is for 'See all photos' */}
            {open !== null && open >= 0 ? <ImageViewer visible uris={list} start={open} onClose={() => setOpen(null)} /> : null}
            <PhotosModal photos={list} open={open === -1 ? -1 : null} onClose={() => setOpen(null)} />
        </View>
    );
}
