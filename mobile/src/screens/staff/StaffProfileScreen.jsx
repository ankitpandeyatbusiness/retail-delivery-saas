// The cook's and the waiter's own page, in one standard order: who you are (with your picture) -> your account -> working time -> alerts and sound ->
// how the app looks and speaks -> Log out, always last.
import React, { useState } from 'react';
import { View, Text, ScrollView, Linking } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { Card, Row, Sheet, Field, Button, SectionTitle } from '../../components/owners/ui';
import { JobBadge, StaffHeader } from '../../components/staff/staffBits';
import { Avatar } from '../../components/riders/riderBits';
import AppearanceSwitch from '../../components/owners/AppearanceSwitch';
import SoundSettings from '../../components/staff/SoundSettings';
import DutyCard from '../../components/staff/DutyCard';
import LanguageSheet from '../../components/common/LanguageSheet';
import { themedAlert } from '../../components/common/dialog';
import { showToast } from '../../components/customers/shop';
import { useStaffStore } from '../../store/staff/useStaffStore';
import { useAuthStore } from '../../store/common/useAuthStore';
import { saveStaffName } from '../../api/staff/staffApi';
import { takeAndUploadStaffPhoto, removeStaffPhoto } from '../../utils/riders/riderPhotos';
import { LANGS, useLang, tr } from '../../i18n';

export default function StaffProfileScreen() {
    const { background, text, muted, error } = useBrand();
    const nav = useNavigation();
    const me = useStaffStore((s) => s.me);
    const logout = useAuthStore((s) => s.logout);
    const lang = useLang((st) => st.lang);
    const [langOpen, setLangOpen] = useState(false);
    const [nameOpen, setNameOpen] = useState(false);
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const [photoBusy, setPhotoBusy] = useState(false);

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

    const doPhoto = async (source) => {
        setPhotoBusy(true);
        try {
            const r = await takeAndUploadStaffPhoto(source);
            if (r) { useStaffStore.getState().patchMe({ photo: r.photo }); showToast(tr('Picture saved')); }
        } catch (e) { showToast(e.safe ? e.message : tr('Could not save that picture. Try again.')); }
        setPhotoBusy(false);
    };
    const changePhoto = () => themedAlert(tr('Your picture'), tr('The owner sees this picture next to your name.'), [
        { text: tr('Take a photo'), onPress: () => doPhoto('camera') },
        { text: tr('Choose from gallery'), onPress: () => doPhoto('gallery') },
        ...(me?.photo ? [{
            text: tr('Remove picture'), style: 'destructive',
            onPress: async () => {
                setPhotoBusy(true);
                try { await removeStaffPhoto(); useStaffStore.getState().patchMe({ photo: null }); } catch (e) { showToast(tr('Could not remove it. Try again.')); }
                setPhotoBusy(false);
            },
        }] : []),
        { text: tr('Cancel'), style: 'cancel' },
    ], { icon: 'person-circle-outline' });

    const signOut = () => themedAlert(`${tr('Log out')}?`, tr('You will need your OTP to sign in again.'), [
        { text: tr('Cancel'), style: 'cancel' },
        { text: tr('Log out'), style: 'destructive', onPress: () => { useStaffStore.getState().reset(); require('../../store/staff/useKitchenStore').useKitchenStore.getState().reset(); require('../../store/staff/useWaiterStore').useWaiterStore.getState().reset(); logout().catch(() => { }); } },
    ], { icon: 'log-out-outline' });

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <StaffHeader title={tr('Profile')} />
            <ScrollView contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
                {/* 1. who you are */}
                <View style={{ alignItems: 'center', marginBottom: 18, paddingHorizontal: 16 }}>
                    <Avatar uri={me?.photo} size={92} onPress={changePhoto} busy={photoBusy} />
                    <Text style={{ color: text, fontSize: 21, fontWeight: '900', marginTop: 12 }}>{me?.name || tr('Add your name')}</Text>
                    <Text style={{ color: muted, fontWeight: '600', marginTop: 2 }}>{me?.phone}{me?.shop ? ` · ${me.shop}` : ''}</Text>
                    <View style={{ marginTop: 8 }}>{me?.role ? <JobBadge role={me.role} /> : null}</View>
                </View>

                {/* 2. your account */}
                <Card>
                    <Row icon="camera-outline" title={tr('Your picture')} subtitle={me?.photo ? tr('Change or remove it') : tr('Add a picture of yourself')} onPress={changePhoto} />
                    <Row icon="create-outline" title={tr('Your name')} subtitle={me?.name || tr('Add your name')} onPress={openName} />
                    {me?.shopPhone ? <Row icon="call-outline" title={tr('Call the shop')} subtitle={me.shopPhone} onPress={() => Linking.openURL(`tel:${me.shopPhone}`).catch(() => { })} last /> : null}
                </Card>

                {/* 3. working time (live or off duty, weekly hours) and the page for days off and leave */}
                <DutyCard />
                <Card>
                    <Row icon="calendar-outline" title={tr('Days off and leave')} subtitle={tr('Take a holiday or ask the owner for leave')} onPress={() => nav.navigate('StaffLeave')} last />
                </Card>

                {/* 4. alerts and sound */}
                {me?.role ? <SoundSettings role={me.role} /> : null}

                {/* 5. how the app looks and speaks */}
                <SectionTitle title={tr('App')} />
                <Card>
                    <AppearanceSwitch />
                    <Row icon="language-outline" title={tr('Language')} subtitle={LANGS.find((l) => l.code === lang)?.native} onPress={() => setLangOpen(true)} last />
                </Card>

                {/* 6. log out: always the last thing */}
                <View style={{ marginTop: 18 }}>
                    <Card>
                        <Row icon="log-out-outline" title={tr('Log out')} color={error} onPress={signOut} last />
                    </Card>
                </View>
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
