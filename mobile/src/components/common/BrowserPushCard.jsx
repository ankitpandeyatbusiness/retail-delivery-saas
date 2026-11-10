// "Also notify me on this browser": on the WEBSITE only, at the top of every panel's Alerts screen. Off until the person switches it on.
// The phone app is told first; this adds the same alert here. Hidden on the phone app and when the server has no browser push set up.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Platform } from 'react-native';
import { useBrand } from './kit';
import { Card } from '../owners/ui';
import SlideSwitch from './SlideSwitch';
import { showToast } from '../customers/shop';
import { webPushStatus, enableWebPush, disableWebPush } from '../../utils/common/webPush';
import { tr } from '../../i18n';

export default function BrowserPushCard() {
    const { text, muted } = useBrand();
    const [st, setSt] = useState(null);
    const [busy, setBusy] = useState(false);
    const load = useCallback(async () => { setSt(await webPushStatus()); }, []);
    useEffect(() => { if (Platform.OS === 'web') load(); }, [load]);

    if (Platform.OS !== 'web' || !st || !st.supported || !st.publicKey) return null;

    const on = st.enabled && st.subscribed && st.permission === 'granted';
    const blocked = st.permission === 'denied';
    const locked = busy || st.homeScreen || st.noWorker || blocked;
    const toggle = async (v) => {
        if (locked) return;
        setBusy(true);
        try {
            if (v) await enableWebPush(); else await disableWebPush();
        } catch (e) { showToast(e && e.safe ? tr(e.message) : tr('Could not change this. Try again.')); }
        await load();
        setBusy(false);
    };

    let note = tr('Your phone app is told first. Switch this on to get the same alerts here on this browser too.');
    if (st.homeScreen) note = tr('On iPhone, first add this website to your Home Screen (Share, then Add to Home Screen), then open it from there and switch this on.');
    else if (st.noWorker) note = tr('Not available in this window. Open the website normally (not while testing) to switch this on.');
    else if (blocked) note = tr('Notifications are blocked for this website. Allow them in the address bar of your browser, then switch this on.');

    return (
        <Card style={{ marginTop: 8, paddingVertical: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ color: text, fontWeight: '900', fontSize: 15, flex: 1 }}>{tr('Also notify me on this browser')}</Text>
                <SlideSwitch value={on} onValueChange={toggle} accessibilityLabel={tr('Also notify me on this browser')} disabled={locked} />
            </View>
            <Text style={{ color: muted, fontSize: 12, marginTop: 4, lineHeight: 17 }}>{note}</Text>
        </Card>
    );
}
