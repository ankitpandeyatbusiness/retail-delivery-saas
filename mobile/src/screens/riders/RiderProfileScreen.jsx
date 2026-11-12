// The rider's own page: his photo, who he works for, how to call the shop, and log out. Nothing to set up.
import React, { useState } from 'react';
import { View, Text, ScrollView, Linking, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useBrand, alpha } from '../../components/common/kit';
import { Ionicons } from '@expo/vector-icons';
import { showToast } from '../../components/customers/shop';
import { themedAlert } from '../../components/common/dialog';
import { Card, Row, SectionTitle } from '../../components/owners/ui';
import { Avatar } from '../../components/riders/riderBits';
import SosSheet from '../../components/riders/SosSheet';
import KeepRunningSheet from '../../components/riders/KeepRunningSheet';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useRiderStore } from '../../store/riders/useRiderStore';
import { LANGS, useLang } from '../../i18n';
import LanguageSheet from '../../components/common/LanguageSheet';
import AppearanceSwitch from '../../components/owners/AppearanceSwitch';
import { takeAndUploadMyPhoto, removeMyPhoto } from '../../utils/riders/riderPhotos';
import { T, errText } from '../../utils/riders/riderText';
import { tr } from '../../i18n';
import { useRiderDesktop } from '../../utils/common/layout';
import { Hero, HeroBtn, GlassStat } from '../../components/owners/RiderDesk';

