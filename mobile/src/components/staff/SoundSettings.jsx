// The cook's and the waiter's alert settings on the Profile page: the Soundbox (sound, voice, language, volume, "always ready") and the Alerts screen
// (which alerts, as a notification, a popup or a sound). They belong to this phone. "Test" plays the real thing.
import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { Card, Row, SectionTitle } from '../owners/ui';
import { useSoundboxStore } from '../../store/owners/useSoundboxStore';
import { staffAlert } from '../../utils/staff/staffSound';
import { tr } from '../../i18n';

export default function SoundSettings({ role }) {
    const sb = useSoundboxStore();
    const nav = useNavigation();
    const testKind = role === 'waiter' ? { kind: 'ready', table: '2', orderNo: '1042' } : { kind: 'new', orderNo: '1042', speech: 'New order for table 2. 1 Chicken Wings, 2 Paneer Butter Masala. Note: no onion.', speechHi: 'टेबल 2 के लिए नया ऑर्डर। 1 Chicken Wings, 2 Paneer Butter Masala। विशेष निर्देश: प्याज़ नहीं।' };
    return (
        <>
            <SectionTitle title={tr('Alerts')} />
            <Card>
                <Row icon="notifications-outline" title={tr('Alerts')} subtitle={tr('For each alert: notification, popup and sound')} onPress={() => nav.navigate('AlertSettings')} />
                <Row
                    icon="volume-high-outline" title={tr('Soundbox')}
                    subtitle={sb.soundbox ? tr('On. Sound, voice, language, volume and "always ready" are set there.') : tr('Off. Tap to turn it on and choose the voice.')}
                    onPress={() => nav.navigate('Soundbox')}
                />
                <Row icon="play-circle-outline" title={tr('Test the alert')} subtitle={tr('Plays the sound and the line now')} onPress={() => staffAlert(testKind, { force: true })} last />
            </Card>
        </>
    );
}
