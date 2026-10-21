// The cook's and the waiter's own alert settings (on the Profile page): the ting-tong, the spoken line, its language, the volume, and which
// kinds of alert to hear. They belong to this phone. "Test" plays the real thing.
import React from 'react';
import { View, Text, Switch } from 'react-native';
import { useBrand, alpha } from '../common/kit';
import { Card, Row, Chips, SectionTitle } from '../owners/ui';
import { useStaffSoundStore } from '../../store/staff/useStaffSoundStore';
import { staffAlert } from '../../utils/staff/staffSound';
import { saveTellDone } from '../../api/staff/staffApi';
import { tr } from '../../i18n';

const KIND_LABEL = {
    kitchen: [['new', 'New orders'], ['cancel', 'Cancelled orders'], ['hurry', 'A table is waiting'], ['here', 'A pickup customer is here'], ['done', 'Order handed over, collected or served']],
    waiter: [['ready', 'Food ready to serve'], ['call', 'A table calls'], ['bill', 'A table wants the bill'], ['cancel', 'Cancelled orders']],
};

export default function SoundSettings({ role }) {
    const { text, muted, primary, border } = useBrand();
    const st = useStaffSoundStore();
    const sw = (value, onValueChange) => (
        <Switch value={value} onValueChange={onValueChange} trackColor={{ true: alpha(primary, 0.5), false: border }} thumbColor={value ? primary : muted} />
    );
    const testKind = role === 'waiter' ? { kind: 'ready', table: '4', orderNo: '1042' } : { kind: 'new', orderNo: '1042' };
    return (
        <View>
            <SectionTitle title={tr('Alerts')} />
            <Card>
                <Row icon="notifications-outline" title={tr('Ting-tong sound')} subtitle={tr('Rings while the app is open. When it is closed, the phone rings instead.')} right={sw(st.sound, (v) => st.update({ sound: v }))} />
                <Row icon="mic-outline" title={tr('Say it aloud')} subtitle={tr('A short line after the sound, like "New order 1042"')} right={sw(st.voice, (v) => st.update({ voice: v }))} />
                <View style={{ paddingVertical: 10 }}>
                    <Text style={{ color: text, fontWeight: '800', fontSize: 15 }}>{tr('Voice language')}</Text>
                    <Chips options={[['auto', tr('Same as app')], ['en', 'English'], ['hi', 'हिन्दी']]} value={st.language} onChange={(v) => st.update({ language: v })} />
                </View>
                <View style={{ paddingBottom: 6 }}>
                    <Text style={{ color: text, fontWeight: '800', fontSize: 15 }}>{tr('Volume')}</Text>
                    <Chips options={[[0.4, tr('Low')], [0.7, tr('Medium')], [1, tr('Full')]]} value={st.volume >= 0.9 ? 1 : st.volume >= 0.6 ? 0.7 : 0.4} onChange={(v) => st.update({ volume: v })} />
                </View>
                <Row icon="play-circle-outline" title={tr('Test the alert')} subtitle={tr('Plays the sound and the line now')} onPress={() => staffAlert(testKind, { force: true })} last />
            </Card>
            <SectionTitle title={tr('Tell me about')} />
            <Card>
                {(KIND_LABEL[role] || KIND_LABEL.kitchen).map(([k, label], i, a) => (
                    <Row key={k} title={tr(label)} right={sw(st.kinds[k] !== false, (v) => { st.update({ kinds: { [k]: v } }); if (k === 'done') saveTellDone(v).catch(() => { }); })} last={i === a.length - 1} />
                ))}
            </Card>
        </View>
    );
}
