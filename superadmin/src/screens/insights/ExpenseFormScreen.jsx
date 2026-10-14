import React, { useState } from 'react';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Screen } from '../../components/layout';
import { Button } from '../../components/ui';
import { Field } from '../../components/inputs';
import { Group, NumberField, Switch, Choice } from '../../components/settingsForm';
import { ConfirmSheet, toast } from '../../components/feedback';
import { addExpense, updateExpense, deleteExpense } from '../../api/insightsApi';
import { errMsg } from '../../api/adminClient';
import { ymdOf, isoOfYmd, titleCase } from '../../utils/format';

const CATEGORIES = ['hosting', 'sms_provider', 'payment_gateway_fees', 'staff', 'marketing', 'tools', 'taxes', 'other'];
const todayYmd = () => ymdOf(new Date().toISOString());

// Add or change one expense. A repeating one counts again every month.
export default function ExpenseFormScreen() {
    const nav = useNavigation();
    const old = useRoute().params?.expense;
    const [category, setCategory] = useState(old?.category || 'hosting');
    const [amount, setAmount] = useState(old ? old.amountPaise / 100 : undefined);
    const [date, setDate] = useState(old ? ymdOf(old.date) : todayYmd());
    const [vendor, setVendor] = useState(old?.vendor || '');
    const [note, setNote] = useState(old?.note || '');
    const [repeat, setRepeat] = useState(!!old?.repeatMonthly);
    const [endsOn, setEndsOn] = useState(old?.endsOn ? ymdOf(old.endsOn) : '');
    const [busy, setBusy] = useState(false);
    const [confirm, setConfirm] = useState(false);

    const save = async () => {
        if (!(amount > 0)) { toast('Enter the amount', 'error'); return; }
        if (!isoOfYmd(date)) { toast('Date must look like 2026-10-31', 'error'); return; }
        if (repeat && endsOn && !isoOfYmd(endsOn)) { toast('End date must look like 2026-10-31', 'error'); return; }
        const body = {
            date: isoOfYmd(date), category, amountPaise: Math.round(amount * 100), vendor: vendor.trim(), note: note.trim(),
            repeatMonthly: repeat, endsOn: repeat && endsOn ? isoOfYmd(endsOn) : null,
        };
        setBusy(true);
        try {
            if (old) await updateExpense(old.id, body); else await addExpense(body);
            toast('Saved');
            nav.goBack();
        } catch (e) { toast(errMsg(e), 'error'); setBusy(false); }
    };

    return (
        <Screen
            title={old ? 'Change expense' : 'Add expense'}
            footer={<Button title="Save" icon="check" onPress={save} loading={busy} />}
        >
            <Group title="What" section="catalog">
                <Choice label="Kind of cost" options={CATEGORIES.map((c) => ({ value: c, label: titleCase(c) }))} value={category} onChange={setCategory} />
                <NumberField label="Amount" prefix="₹" value={amount} onChange={setAmount} />
                <Field label="Paid to (optional)" value={vendor} onChangeText={setVendor} maxLength={80} placeholder="e.g. Render, Atlas, MSG91" />
                <Field label="Note (optional)" value={note} onChangeText={setNote} maxLength={200} />
            </Group>
            <Group title="When" section="platform">
                <Field label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} maxLength={10} keyboardType="numbers-and-punctuation" />
                <Switch title="Repeats every month" subtitle="For fixed costs like hosting or a salary" value={repeat} onValueChange={setRepeat} last={!repeat} />
                {repeat ? <Field label="Stops after (optional, YYYY-MM-DD)" value={endsOn} onChangeText={setEndsOn} maxLength={10} keyboardType="numbers-and-punctuation" /> : null}
            </Group>
            {old ? <Button title="Delete this expense" kind="danger" icon="trash" style={{ marginTop: 16 }} onPress={() => setConfirm(true)} /> : null}
            <ConfirmSheet
                visible={confirm}
                onClose={() => setConfirm(false)}
                title="Delete this expense?"
                message="It will no longer count in your profit and loss."
                confirmLabel="Delete"
                danger
                onConfirm={async () => {
                    try { await deleteExpense(old.id); toast('Deleted'); nav.goBack(); } catch (e) { toast(errMsg(e), 'error'); throw e; }
                }}
            />
        </Screen>
    );
}
