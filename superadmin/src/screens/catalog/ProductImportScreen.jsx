import React, { useState } from 'react';
import { View, Text, TextInput } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { useTheme, spacing, radius, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Button, Card, Badge } from '../../components/ui';
import { Group, Hint } from '../../components/settingsForm';
import { toast } from '../../components/feedback';
import { importPreview, importSave } from '../../api/catalogApi';
import { errMsg } from '../../api/adminClient';

const MAX_ROWS = 300;
const COLUMNS = ['name', 'category', 'price', 'type', 'mrp', 'eggless', 'gstRate', 'description'];
const SAMPLE = 'name,category,price,type,mrp,eggless,gstRate,description\nPaneer Tikka,Starters,220,veg,250,no,5,Smoky and soft\nChicken Biryani,Mains,260,nonveg,,no,5,';

// a CSV with quoted fields ("a, b") and "" for a quote inside
function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let q = false;
    const src = text.replace(/^﻿/, '');
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (q) {
            if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
        } else if (c === '"') q = true;
        else if (c === ',') { row.push(cell); cell = ''; }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && src[i + 1] === '\n') i++;
            row.push(cell); cell = '';
            if (row.some((x) => x.trim() !== '')) rows.push(row);
            row = [];
        } else cell += c;
    }
    row.push(cell);
    if (row.some((x) => x.trim() !== '')) rows.push(row);
    return rows;
}

function toRows(text) {
    const grid = parseCsv(text);
    if (grid.length < 2) throw new Error('The file needs a header line and at least one item.');
    const head = grid[0].map((h) => h.trim());
    const idx = Object.fromEntries(COLUMNS.map((c) => [c, head.findIndex((h) => h.toLowerCase() === c.toLowerCase())]));
    const missing = ['name', 'category', 'price', 'type'].filter((c) => idx[c] === -1);
    if (missing.length) throw new Error(`These columns are missing in the first line: ${missing.join(', ')}`);
    return grid.slice(1).map((r) => {
        const o = {};
        for (const c of COLUMNS) if (idx[c] !== -1 && (r[idx[c]] ?? '').trim() !== '') o[c] = r[idx[c]].trim();
        return o;
    });
}

