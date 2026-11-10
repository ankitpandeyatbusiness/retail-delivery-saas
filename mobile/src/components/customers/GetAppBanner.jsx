// "Get the app": a slim bar at the top of the WEBSITE, shown while both the website and the shop's app are switched on (the server sends the Play Store
// address as channel.getAppUrl only then). Not shown in the phone app, inside a website that was added to the home screen, to owners / staff, or after
// the visitor closed it (remembered in this browser).
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, Platform, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../common/kit';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { useThemeStore } from '../../store/common/useThemeStore';
import { useAuthStore } from '../../store/common/useAuthStore';
import { tr } from '../../i18n';

const KEY = 'getAppBannerClosed';
const read = () => { try { return window.localStorage.getItem(KEY) === '1'; } catch (e) { return false; } };
const standalone = () => { try { return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; } catch (e) { return false; } };

export default function GetAppBanner() {
    const brand = useBrand();
    const url = useHomeStore((s) => s.channel && s.channel.getAppUrl);
    const name = useThemeStore((s) => s.theme.name);
    const role = useAuthStore((s) => s.user && s.user.role);
    const [closed, setClosed] = useState(true);   // closed until we know (no flash)
    useEffect(() => { if (Platform.OS === 'web') setClosed(read() || standalone()); }, []);

    if (Platform.OS !== 'web' || !url || closed || (role && role !== 'customer')) return null;
    const close = () => { try { window.localStorage.setItem(KEY, '1'); } catch (e) { /* the bar just comes back next time */ } setClosed(true); };
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 14, backgroundColor: brand.primary }}>
            <Ionicons name="phone-portrait-outline" size={18} color={brand.onPrimary || '#FFFFFF'} />
            <Text numberOfLines={1} style={{ flex: 1, color: brand.onPrimary || '#FFFFFF', fontWeight: '700', fontSize: 13.5, marginLeft: 10 }}>
                {tr('Order faster in the {name} app', { name: name || tr('shop') })}
            </Text>
            <Pressable onPress={() => Linking.openURL(url).catch(() => { })} style={{ paddingHorizontal: 14, height: 30, borderRadius: 15, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginLeft: 10 }}>
                <Text style={{ color: brand.primary, fontWeight: '900', fontSize: 13 }}>{tr('Get the app')}</Text>
            </Pressable>
            <Pressable onPress={close} hitSlop={10} accessibilityLabel={tr('Close')} style={{ marginLeft: 10 }}>
                <Ionicons name="close" size={20} color={brand.onPrimary || '#FFFFFF'} />
            </Pressable>
        </View>
    );
}