export default function RiderProfileScreen() {
    const insets = useSafeAreaInsets();
    const nav = useNavigation();
    const desk = useRiderDesktop();   // a computer: the same banner as the owner's profile, the choices in two cards side by side
    const { background, text, muted, error, primary, border } = useBrand();
    const me = useRiderStore((s) => s.me);
    const patchMe = useRiderStore((s) => s.patchMe);
    const logout = useAuthStore((s) => s.logout);
    const [busy, setBusy] = useState(false);
    const [sosOpen, setSosOpen] = useState(false);
    const [guideOpen, setGuideOpen] = useState(false);
    const [langOpen, setLangOpen] = useState(false);
    const lang = useLang((st) => st.lang);

    const doPhoto = async (source) => {
        setBusy(true);
        try {
            const r = await takeAndUploadMyPhoto(source);
            if (r) { patchMe({ photo: r.photo }); showToast(T.photoSaved); }
        } catch (e) { showToast(e.safe ? e.message : errText(e)); }
        setBusy(false);
    };
    const changePhoto = () => themedAlert(T.changePhoto, tr('The shop and the customer see this picture.'), [
        { text: T.takePhoto, onPress: () => doPhoto('camera') },
        { text: tr('Choose from gallery'), onPress: () => doPhoto('gallery') },
        ...(me?.photo ? [{
            text: 'Remove photo', style: 'destructive',
            onPress: async () => {
                setBusy(true);
                try { await removeMyPhoto(); patchMe({ photo: null }); } catch (e) { showToast(errText(e)); }
                setBusy(false);
            },
        }] : []),
        { text: T.cancel, style: 'cancel' },
    ], { icon: 'person-circle-outline' });

    const v = me?.vehicle;
    const rowsA = (
        <>
                    {me?.shopPhone ? <Row icon="call-outline" title={T.callShop} subtitle={me.shopPhone} onPress={() => Linking.openURL(`tel:${me.shopPhone}`).catch(() => { })} /> : null}
                    {me?.pointsOn !== false ? <Row icon="ribbon-outline" title={tr('My points and badge')} subtitle={tr('Your badge is shown to customers')} onPress={() => nav.navigate('RiderPoints')} /> : null}
                    <Row icon="notifications-outline" title={tr('Alerts')} subtitle={tr('Notifications, popups and sounds')} onPress={() => nav.navigate('AlertSettings')} />
                    <Row icon="volume-high-outline" title={tr('Soundbox')} subtitle={tr('Voice, language and volume')} onPress={() => nav.navigate('Soundbox')} />
                    <Row icon="calendar-outline" title={tr('Duty timing and leave')} subtitle={tr('Automatic duty, holidays, ask for leave')} onPress={() => nav.navigate('RiderDuty')} last={desk} />
        </>
    );
    const rowsB = (
        <>
                    <AppearanceSwitch />
                    <Row icon="language-outline" title={tr('Language')} subtitle={LANGS.find((l) => l.code === lang)?.native} onPress={() => setLangOpen(true)} />
                    <Row icon="alert-circle-outline" title={T.sos} color={error} onPress={() => setSosOpen(true)} />
                    {Platform.OS === 'web' ? null : <Row icon="battery-charging-outline" title={T.keepRunning} subtitle={T.keepRunningTitle} onPress={() => setGuideOpen(true)} />}
                    <Row icon="information-circle-outline" title={tr('About Us')} subtitle={tr('About the platform, terms and privacy')} onPress={() => nav.navigate('AboutUs')} />
                    <Row icon="phone-portrait-outline" title={tr("Where you're logged in")} subtitle={tr('Phones and browsers signed in as you')} onPress={() => nav.navigate('Sessions')} />
                    <Row
                        icon="log-out-outline" title={T.logout} color={error} last
                        onPress={() => themedAlert(`${T.logout}?`, T.logoutText, [
                            { text: T.cancel, style: 'cancel' },
                            { text: T.logout, style: 'destructive', onPress: () => { useRiderStore.getState().reset(); logout().catch(() => { }); } },
                        ], { icon: 'log-out-outline' })}
                    />
        </>
    );
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <ScrollView contentContainerStyle={{ paddingTop: desk ? 8 : insets.top + 14, paddingBottom: 24 }}>
              <View style={desk ? { width: '100%', maxWidth: 760, alignSelf: 'center' } : undefined}>
                {desk ? (
                    <Hero
                        lead={<View style={{ marginRight: 18, borderRadius: 48, borderWidth: 3, borderColor: 'rgba(255,255,255,0.8)' }}><Avatar uri={me?.photo} size={84} onPress={changePhoto} busy={busy} /></View>}
                        title={me?.name || tr('Delivery partner')}
                        subtitle={`${me?.phone || ''}${me?.shop ? `  ·  ${me.shop}` : ''}`}
                        right={<HeroBtn solid icon="camera" label={T.changePhoto} onPress={changePhoto} />}>
                        <View style={{ flexDirection: 'row', marginTop: 18 }}>
                            {me?.ratingCount > 0 ? <GlassStat label={tr('Rating')} value={`★ ${Number(me.ratingAvg).toFixed(1)}`} icon="star-outline" /> : null}
                            {me?.avgDeliveryMin ? <GlassStat label={tr('Average delivery')} value={`${me.avgDeliveryMin} ${tr('min')}`} icon="time-outline" /> : null}
                            {v?.type || v?.number ? <GlassStat label={tr('Vehicle')} value={[v.type, v.number].filter(Boolean).join(' · ')} icon="bicycle-outline" /> : null}
                        </View>
                    </Hero>
                ) : null}
                {desk ? null : <View style={{ alignItems: 'center', marginBottom: 18 }}>
                    <Avatar uri={me?.photo} size={96} onPress={changePhoto} busy={busy} />
                    <Text style={{ color: text, fontSize: 22, fontWeight: '900', marginTop: 12 }}>{me?.name || tr('Delivery partner')}</Text>
                    <Text style={{ color: muted, fontWeight: '600', marginTop: 2 }}>{me?.phone}{me?.shop ? ` · ${me.shop}` : ''}</Text>
                    {me?.ratingCount > 0 ? <Text style={{ color: text, fontWeight: '800', marginTop: 6 }}>{tr('★ {v1} · {ratingCount} ratings', { v1: Number(me.ratingAvg).toFixed(1), ratingCount: me.ratingCount })}</Text> : null}
                    {me?.avgDeliveryMin ? <Text style={{ color: text, fontWeight: '800', marginTop: 4 }}>{tr('Average delivery time: {min} min · {n} deliveries', { min: me.avgDeliveryMin, n: me.deliveryCount })}</Text> : null}
                    {v?.type || v?.number ? <Text style={{ color: muted, fontWeight: '700', marginTop: 4 }}>{[v.type, v.number].filter(Boolean).join(' · ')}</Text> : null}
                </View>}
                {desk ? (
                    <View>
                        <SectionTitle title={tr('Your details')} />
                        <Card>
                            {[
                                ['person-outline', tr('Name'), me?.name || '-'],
                                ['call-outline', tr('Phone'), me?.phone || '-'],
                                ['storefront-outline', tr('Shop'), me?.shop || '-'],
                                ...(v?.type || v?.number ? [['bicycle-outline', tr('Vehicle'), [v.type, v.number].filter(Boolean).join(' · ')]] : []),
                            ].map(([ic, label, value], i, arr) => (
                                <View key={label} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: i === arr.length - 1 ? 0 : 1, borderBottomColor: border }}>
                                    <View style={{ width: 38, height: 38, borderRadius: 13, backgroundColor: alpha(primary, 0.13), alignItems: 'center', justifyContent: 'center' }}><Ionicons name={ic} size={19} color={primary} /></View>
                                    <Text style={{ color: muted, fontWeight: '700', fontSize: 13, marginLeft: 12, width: 80 }}>{label}</Text>
                                    <Text style={{ flex: 1, color: text, fontWeight: '900', fontSize: 15 }} numberOfLines={1}>{value}</Text>
                                </View>
                            ))}
                        </Card>
                    </View>
                ) : <Card>{rowsA}{rowsB}</Card>}
              </View>
            </ScrollView>
            <SosSheet visible={sosOpen} onClose={() => setSosOpen(false)} shopPhone={me?.shopPhone} />
            <KeepRunningSheet visible={guideOpen} onClose={() => setGuideOpen(false)} />
            <LanguageSheet visible={langOpen} onClose={() => setLangOpen(false)} />
        </View>
    );
}
