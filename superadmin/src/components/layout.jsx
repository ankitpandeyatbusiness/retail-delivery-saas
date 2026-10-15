import React from 'react';
import { View, Text, Pressable, ScrollView, RefreshControl, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useTheme, spacing, radius, font } from '../theme';
import Icon from './Icon';
import { useInboxStore } from '../store/useInboxStore';

/* A round, translucent button for the coloured header (back arrow, add, bell...) */
export function HeaderButton({ icon, onPress, badge }) {
    return (
        <Pressable onPress={onPress} hitSlop={8} style={s.hbtn}>
            <Icon name={icon} size={22} color="#FFFFFF" />
            {badge ? <View style={s.badge}><Text style={s.badgeText}>{badge > 99 ? '99+' : badge}</Text></View> : null}
        </Pressable>
    );
}

export function Header({ title, subtitle, back = true, right, bell }) {
    const t = useTheme();
    const unread = useInboxStore((st) => st.unread);
    const nav = useNavigation();
    const insets = useSafeAreaInsets();
    const canBack = back && nav.canGoBack();
    return (
        <LinearGradient
            colors={t.gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[s.header, { paddingTop: insets.top + spacing.sm }]}
        >
            {/* soft decorative circles */}
            <View style={[s.circle, { width: 180, height: 180, right: -50, top: -60 }]} />
            <View style={[s.circle, { width: 110, height: 110, right: 70, top: 40, opacity: 0.5 }]} />
            <View style={s.row}>
                {canBack ? <View style={{ marginRight: spacing.md }}><HeaderButton icon="back" onPress={() => nav.goBack()} /></View> : null}
                <View style={{ flex: 1 }}>
                    <Text style={s.title} numberOfLines={1}>{title}</Text>
                    {subtitle ? <Text style={s.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
                </View>
                {right ? <View style={{ marginLeft: spacing.sm }}>{right}</View> : null}
                {bell ? <View style={{ marginLeft: spacing.sm }}><HeaderButton icon="bell" badge={unread} onPress={() => nav.navigate('Inbox')} /></View> : null}
            </View>
        </LinearGradient>
    );
}

/*
 * Every screen is built with this: coloured header, 16px side gutters, optional sticky action bar at the bottom.
 *   scroll={false}  for screens that own a FlatList (children fill the space)
 *   footer          the one primary action, kept above the keyboard and the gesture bar
 *   tabScreen       a top-level tab: no back arrow
 *   pinned          something that stays in view above the scrolling form (the live phone preview)
 */
export function Screen({ title, subtitle, back, right, children, scroll = true, refreshing, onRefresh, footer, tabScreen, pinned }) {
    const t = useTheme();
    const insets = useSafeAreaInsets();
    const body = scroll ? (
        <ScrollView
            contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl * 2 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={t.primary} colors={[t.primary]} /> : undefined}
        >
            {children}
        </ScrollView>
    ) : <View style={{ flex: 1 }}>{children}</View>;

    return (
        <View style={{ flex: 1, backgroundColor: t.bg }}>
            <StatusBar style="light" />
            <Header title={title} subtitle={subtitle} back={back ?? !tabScreen} right={right} bell={!!tabScreen} />
            {pinned || null}
            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                {body}
                {footer ? (
                    <View style={[s.footer, { backgroundColor: t.surface, borderTopColor: t.border, paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
                        {footer}
                    </View>
                ) : null}
            </KeyboardAvoidingView>
        </View>
    );
}

const s = StyleSheet.create({
    header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl, overflow: 'hidden' },
    row: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
    title: { color: '#FFFFFF', fontSize: font.xl, fontWeight: '800' },
    subtitle: { color: 'rgba(255,255,255,0.8)', fontSize: font.sm, marginTop: 1 },
    circle: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.1)' },
    hbtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
    badge: { position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#FF3B6B', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
    badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
    footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
});