// Add many items at once: choose a CSV file or paste it, look at the preview, then save.
// Nothing is saved if any line has a problem.
export default function ProductImportScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const { shopId, name } = useRoute().params;
    const [text, setText] = useState('');
    const [rows, setRows] = useState(null);
    const [preview, setPreview] = useState(null);   // { willCreate, newCategories } or { errors }
    const [busy, setBusy] = useState('');
    const [problem, setProblem] = useState('');

    const reset = () => { setRows(null); setPreview(null); setProblem(''); };

    const pickFile = async () => {
        try {
            const r = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel', '*/*'], copyToCacheDirectory: true });
            if (r.canceled || !r.assets?.length) return;
            const body = await (await fetch(r.assets[0].uri)).text();
            setText(body);
            reset();
        } catch (e) { toast('Could not read that file', 'error'); }
    };

    const check = async () => {
        reset();
        let parsed;
        try { parsed = toRows(text); } catch (e) { setProblem(e.message); return; }
        if (parsed.length > MAX_ROWS) { setProblem(`At most ${MAX_ROWS} items at a time. This file has ${parsed.length}.`); return; }
        setBusy('check');
        try {
            const r = await importPreview(shopId, parsed);
            setRows(parsed);
            setPreview(r);
        } catch (e) {
            const d = e?.response?.data;
            if (d?.errors?.length) { setRows(parsed); setPreview({ errors: d.errors }); } else setProblem(errMsg(e));
        } finally { setBusy(''); }
    };

    const save = async () => {
        setBusy('save');
        try {
            const r = await importSave(shopId, rows);
            toast(`${r.created} item${r.created === 1 ? '' : 's'} added`);
            nav.goBack();
        } catch (e) { toast(errMsg(e), 'error'); setBusy(''); }
    };

    const ok = preview && !preview.errors;
    return (
        <Screen
            title="Import items"
            subtitle={name}
            footer={ok ? <Button title={`Add ${preview.willCreate} item${preview.willCreate === 1 ? '' : 's'}`} icon="check" onPress={save} loading={busy === 'save'} /> : null}
        >
            <Group title="1. Your file" section="catalog">
                <Button title="Choose a CSV file" icon="box" kind="soft" onPress={pickFile} />
                <Hint>Or paste the contents below. The first line must name the columns.</Hint>
                <TextInput
                    value={text}
                    onChangeText={(v) => { setText(v); reset(); }}
                    multiline
                    placeholder={SAMPLE}
                    placeholderTextColor={t.muted}
                    autoCapitalize="none"
                    style={{
                        marginTop: spacing.md, minHeight: 140, borderRadius: radius.md, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface,
                        color: t.text, padding: spacing.md, textAlignVertical: 'top', fontSize: font.sm,
                    }}
                />
                <Button title="Check the file" kind={text.trim() ? 'primary' : 'outline'} disabled={!text.trim()} loading={busy === 'check'} onPress={check} style={{ marginTop: spacing.md }} />
                {problem ? <Hint tone="warn">{problem}</Hint> : null}
            </Group>

            {preview ? (
                <Group title="2. Result" section={ok ? 'money' : 'alerts'}>
                    {ok ? (
                        <>
                            <Badge label="Ready to add" tone="success" icon="ok" />
                            <Text style={{ color: t.text, fontWeight: '800', fontSize: font.lg, marginTop: spacing.sm }}>
                                {preview.willCreate} new item{preview.willCreate === 1 ? '' : 's'}
                            </Text>
                            {preview.newCategories?.length ? (
                                <Text style={{ color: t.muted, marginTop: 4 }}>New categories: {preview.newCategories.join(', ')}</Text>
                            ) : null}
                            <Hint>Nothing is saved until you press the button below.</Hint>
                        </>
                    ) : (
                        <>
                            <Badge label={`${preview.errors.length} problem${preview.errors.length === 1 ? '' : 's'}`} tone="danger" icon="warning" />
                            <Text style={{ color: t.muted, marginVertical: spacing.sm }}>Fix these lines in the file and check it again. Nothing was added.</Text>
                            {preview.errors.slice(0, 40).map((e, i) => (
                                <View key={i} style={{ flexDirection: 'row', paddingVertical: 4 }}>
                                    <Text style={{ color: t.danger, fontWeight: '800', width: 70 }}>Line {e.row + 1}</Text>
                                    <Text style={{ color: t.text, flex: 1 }}>{e.message}</Text>
                                </View>
                            ))}
                            {preview.errors.length > 40 ? <Hint>…and {preview.errors.length - 40} more.</Hint> : null}
                        </>
                    )}
                </Group>
            ) : null}

            <Group title="How to prepare the file" section="settings">
                <Text style={{ color: t.text, fontWeight: '800', marginBottom: 6 }}>Columns</Text>
                <Text style={{ color: t.muted, lineHeight: 20 }}>
                    <Text style={{ color: t.text, fontWeight: '700' }}>name</Text>, <Text style={{ color: t.text, fontWeight: '700' }}>category</Text>,{' '}
                    <Text style={{ color: t.text, fontWeight: '700' }}>price</Text>, <Text style={{ color: t.text, fontWeight: '700' }}>type</Text> (veg / nonveg / egg) are needed.{'\n'}
                    Optional: mrp, eggless (yes / no), gstRate (0, 0.25, 3, 5, 12, 18, 28), description.
                </Text>
                <Hint>Up to {MAX_ROWS} items at a time. A category that does not exist yet is created. An item that is already in the category is refused.</Hint>
            </Group>
        </Screen>
    );
}
