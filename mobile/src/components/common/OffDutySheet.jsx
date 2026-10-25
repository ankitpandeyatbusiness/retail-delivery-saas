// "For how long?": the question the owner gets when he pauses orders, asked to the cook, the waiter and the rider when they go off duty.
// onPick(extra): extra is { pauseMinutes } | { untilMorning: true } | {} (until I start again). A timed break puts the person back on duty by itself.
import React from 'react';
import { Text } from 'react-native';
import { useBrand } from './kit';
import { Sheet, Row } from '../owners/ui';
import { tr } from '../../i18n';

const CHOICES = [
    ['30 minutes', { pauseMinutes: 30 }, 'time-outline'],
    ['1 hour', { pauseMinutes: 60 }, 'time-outline'],
    ['2 hours', { pauseMinutes: 120 }, 'time-outline'],
    ['Until tomorrow morning', { untilMorning: true }, 'moon-outline'],
    ['Until I start again', {}, 'hand-left-outline'],
];

export default function OffDutySheet({ visible, onClose, onPick }) {
    const { muted, error } = useBrand();
    return (
        <Sheet visible={visible} onClose={onClose} title={tr('Go off duty')}>
            <Text style={{ color: muted, marginBottom: 8 }}>{tr('For how long? You get no new work or alerts meanwhile, and you are back on duty by yourself when the time is up.')}</Text>
            {CHOICES.map(([label, extra, icon], i) => (
                <Row key={label} icon={icon} title={tr(label)} color={i === CHOICES.length - 1 ? error : undefined} onPress={() => { onClose(); onPick(extra); }} last={i === CHOICES.length - 1} />
            ))}
        </Sheet>
    );
}
