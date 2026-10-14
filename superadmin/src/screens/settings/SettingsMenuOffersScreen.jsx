import React from 'react';
import { useRoute } from '@react-navigation/native';
import { SettingsPage } from '../../components/settingsPage';
import { Group, Choice, Switch } from '../../components/settingsForm';
import useSettingsEditor from '../../hooks/useSettingsEditor';
import { choices } from '../../utils/settings';

export default function SettingsMenuOffersScreen() {
    const { shopId, name } = useRoute().params;
    const ed = useSettingsEditor(shopId, ['menu', 'offers']);

    return (
        <SettingsPage ed={ed} title="Menu and offers" subtitle={name} preview>
            {ed.ready ? (
                <>
                    <Group title="Menu" section="catalog">
                        <Choice
                            label="Dishes that are out of stock"
                            options={choices('outOfStock', ed.options.OUT_OF_STOCK)}
                            value={ed.draft.menu.outOfStock}
                            onChange={(v) => ed.set('menu', 'outOfStock', v)}
                        />
                        <Switch
                            title="Group dishes by category"
                            subtitle="Headings between categories on the menu"
                            value={!!ed.draft.menu.groupByCategory}
                            onValueChange={(v) => ed.set('menu', 'groupByCategory', v)}
                            last
                        />
                    </Group>
                    <Group title="Offers" section="money" flush>
                        <Switch
                            title="Coupons"
                            subtitle="Switch off to hide every coupon and the Offers tab"
                            value={!!ed.draft.offers.couponsEnabled}
                            onValueChange={(v) => ed.set('offers', 'couponsEnabled', v)}
                        />
                        <Switch title="Show offers on home" value={!!ed.draft.offers.showOnHome} onValueChange={(v) => ed.set('offers', 'showOnHome', v)} />
                        <Switch title="Show offers in the cart" value={!!ed.draft.offers.showInCart} onValueChange={(v) => ed.set('offers', 'showInCart', v)} last />
                    </Group>
                </>
            ) : null}
        </SettingsPage>
    );
}
