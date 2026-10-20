// The staff person's own page: name, shop, light/dark, language, call the shop, log out. Nothing to set up.
import React, { useState } from 'react';
import { View, Text, ScrollView, Linking } from 'react-native';
import { useBrand, alpha } from '../../components/common/kit';
import { Card, Row, Sheet, Field, Button } from '../../components/owners/ui';
import { JobBadge, StaffHeader } from '../../components/staff/staffBits';
import AppearanceSwitch from '../../components/owners/AppearanceSwitch';
import LanguageSheet from '../../components/common/LanguageSheet';
import { themedAlert } from '../../components/common/dialog';
import { showToast } from '../../components/customers/shop';
import { useStaffStore } from '../../store/staff/useStaffStore';
import { useAuthStore } from '../../store/common/useAuthStore';
import { saveStaffName } from '../../api/staff/staffApi';
import { LANGS, useLang, tr } from '../../i18n';

export default function StaffProfileScreen() {
    const { background, text, muted, primary, error } = useBrand();
    const me = useStaffStore((s) => s.me);
    const logout = useAuthStore((s) => s.logout);
    const lang = useLang((st) => st.lang);
    const [langOpen, setLangOpen] = useState(false);
    const [nameOpen, setNameOpen] = useState(false);
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);

    const openName = () => { setName(me?.name || ''); setNameOpen(true); };
    const saveName = async () => {
        setBusy(true);
        try {
            const r = await saveStaffName(name.trim());
            useStaffStore.getState().patchMe({ name: r.name });
            setNameOpen(false);
            showToast(tr('Saved'));
        } catch (e) { showToast(e?.response?.data?.error || tr('Could not save. Try again.')); } finally { setBusy(false); }
    };

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <StaffHeader title={tr('Profile')} />
            <ScrollView contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
                <View style={{ alignItems: 'center', marginBottom: 18, paddingHorizontal: 16 }}>
                    <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: alpha(primary, 0.16), alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ color: primary, fontWeight: '900', fontSize: 34 }}>{(me?.name || me?.phone || '?').charAt(0).toUpperCase()}</Text>
                    </View>
                    <Text style={{ color: text, fontSize: 21, fontWeight: '900', marginTop: 12 }}>{me?.name || tr('Add your name')}</Text>
                    <Text style={{ color: muted, fontWeight: '600', marginTop: 2 }}>{me?.phone}{me?.shop ? ` · ${me.shop}` : ''}</Text>
                    <View style={{ marginTop: 8 }}>{me?.role ? <JobBadge role={me.role} /> : null}</View>
                </View>
                <Card>
                    <Row icon="create-outline" title={tr('Your name')} subtitle={me?.name || tr('Add your name')} onPress={openName} />
                    {me?.shopPhone ? <Row icon="call-outline" title={tr('Call the shop')} subtitle={me.shopPhone} onPress={() => Linking.openURL(`tel:${me.shopPhone}`).catch(() => { })} /> : null}
                    <AppearanceSwitch />
                    <Row icon="language-outline" title={tr('Language')} subtitle={LANGS.find((l) => l.code === lang)?.native} onPress={() => setLangOpen(true)} />
                    <Row
                        icon="log-out-outline" title={tr('Log out')} color={error} last
                        onPress={() => themedAlert(`${tr('Log out')}?`, tr('You will need your OTP to sign in again.'), [
                            { text: tr('Cancel'), style: 'cancel' },
                            { text: tr('Log out'), style: 'destructive', onPress: () => { useStaffStore.getState().reset(); require('../../store/staff/useKitchenStore').useKitchenStore.getState().reset(); logout().catch(() => { }); } },
                        ], { icon: 'log-out-outline' })}
                    />
                </Card>
            </ScrollView>
            <Sheet visible={nameOpen} onClose={() => setNameOpen(false)} title={tr('Your name')}>
                <Text style={{ color: muted, marginBottom: 10 }}>{tr('The owner sees this name next to what you do.')}</Text>
                <Field value={name} onChangeText={setName} placeholder={tr('Your name')} maxLength={40} autoFocus style={{ marginBottom: 14 }} />
                <Button label={tr('Save')} icon="checkmark" disabled={name.trim().length < 2} busy={busy} onPress={saveName} />
            </Sheet>
            <LanguageSheet visible={langOpen} onClose={() => setLangOpen(false)} />
        </View>
    );
}
