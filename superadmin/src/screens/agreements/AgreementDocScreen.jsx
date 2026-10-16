import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Badge, Button, Chip, SectionTitle, ListRow } from '../../components/ui';
import { Field } from '../../components/inputs';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox, Sheet, toast } from '../../components/feedback';
import LegalText from '../../components/LegalText';
import { useSupreme } from '../../hooks/useSupreme';
import { fetchAgreement, fetchAcceptances, fetchAgreementVersion, saveAgreementDraft, sendAgreement, setLegalRole } from '../../api/legalApi';
import { fetchTeam } from '../../api/teamApi';
import { errMsg } from '../../api/adminClient';
import { DOC_NAME, DOC_FOR } from './names';

const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '');
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }) : '');
const filled = (body, vars) => Object.entries(vars || {}).reduce((txt, [k, v]) => txt.split(`{{${k}}}`).join(v), body || '');

// One document. Read it; the supreme admin can also edit the draft, send it as a new version, and see who agreed.
export default function AgreementDocScreen() {
    const t = useTheme();
    const { key } = useRoute().params;
    const supreme = useSupreme();
    const [d, setD] = useState(null);
    const [acc, setAcc] = useState(null);
    const [err, setErr] = useState('');
    const [mode, setMode] = useState('read');   // read | draft | who | history
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [busy, setBusy] = useState(false);
    const [sendOpen, setSendOpen] = useState(false);
    const [summary, setSummary] = useState('');
    const [askWhen, setAskWhen] = useState('now');
    const [oldDoc, setOldDoc] = useState(null);
    const [team, setTeam] = useState(null);

    const load = useCallback(async () => {
        setErr('');
        try {
            const r = await fetchAgreement(key);
            setD(r); setTitle(r.draft.title || ''); setBody(r.draft.body || '');
            if (r.currentVersion) fetchAcceptances(key).then(setAcc).catch(() => { });
            if (key === 'operator_agreement' || key === 'team_terms') fetchTeam().then((x) => setTeam(x.items || x)).catch(() => { });
        } catch (e) { setErr(errMsg(e)); }
    }, [key]);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    useEffect(() => { setMode('read'); }, [key]);

    const saveDraft = async () => {
        setBusy(true);
        try { setD(await saveAgreementDraft(key, { title, body })); toast('Draft saved'); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };
    const send = async () => {
        setBusy(true);
        try {
            const r = await sendAgreement(key, { summary: summary.trim() || undefined, askWhen: key === 'owner_terms' ? askWhen : undefined });
            toast(`Version ${r.currentVersion} sent`); setSendOpen(false); setSummary(''); setMode('read'); load();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };
    const openOld = async (no) => { try { setOldDoc(await fetchAgreementVersion(key, no)); } catch (e) { toast(errMsg(e), 'error'); } };
    const pickRole = async (a, role) => {
        try {
            await setLegalRole(a.id, role);
            toast(role === 'partner' ? `${a.name || 'This person'} now gets the operating agreement` : 'Back to the administrators’ terms');
            fetchTeam().then((x) => setTeam(x.items || x));
        } catch (e) { toast(errMsg(e), 'error'); }
    };

    const name = DOC_NAME[key];
    const tabs = [['read', 'Read'], ...(supreme ? [['draft', 'Edit draft']] : []), ['who', 'Who agreed'], ['history', 'Old versions']];
    const cur = d?.current;
    // the title is shown once, in the header; the text starts straight after it
    const shown = cur ? cur.body : filled(d?.draft?.body, d?.variables);

    return (
        <Screen title={name} subtitle={d ? (d.currentVersion ? `Version ${d.currentVersion}` : 'Not sent yet') : undefined} onRefresh={load}>
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
                                <Badge label={`For ${DOC_FOR[key]}`} />
                                {cur ? <Badge label={`Sent ${day(cur.publishedAt)}`} tone="success" /> : <Badge label={supreme ? 'Draft: not sent yet' : 'Not sent yet'} tone="warn" />}
                                {cur?.operatorName ? <Badge label={cur.operatorName} /> : null}
                            </View>
                            {cur?.summary ? <Text style={{ color: t.text, fontWeight: '700', marginBottom: spacing.md }}>What is new: {cur.summary}</Text> : null}
                            {!cur && !supreme ? <Text style={{ color: t.muted }}>This has not been sent yet.</Text> : <LegalText text={shown} title={d.draft.title} />}
                        </Card>
                    ) : null}

                    {mode === 'draft' && supreme ? (
                        <>
                            <Text style={{ color: t.muted, fontSize: font.sm, marginBottom: spacing.md, lineHeight: 19 }}>
                                Words in {'{{double braces}}'} are filled in when you send (operator, platform name, ratios). Words in [square brackets] are blanks you must replace first. Start a line with “# ” for a heading, “- ” for a bullet, “1. ” for a numbered line.
                            </Text>
                            <Field label="Title" value={title} onChangeText={setTitle} maxLength={120} />
                            <Field label="Text" value={body} onChangeText={setBody} multiline style={{ minHeight: 360 }} />
                            {d.blanks.length ? <Text style={{ color: t.danger, fontSize: font.sm, marginBottom: spacing.md }}>Blanks still to fill: {d.blanks.slice(0, 6).join(', ')}{d.blanks.length > 6 ? ' …' : ''}</Text> : null}
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                                <View style={{ flexGrow: 1, flexBasis: 150 }}><Button title="Save draft" icon="check" kind="soft" onPress={saveDraft} loading={busy} /></View>
                                <View style={{ flexGrow: 1, flexBasis: 150 }}><Button title="Send new version…" icon="send" onPress={() => setSendOpen(true)} /></View>
                            </View>
                        </>
                    ) : null}

                    {mode === 'who' ? (
                        <>
                            {!d.currentVersion ? <Text style={{ color: t.muted }}>Nothing has been sent yet.</Text> : !acc ? <SkeletonList /> : (
                                <>
                                    <SectionTitle section="orders">Agreed ({acc.agreed.length})</SectionTitle>
                                    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                                        {acc.agreed.length ? acc.agreed.map((p, i) => <ListRow key={p.id} section="people" icon="ok" title={p.name || p.phone || 'Person'} subtitle={`Version ${acc.version} · ${when(p.at)}`} last={i === acc.agreed.length - 1} />) : <Text style={{ color: t.muted, paddingVertical: spacing.md }}>Nobody yet.</Text>}
                                    </Card>
                                    <SectionTitle section="alerts">Waiting ({acc.waiting.length})</SectionTitle>
                                    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                                        {acc.waiting.length ? acc.waiting.map((p, i) => <ListRow key={p.id} section="alerts" icon="clock" title={p.name || p.phone || 'Person'} subtitle={[p.shop, p.phone].filter(Boolean).join(' · ')} last={i === acc.waiting.length - 1} />) : <Text style={{ color: t.muted, paddingVertical: spacing.md }}>Nobody is waiting.</Text>}
                                    </Card>
                                    {(d.audience === 'owner' || d.audience === 'rider') ? <Text style={{ color: t.muted, fontSize: font.sm, marginTop: spacing.sm }}>Only shops marked as handed over are counted.</Text> : null}
                                </>
                            )}
                            {supreme && (key === 'operator_agreement' || key === 'team_terms') && team ? (
                                <>
                                    <SectionTitle section="people">Who is the operator partner?</SectionTitle>
                                    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                                        {team.filter((a) => a.isActive !== false && !a.isMe).map((a, i, all) => (
                                            <ListRow
                                                key={a.id} section="people" icon="user" title={a.name || 'Superadmin'} subtitle={a.legalRole === 'partner' ? 'Gets the operating agreement' : 'Gets the administrators’ terms'}
                                                right={<Chip label={a.legalRole === 'partner' ? 'Partner' : 'Make partner'} active={a.legalRole === 'partner'} onPress={() => pickRole(a, a.legalRole === 'partner' ? 'team' : 'partner')} />}
                                                last={i === all.length - 1}
                                            />
                                        ))}
                                        {!team.filter((a) => !a.isMe).length ? <Text style={{ color: t.muted, paddingVertical: spacing.md }}>Add the other superadmin in More, Superadmin team first.</Text> : null}
                                    </Card>
                                </>
                            ) : null}
                        </>
                    ) : null}

                    {mode === 'history' ? (
                        d.versions.length ? (
                            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                                {[...d.versions].reverse().map((v, i, all) => (
                                    <ListRow key={v.no} section="platform" icon="notes" title={`Version ${v.no}`} subtitle={`${day(v.publishedAt)}${v.summary ? ` · ${v.summary}` : ''}`} onPress={() => openOld(v.no)} last={i === all.length - 1} />
                                ))}
                            </Card>
                        ) : <Text style={{ color: t.muted }}>No version has been sent yet.</Text>
                    ) : null}

                    <Sheet visible={sendOpen} onClose={() => setSendOpen(false)} title="Send new version">
                        <Text style={{ color: t.muted, fontSize: font.sm, marginBottom: spacing.md, lineHeight: 19 }}>
                            Everybody it is for is asked to agree on their second visit. Owners and riders only once their shop is marked as handed over. A sent version cannot be taken back; you can send a newer one.
                        </Text>
                        <Field label="What changed (shown to them, optional)" value={summary} onChangeText={setSummary} maxLength={300} />
                        {key === 'owner_terms' ? (
                            <View style={{ marginBottom: spacing.lg }}>
                                <Text style={{ color: t.text, fontWeight: '600', marginBottom: 6 }}>When to ask shop owners</Text>
                                <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
                                    <Chip label="On their second visit" active={askWhen === 'now'} onPress={() => setAskWhen('now')} />
                                    <Chip label="When the free period ends" active={askWhen === 'free_ends'} onPress={() => setAskWhen('free_ends')} />
                                </View>
                            </View>
                        ) : null}
                        <Button title="Send" icon="send" loading={busy} onPress={send} />
                    </Sheet>

                    <Sheet visible={!!oldDoc} onClose={() => setOldDoc(null)} title={oldDoc ? `Version ${oldDoc.no}` : ''}>
                        {oldDoc ? <ScrollView style={{ maxHeight: 460 }}><LegalText text={oldDoc.body} title={oldDoc.title} /></ScrollView> : null}
                    </Sheet>
                </>
            ) : null}
        </Screen>
    );
}
