import React, { useCallback, useState } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Segmented } from '../../components/inputs';
import { Card, Button } from '../../components/ui';
import { SkeletonList } from '../../components/blocks';
import { Empty, ErrorBox, toast } from '../../components/feedback';
import { HandleBar } from '../../components/HandledBits';
import { fetchAttentionList } from '../../api/handledApi';
import { retryRefund } from '../../api/ordersApi';
import { errMsg } from '../../api/adminClient';
import { rupeesFromPaise, ago } from '../../utils/format';
import { goTab } from '../../navigation/goTo';

// One Needs attention list of the Money tab opened: every record with its reason, a button to the place that fixes it,
// and "Mark as handled" (with a note, taken back for 10 minutes) for what you sorted out by hand.
export default function MoneyAttentionScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const { key, title } = useRoute().params;
    const [tab, setTab] = useState('open');
    const [d, setD] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState('');

    const load = useCallback(async () => {
        try { setD(await fetchAttentionList(key)); setError(''); } catch (e) { setError(errMsg(e)); }
    }, [key]);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    const open = (o) => {
        if (!o) return;
        if (o.tab) goTab(nav, o.tab, { screen: o.screen, params: o.params }); else nav.navigate(o.screen, o.params);
    };
    const again = async (r) => {
        setBusy(r.id);
        try {
            const res = await retryRefund(r.retry.refundId);
            toast(res.status === 'failed' ? (res.lastError || 'Still failed') : 'Refund sent again', res.status === 'failed' ? 'error' : 'ok');
            await load();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(''); }
    };

    const rows = d ? (tab === 'open' ? d.open : d.handled) : [];
    return (
        <Screen title={title || 'Needs attention'} subtitle="Each one with the reason" onRefresh={load}>
            <Segmented value={tab} onChange={setTab} options={[{ value: 'open', label: `Open${d ? ` · ${d.open.length}` : ''}` }, { value: 'handled', label: `Handled${d ? ` · ${d.handled.length}` : ''}` }]} />
            <View style={{ marginTop: spacing.md }}>
                {!d ? (error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList />)
                    : !rows.length ? <Empty icon="ok" title={tab === 'open' ? 'Nothing left here' : 'Nothing marked yet'} hint={tab === 'open' ? 'Everything in this list is sorted out or marked handled.' : 'What you mark as handled by hand appears here.'} />
                    : rows.map((r) => (
                        <Card key={r.id} style={{ marginBottom: spacing.md }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Text style={{ flex: 1, color: t.text, fontWeight: '800', fontSize: font.md, paddingRight: spacing.sm }} numberOfLines={2}>{r.title}</Text>
                                {r.paise ? <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }}>{rupeesFromPaise(r.paise)}</Text> : null}
                            </View>
                            {r.detail ? <Text style={{ color: tab === 'open' ? t.danger : t.muted, fontSize: font.sm, marginTop: 4 }}>{r.detail}</Text> : null}
                            {r.at ? <Text style={{ color: t.muted, fontSize: font.xs, marginTop: 2 }}>{ago(r.at)}</Text> : null}
                            {tab === 'open' ? (
                                <View style={{ marginTop: spacing.sm }}>
                                    {r.retry ? <Button small title="Send again" icon="next" loading={busy === r.id} onPress={() => again(r)} style={{ marginBottom: spacing.sm }} /> : null}
                                    {r.open ? <Button small kind="outline" title="Open" icon="next" onPress={() => open(r.open)} /> : null}
                                </View>
                            ) : null}
                            <HandleBar kind={d.kind} refId={r.id} title={r.title} mark={r.mark} onChanged={load} />
                        </Card>
                    ))}
            </View>
        </Screen>
    );
}
