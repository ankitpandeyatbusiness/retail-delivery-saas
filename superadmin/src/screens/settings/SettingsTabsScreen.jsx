import React, { useEffect, useState } from 'react';
import { useRoute } from '@react-navigation/native';
import { SettingsPage } from '../../components/settingsPage';
import { Group, ReorderList, Hint } from '../../components/settingsForm';
import { toast } from '../../components/feedback';
import useSettingsEditor from '../../hooks/useSettingsEditor';
import { nameOf } from '../../utils/settings';

// The bottom bar of the customer app: which tabs, and in which order. "Home" is always there; 2 to 5 tabs.
export default function SettingsTabsScreen() {
    const { shopId, name } = useRoute().params;
    const ed = useSettingsEditor(shopId, ['tabs']);
    const [items, setItems] = useState(null);

    useEffect(() => {
        if (ed.ready && !items) {
            const on = ed.draft.tabs;
            const all = ed.options.TABS || on;
            setItems([...on, ...all.filter((x) => !on.includes(x))].map((key) => ({ key, label: nameOf('tab', key), enabled: on.includes(key), locked: key === 'home' })));
        }
    }, [ed.ready, ed.draft, ed.options, items]);

    const change = (next) => {
        const on = next.filter((i) => i.enabled).map((i) => i.key);
        if (on.length < 2) { toast('The app needs at least 2 tabs', 'error'); return; }
        setItems(next);
        ed.set('tabs', null, on);
    };

    return (
        <SettingsPage ed={ed} title="Bottom tabs" subtitle={name} preview>
            {items ? (
                <Group title="Tabs" hint="Use the arrows to reorder. Switch a tab off to hide it.">
                    <ReorderList items={items} onChange={change} />
                    <Hint>The Offers tab is also hidden while coupons are switched off (Menu and offers).</Hint>
                </Group>
            ) : null}
        </SettingsPage>
    );
}
