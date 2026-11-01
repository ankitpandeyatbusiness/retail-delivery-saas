// "For how long?": the question the owner gets when he pauses orders, asked to the cook, the waiter and the rider when they go off duty.
// onPick(extra): extra is { pauseMinutes } | { untilMorning: true } | { untilNextOpening: true } (only when the shop has opening hours) | {} (until I start again). A timed break puts the person back on duty by itself.
import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { useBrand } from './kit';
import { Sheet, Row } from '../owners/ui';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { tr } from '../../i18n';

const CHOICES = [
    ['30 minutes', { pauseMinutes: 30 }, 'time-outline'],
    ['1 hour', { pauseMinutes: 60 }, 'time-outline'],
    ['2 hours', { pauseMinutes: 120 }, 'time-outline'],
    ['Until tomorrow morning', { untilMorning: true }, 'moon-outline'],
    ['Until the next scheduled opening', { untilNextOpening: true }, 'calendar-outline'],   // only when the shop has opening hours
    ['Until I start again', {}, 'hand-left-outline'],
];

export default function OffDutySheet({ visible, onClose, onPick }) {
    const { muted, error } = useBrand();
    const hours = useHomeStore((st) => st.full?.hours);
    const seen = useHomeStore((st) => !!st.seen);   // the shop's settings have been read at least once
    // the shop's opening hours decide whether the "next scheduled opening" choice is offered (read once when the sheet opens, if not known yet)
    useEffect(() => { if (visible && !seen) useHomeStore.getState().load(); }, [visible, seen]);
    const hasHours = (!!hours?.weekly && Object.keys(hours.weekly).length > 0) || (hours?.closedDates || []).length > 0;
    const choices = CHOICES.filter(([, extra]) => hasHours || !extra.untilNextOpening);
    return (
        <Sheet visible={visible} onClose={onClose} title={tr('Go off duty')}>
            <Text style={{ color: muted, marginBottom: 8 }}>{tr('For how long? You get no new work or alerts meanwhile, and you are back on duty by yourself when the time is up.')}</Text>
            {choices.map(([label, extra, icon], i) => (
                <Row key={label} icon={icon} title={tr(label)} color={i === choices.length - 1 ? error : undefined} onPress={() => { onClose(); onPick(extra); }} last={i === choices.length - 1} />
            ))}
        </Sheet>
    );
}
