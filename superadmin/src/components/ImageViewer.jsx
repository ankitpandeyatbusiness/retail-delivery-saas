// Tap any picture to see it full screen. Pinch to zoom in and out, drag to move a zoomed picture, double tap to zoom, swipe down or tap the cross to close.
//   <ZoomImage source={{ uri }} style={...} resizeMode="cover" group={[uri1, uri2]} />   an Image that opens the viewer (group = all the pictures to page through)
//   <ZoomPress uri={uri} uris={[...]} style={...}>{any picture-like children}</ZoomPress>  the same for a custom picture (animated, with overlays)
//   openImage(uri, uris?)                                                                  from code
import React, { useCallback, useEffect, useState } from 'react';
import { Modal, View, Image, Pressable, Text, StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from './Icon';

const MAX_ZOOM = 6;
const clamp = (v, lo, hi) => {
    'worklet';
    return Math.min(Math.max(v, lo), hi);
};

// one zoomable picture
function Page({ uri, active, onClose, onZoomChange }) {
    const { width, height } = useWindowDimensions();
    const scale = useSharedValue(1);
    const saved = useSharedValue(1);
    const tx = useSharedValue(0);
    const ty = useSharedValue(0);
    const sx = useSharedValue(0);
    const sy = useSharedValue(0);

    useEffect(() => {
        scale.value = 1; saved.value = 1; tx.value = 0; ty.value = 0; sx.value = 0; sy.value = 0;
    }, [uri]);   // eslint-disable-line react-hooks/exhaustive-deps

    const settle = () => {
        'worklet';
        const maxX = ((scale.value - 1) * width) / 2;
        const maxY = ((scale.value - 1) * height) / 2;
        tx.value = withTiming(clamp(tx.value, -maxX, maxX), { duration: 120 });
        ty.value = withTiming(clamp(ty.value, -maxY, maxY), { duration: 120 });
        sx.value = clamp(tx.value, -maxX, maxX);
        sy.value = clamp(ty.value, -maxY, maxY);
    };

    const pinch = Gesture.Pinch()
        .onUpdate((e) => { scale.value = clamp(saved.value * e.scale, 0.7, MAX_ZOOM); })
        .onEnd(() => {
            if (scale.value < 1) { scale.value = withTiming(1); tx.value = withTiming(0); ty.value = withTiming(0); sx.value = 0; sy.value = 0; saved.value = 1; } else { saved.value = scale.value; settle(); }
            runOnJS(onZoomChange)(saved.value > 1.02);
        });

    const pan = Gesture.Pan()
        .averageTouches(true)
        .onUpdate((e) => {
            if (scale.value > 1.02) { tx.value = sx.value + e.translationX; ty.value = sy.value + e.translationY; }
        })
        .onEnd((e) => {
            if (scale.value > 1.02) { sx.value = tx.value; sy.value = ty.value; settle(); } else if (e.translationY > 120 && Math.abs(e.translationX) < 90) runOnJS(onClose)();
        });

    const doubleTap = Gesture.Tap().numberOfTaps(2).onEnd(() => {
        if (scale.value > 1.02) { scale.value = withTiming(1); saved.value = 1; tx.value = withTiming(0); ty.value = withTiming(0); sx.value = 0; sy.value = 0; runOnJS(onZoomChange)(false); } else { scale.value = withTiming(2.5); saved.value = 2.5; runOnJS(onZoomChange)(true); }
    });

    const style = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }] }));
    // all three run side by side. (Exclusive(doubleTap, ...) made pinch and drag wait until the double tap had given up, so a two-finger pinch never started.)
    const gesture = Gesture.Simultaneous(doubleTap, pinch, pan);

    return (
        <GestureDetector gesture={gesture}>
            <Animated.View style={[{ width, height, alignItems: 'center', justifyContent: 'center' }, style]} renderToHardwareTextureAndroid>
                {active ? <Image source={{ uri }} style={{ width, height }} resizeMode="contain" /> : null}
            </Animated.View>
        </GestureDetector>
    );
}

// onSave(uri), when given, adds a save button next to the cross
export function ImageViewer({ visible, uris, start = 0, onClose, onSave }) {
    const insets = useSafeAreaInsets();
    const [i, setI] = useState(start);
    const [zoomed, setZoomed] = useState(false);
    useEffect(() => { if (visible) { setI(start); setZoomed(false); } }, [visible, start]);
    const go = useCallback((d) => { setI((v) => Math.min(Math.max(v + d, 0), uris.length - 1)); setZoomed(false); }, [uris.length]);
    if (!visible || !uris?.length) return null;
    return (
        <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
            <GestureHandlerRootView style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.96)' }}>
                <Page uri={uris[i]} active onClose={onClose} onZoomChange={setZoomed} />
                <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close" style={[st.close, { top: insets.top + 10 }]}>
                    <Icon name="clear" size={22} color="#FFFFFF" />
                </Pressable>
                {onSave ? (
                    <Pressable onPress={() => onSave(uris[i])} hitSlop={12} accessibilityRole="button" accessibilityLabel="Save" style={[st.close, { top: insets.top + 10, right: 62 }]}>
                        <Icon name="download-outline" size={22} color="#FFFFFF" />
                    </Pressable>
                ) : null}
                {uris.length > 1 ? (
                    <>
                        <Text style={[st.count, { top: insets.top + 16 }]}>{i + 1} / {uris.length}</Text>
                        {!zoomed && i > 0 ? <Pressable onPress={() => go(-1)} hitSlop={10} style={[st.arrow, { left: 12 }]}><Icon name="back" size={22} color="#FFFFFF" /></Pressable> : null}
                        {!zoomed && i < uris.length - 1 ? <Pressable onPress={() => go(1)} hitSlop={10} style={[st.arrow, { right: 12 }]}><Icon name="next" size={22} color="#FFFFFF" /></Pressable> : null}
                    </>
                ) : null}
            </GestureHandlerRootView>
        </Modal>
    );
}

// a picture (any children) that opens the viewer when tapped
// save: the viewer gets a save button (the phone's save and share sheet)
export function ZoomPress({ uri, uris, children, style, save }) {
    const [open, setOpen] = useState(false);
    const list = (uris && uris.length ? uris : [uri]).filter(Boolean);
    const start = Math.max(0, list.indexOf(uri));
    if (!list.length) return children;
    return (
        <>
            <Pressable onPress={() => setOpen(true)} accessibilityRole="imagebutton" accessibilityLabel="Open the picture" style={style}>{children}</Pressable>
            <ImageViewer visible={open} uris={list} start={start} onClose={() => setOpen(false)} onSave={save ? (u) => require('../utils/saveMedia').savePicture(u) : undefined} />
        </>
    );
}

// an Image that opens the viewer. Same props as Image, plus group (all pictures to page through).
export function ZoomImage({ source, group, style, save, ...rest }) {
    const uri = source && source.uri;
    if (!uri) return <Image source={source} style={style} {...rest} />;
    return (
        <ZoomPress uri={uri} uris={group} save={save}>
            <Image source={source} style={style} {...rest} />
        </ZoomPress>
    );
}

const st = StyleSheet.create({
    close: { position: 'absolute', right: 14, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
    count: { position: 'absolute', alignSelf: 'center', left: 0, right: 0, textAlign: 'center', color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
    arrow: { position: 'absolute', top: '50%', width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
});
