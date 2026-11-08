import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Badge, Button, Chip, ListRow } from '../../components/ui';
import { Field } from '../../components/inputs';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox, Sheet, SheetScroll, toast } from '../../components/feedback';
import LegalText from '../../components/LegalText';
import { useSupreme } from '../../hooks/useSupreme';
import { fetchLegalPage, fetchLegalPageVersion, saveLegalDraft, discardLegalDraft, publishLegalPage, restoreLegalVersion } from '../../api/legalApi';
import { errMsg } from '../../api/adminClient';
import { DOC_NAME } from './names';

const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '');

// One text. Everybody can read it (with the names filled in). The supreme admin edits the draft and presses Publish: the new text then shows in every
// app and on every public web page at once. Nobody is asked to agree. Every published text is kept in the history.
export default function LegalPageEditScreen() {
    const t = useTheme();
    const { key } = useRoute().params;
    const supreme = useSupreme();
    const [d, setD] = useState(null);
    const [err, setErr] = useState('');
    const [mode, setMode] = useState('read');   // read | edit | history
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [busy, setBusy] = useState(false);
    const [confirm, setConfirm] = useState(false);
    const [old, setOld] = useState(null);

    const apply = (r) => { setD(r); setTitle(r.draft.title || ''); setBody(r.draft.body || ''); };
    const load = useCallback(async () => {
        setErr('');
        try { apply(await fetchLegalPage(key)); } catch (e) { setErr(errMsg(e)); }
    }, [key]);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    useEffect(() => { setMode('read'); }, [key]);

    const typed = d && (title !== (d.draft.title || '') || body !== (d.draft.body || ''));   // typed but not saved yet
    const run = async (fn, done) => {
        setBusy(true);
        try { const r = await fn(); if (r) apply(r); if (done) done(r); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };
    const save = () => run(() => saveLegalDraft(key, { title, body }), () => toast('Draft saved'));
    const publish = () => run(async () => { if (typed) await saveLegalDraft(key, { title, body }); return publishLegalPage(key); }, (r) => { setConfirm(false); setMode('read'); toast(`Published: version ${r.currentNo} is live`); });
    const discard = () => run(() => discardLegalDraft(key), () => toast('Changes thrown away'));
    const openOld = async (no) => { try { setOld(await fetchLegalPageVersion(key, no)); } catch (e) { toast(errMsg(e), 'error'); } };
    const useOld = () => run(() => restoreLegalVersion(key, old.no), () => { setOld(null); setMode('edit'); toast(`Version ${old.no} is now your draft. Press Publish to make it live.`); });

    const tabs = [['read', 'Read'], ...(supreme ? [['edit', 'Edit']] : []), ['history', 'History']];
    const changed = d?.draft?.changed;

    return (
        <Screen title={DOC_NAME[key]} subtitle={d ? (d.currentNo ? `Live: version ${d.currentNo}` : 'Live: built-in text') : undefined} onRefresh={load}>
            {!d && !err ? <SkeletonList /> : null}
            {err ? <ErrorBox message={err} onRetry={load} /> : null}
            {d ? (
                <>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.md }} style={{ flexGrow: 0 }}>
                        {tabs.map(([v, label]) => <Chip key={v} label={label} active={mode === v} onPress={() => setMode(v)} />)}
                    </ScrollView>

                    {mode === 'read' ? (
                        <Card>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md }}>
                                {d.current ? <Badge label={`Live since ${day(d.current.publishedAt)}`} tone="success" /> : <Badge label="Built-in text is live" />}
                                {changed ? <Badge label="Unpublished changes" tone="warn" /> : null}
                            </View>
                            {changed ? <Text style={{ color: t.muted, fontSize: font.sm, marginBottom: spacing.md }}>This is your draft, as people would see it once you publish it.</Text> : null}
                            <LegalText text={d.preview} title={d.draft.title} />
                        </Card>
                    ) : null}

                    {mode === 'edit' && supreme ? (
                        <>
                            <Text style={{ color: t.muted, fontSize: font.sm, marginBottom: spacing.md, lineHeight: 19 }}>
                                Start a line with # for a heading, - for a bullet. These names are filled in for you: {d.names.map((n) => `{{${n}}}`).join('  ')}. The operator's details come from Platform business.
                                Your changes stay private until you press Publish.
                            </Text>
                            <Field label="Title" placeholder="e.g. Terms of Service" value={title} onChangeText={setTitle} maxLength={120} />
                            <Field label="Text" placeholder="Write the full wording here…" value={body} onChangeText={setBody} multiline style={{ minHeight: 360 }} />
                            {d.blanks.length ? <Text style={{ color: t.danger, fontSize: font.sm, marginBottom: spacing.md }}>Blanks still open: {d.blanks.slice(0, 6).join(', ')}{d.blanks.length > 6 ? ' …' : ''}. Save the operator's details in Platform business, then publish.</Text> : null}
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                                <View style={{ flexGrow: 1, flexBasis: 150 }}><Button title="Save draft" icon="check" kind="soft" onPress={save} loading={busy} disabled={!typed} /></View>
                                <View style={{ flexGrow: 1, flexBasis: 150 }}><Button title="Publish…" icon="send" onPress={() => setConfirm(true)} disabled={!typed && !changed} /></View>
                            </View>
                            {changed || typed ? <View style={{ marginTop: spacing.md }}><Button title="Throw my changes away" kind="outline" onPress={discard} loading={busy} /></View> : null}
                        </>
                    ) : null}

                    {mode === 'history' ? (
                        d.versions.length ? (
                            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                                {d.versions.map((v, i) => (
                                    <ListRow key={v.no} section="platform" icon="notes" title={`Version ${v.no}${v.no === d.currentNo ? ' (live)' : ''}`} subtitle={`${day(v.publishedAt)}${v.publishedBy ? ` · ${v.publishedBy}` : ''}`} onPress={() => openOld(v.no)} last={i === d.versions.length - 1} />
                                ))}
                            </Card>
                        ) : <Text style={{ color: t.muted }}>Nothing has been published yet. The built-in text is live.</Text>
                    ) : null}

                    <Sheet visible={confirm} onClose={() => setConfirm(false)} title="Publish now?">
                        <Text style={{ color: t.muted, fontSize: font.sm, marginBottom: spacing.lg, lineHeight: 19 }}>
                            The new text shows at once in every app and on the public web page. Nobody is asked to agree. The text that is live now stays in the history, so you can bring it back.
                        </Text>
                        <Button title="Publish" icon="send" loading={busy} onPress={publish} />
                    </Sheet>

                    <Sheet visible={!!old} onClose={() => setOld(null)} title={old ? `Version ${old.no} · ${day(old.publishedAt)}` : ''}>
                        {old ? (
                            <>
                                <SheetScroll style={{ maxHeight: 420 }}><LegalText text={old.body} title={old.title} /></SheetScroll>
                                {supreme ? <View style={{ marginTop: spacing.md }}><Button title="Use this version as my draft" icon="check" kind="soft" loading={busy} onPress={useOld} /></View> : null}
                            </>
                        ) : null}
                    </Sheet>
                </>
            ) : null}
        </Screen>
    );
}
