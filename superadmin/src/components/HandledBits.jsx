// "Handled by hand": a button that takes an item off a Needs attention list with a note, and shows who did it and an Undo for 10 minutes.
//   <HandleBar kind="refund_failed" refId={id} title="Refund ₹339" mark={row.mark} onChanged={reload} />
import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useTheme, spacing, font } from '../theme';
import { Button } from './ui';
import { ConfirmSheet, toast } from './feedback';
import { markHandled, undoHandled } from '../api/handledApi';
import { errMsg } from '../api/adminClient';

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function HandleBar({ kind, refId, title, mark, onChanged, style }) {
    const t = useTheme();
    const [sheet, setSheet] = useState(false);
    const [busy, setBusy] = useState(false);
    const [left, setLeft] = useState(mark?.undoLeftSec || 0);
    useEffect(() => { setLeft(mark?.undoLeftSec || 0); }, [mark?.id, mark?.undoLeftSec]);
    useEffect(() => {
        if (!left) return undefined;
        const id = setInterval(() => setLeft((x) => Math.max(0, x - 1)), 1000);
        return () => clearInterval(id);
    }, [left > 0]);   // eslint-disable-line react-hooks/exhaustive-deps

    const save = async (note) => {
        try { await markHandled({ kind, refId, note, title }); toast('Marked as handled. You can take it back for 10 minutes.'); onChanged && onChanged(); } catch (e) { toast(errMsg(e), 'error'); throw e; }
    };
    const undo = async () => {
        setBusy(true);
        try { await undoHandled(mark.id); toast('Taken back'); onChanged && onChanged(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };

    if (mark) {
        return (
            <View style={[{ marginTop: spacing.sm }, style]}>
                <Text style={{ color: t.muted, fontSize: font.xs }}>Handled{mark.by ? ` by ${mark.by}` : ''}{mark.note ? `: ${mark.note}` : ''}</Text>
                {left > 0 ? <Button small kind="outline" title={`Undo (${mmss(left)} left)`} icon="back" loading={busy} onPress={undo} style={{ marginTop: spacing.sm }} /> : null}
            </View>
        );
    }
    return (
        <View style={[{ marginTop: spacing.sm }, style]}>
            <Button small kind="outline" title="Mark as handled" icon="ok" onPress={() => setSheet(true)} />
            <ConfirmSheet
                visible={sheet}
                onClose={() => setSheet(false)}
                icon="ok"
                title="Mark as handled by hand?"
                message="It leaves this list. The thing itself does not change. You can take it back for 10 minutes."
                needReason
                reasonLabel="What did you do? For example: refunded from the Razorpay dashboard"
                confirmLabel="Mark as handled"
                onConfirm={save}
            />
        </View>
    );
}
