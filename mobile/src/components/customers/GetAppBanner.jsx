// "Get the app": a slim bar at the top of the WEBSITE. The button opens the Play Store when the shop has its app there (the server sends the address as
// channel.getAppUrl), and otherwise installs the website as an app (utils/common/installApp.js). Not shown in the phone app, inside an installed app, to
// owners / staff, when the browser offers neither way, or after the visitor closed it (remembered in this browser).
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../common/kit';
import { useGetApp } from '../../utils/common/installApp';
import { useThemeStore } from '../../store/common/useThemeStore';
import { useAuthStore } from '../../store/common/useAuthStore';
import { tr } from '../../i18n';

const KEY = 'getAppBannerClosed';
const read = () => { try { return window.localStorage.getItem(KEY) === '1'; } catch (e) { return false; } };
const standalone = () => { try { return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; } catch (e) { return false; } };

export default function GetAppBanner() {
    const brand = useBrand();
    const getApp = useGetApp();
    const name = useThemeStore((s) => s.theme.name);
    const role = useAuthStore((s) => s.user && s.user.role);
    const [closed, setClosed] = useState(true);   // closed until we know (no flash)
    useEffect(() => { if (Platform.OS === 'web') setClosed(read() || standalone()); }, []);

    if (Platform.OS !== 'web' || !getApp.show || closed || (role && role !== 'customer')) return null;
    const close = () => { try { window.localStorage.setItem(KEY, '1'); } catch (e) { /* the bar just comes back next time */ } setClosed(true); };
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 14, backgroundColor: brand.primary }}>
            <Ionicons name="phone-portrait-outline" size={18} color={brand.onPrimary || '#FFFFFF'} />
            <Text numberOfLines={1} style={{ flex: 1, color: brand.onPrimary || '#FFFFFF', fontWeight: '700', fontSize: 13.5, marginLeft: 10 }}>
                {tr('Order faster in the {name} app', { name: name || tr('shop') })}
            </Text>
            <Pressable onPress={getApp.open} style={{ paddingHorizontal: 14, height: 30, borderRadius: 15, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginLeft: 10 }}>
                <Text style={{ color: brand.primary, fontWeight: '900', fontSize: 13 }}>{getApp.kind === 'store' ? tr('Get the app') : tr('Install app')}</Text>
            </Pressable>
            <Pressable onPress={close} hitSlop={10} accessibilityLabel={tr('Close')} style={{ marginLeft: 10 }}>
                <Ionicons name="close" size={20} color={brand.onPrimary || '#FFFFFF'} />
            </Pressable>
        </View>
    );
}
