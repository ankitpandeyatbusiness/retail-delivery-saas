// The rider's own page: his photo, who he works for, how to call the shop, and log out. Nothing to set up.
import React, { useState } from 'react';
import { View, Text, ScrollView, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { showToast } from '../../components/customers/shop';
import { themedAlert } from '../../components/common/dialog';
import { Card, Row } from '../../components/owners/ui';
import { Avatar } from '../../components/riders/riderBits';
import SosSheet from '../../components/riders/SosSheet';
import KeepRunningSheet from '../../components/riders/KeepRunningSheet';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useRiderStore } from '../../store/riders/useRiderStore';
import { LANGS, useLang } from '../../i18n';
import LanguageSheet from '../../components/common/LanguageSheet';
import { takeAndUploadMyPhoto, removeMyPhoto } from '../../utils/riders/riderPhotos';
import { T, errText } from '../../utils/riders/riderText';
import { tr } from '../../i18n';

export default function RiderProfileScreen() {
    const insets = useSafeAreaInsets();
    const nav = useNavigation();
    const { background, text, muted, error } = useBrand();
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
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <ScrollView contentContainerStyle={{ paddingTop: insets.top + 14, paddingBottom: 140 }}>
                <View style={{ alignItems: 'center', marginBottom: 18 }}>
                    <Avatar uri={me?.photo} size={96} onPress={changePhoto} busy={busy} />
                    <Text style={{ color: text, fontSize: 22, fontWeight: '900', marginTop: 12 }}>{me?.name || tr('Delivery partner')}</Text>
                    <Text style={{ color: muted, fontWeight: '600', marginTop: 2 }}>{me?.phone}{me?.shop ? ` · ${me.shop}` : ''}</Text>
                    {me?.ratingCount > 0 ? <Text style={{ color: text, fontWeight: '800', marginTop: 6 }}>{tr('★ {v1} · {ratingCount} ratings', { v1: Number(me.ratingAvg).toFixed(1), ratingCount: me.ratingCount })}</Text> : null}
                    {me?.avgDeliveryMin ? <Text style={{ color: text, fontWeight: '800', marginTop: 4 }}>{tr('Average delivery time: {min} min · {n} deliveries', { min: me.avgDeliveryMin, n: me.deliveryCount })}</Text> : null}
                    {v?.type || v?.number ? <Text style={{ color: muted, fontWeight: '700', marginTop: 4 }}>{[v.type, v.number].filter(Boolean).join(' · ')}</Text> : null}
                </View>
                <Card>
                    {me?.shopPhone ? <Row icon="call-outline" title={T.callShop} subtitle={me.shopPhone} onPress={() => Linking.openURL(`tel:${me.shopPhone}`).catch(() => { })} /> : null}
                    <Row icon="language-outline" title={tr('Language')} subtitle={LANGS.find((l) => l.code === lang)?.native} onPress={() => setLangOpen(true)} />
                    <Row icon="alert-circle-outline" title={T.sos} color={error} onPress={() => setSosOpen(true)} />
                    <Row icon="battery-charging-outline" title={T.keepRunning} subtitle={T.keepRunningTitle} onPress={() => setGuideOpen(true)} />
                    <Row icon="document-text-outline" title={T.terms} onPress={() => nav.navigate('LegalList')} />
                    <Row
                        icon="log-out-outline" title={T.logout} color={error} last
                        onPress={() => themedAlert(`${T.logout}?`, T.logoutText, [
                            { text: T.cancel, style: 'cancel' },
                            { text: T.logout, style: 'destructive', onPress: () => { useRiderStore.getState().reset(); logout().catch(() => { }); } },
                        ], { icon: 'log-out-outline' })}
                    />
                </Card>
            </ScrollView>
            <SosSheet visible={sosOpen} onClose={() => setSosOpen(false)} shopPhone={me?.shopPhone} />
            <KeepRunningSheet visible={guideOpen} onClose={() => setGuideOpen(false)} />
            <LanguageSheet visible={langOpen} onClose={() => setLangOpen(false)} />
        </View>
    );
}
