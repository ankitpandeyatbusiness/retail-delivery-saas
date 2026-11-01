// The picture of a service, for the Services list and the top of a service page. It is the first photo of the service; a service with no
// photo (every new one) gets the shop's own colours with a big soft icon, so it never looks empty. A dark fade at the bottom keeps the
// white words readable on any picture.
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrand } from '../common/kit';
import { tr } from '../../i18n';

const fill = StyleSheet.absoluteFillObject;
const SHADOW = { textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 };

// `fade`/`locations`: the dark layer over the picture. children are drawn on top (the words, the buttons).
export function ServiceCover({ service, style, children, fade = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.72)'], locations }) {
    const { primary, primaryLight, primaryDark } = useBrand();
    const cover = (service.photos || []).filter(Boolean)[0];
    return (
        <View style={[{ overflow: 'hidden', backgroundColor: primary }, style]}>
            {cover ? <Image source={{ uri: cover }} style={fill} contentFit="cover" transition={250} /> : (
                <LinearGradient colors={[primaryLight || primary, primary, primaryDark || primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={fill}>
                    <Ionicons name={service.icon || 'sparkles-outline'} size={170} color="rgba(255,255,255,0.16)" style={{ position: 'absolute', right: -22, bottom: -26 }} />
                    <View style={{ position: 'absolute', left: -40, top: -40, width: 150, height: 150, borderRadius: 75, backgroundColor: 'rgba(255,255,255,0.07)' }} />
                </LinearGradient>
            )}
            <LinearGradient pointerEvents="none" colors={fade} locations={locations} style={fill} />
            {children}
        </View>
    );
}

// the pill with the price (or any short fact) drawn on a picture
export function GlassPill({ icon, label }) {
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' }}>
            {icon ? <Ionicons name={icon} size={14} color="#fff" style={{ marginRight: 6 }} /> : null}
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>{label}</Text>
        </View>
    );
}

// the top of a service page: a tall picture with a round back button, the name and the price over it
export default function ServiceHero({ service, priceText }) {
    const nav = useNavigation();
    const insets = useSafeAreaInsets();
    return (
        <ServiceCover
            service={service} style={{ height: 300 + insets.top * 0.4, borderBottomLeftRadius: 30, borderBottomRightRadius: 30 }}
            fade={['rgba(0,0,0,0.4)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.78)']} locations={[0, 0.4, 1]}
        >
            <Pressable
                onPress={() => nav.canGoBack() && nav.goBack()} hitSlop={12}
                style={{ position: 'absolute', top: insets.top + 10, left: 16, width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(0,0,0,0.32)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' }}
            >
                <Ionicons name="arrow-back" size={22} color="#fff" />
            </Pressable>
            <View style={{ position: 'absolute', left: 20, right: 20, bottom: 24 }}>
                <Text numberOfLines={2} style={[{ color: '#fff', fontSize: 28, fontWeight: '900', lineHeight: 34, marginBottom: 10 }, SHADOW]}>{tr(service.name)}</Text>
                {priceText ? <GlassPill icon="pricetag-outline" label={priceText} /> : null}
            </View>
        </ServiceCover>
    );
}
