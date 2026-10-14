import React from 'react';
import { useRoute } from '@react-navigation/native';
import { SettingsPage } from '../../components/settingsPage';
import { Group, Choice, MultiChoice, ReorderList, Switch, Hint } from '../../components/settingsForm';
import { Button } from '../../components/ui';
import { toast } from '../../components/feedback';
import useSettingsEditor from '../../hooks/useSettingsEditor';
import { choices, nameOf, fullBlockList } from '../../utils/settings';

// The home screen of the customer app: what kind of shop, food mode, which blocks in which order, filters, cards.
export default function SettingsHomeScreen() {
    const { shopId, name } = useRoute().params;
    const ed = useSettingsEditor(shopId, ['home']);
    const h = ed.draft?.home;

    const useTemplate = () => {
        const p = ed.presets?.restaurant;
        if (!p) { toast('No template for this type', 'error'); return; }
        ed.set('home', 'foodMode', p.foodMode);
        ed.set('home', 'blocks', fullBlockList(p.blocks, ed.options.BLOCK_TYPES));
        ed.set('home', 'filters', p.filters);
        ed.set('home', 'sortOptions', p.sortOptions);
        ed.set('home', 'cardStyle', p.cardStyle);
        ed.set('home', 'itemOptions', { sizes: false, addOns: false, spiceLevel: false, weightOptions: false, ...p.itemOptions });
        toast('Template applied. Review and save.');
    };

    return (
        <SettingsPage ed={ed} title="Home layout" subtitle={name} preview>
            {ed.ready ? (
                <>
                    <Group title="Start again" section="catalog">
                        <Button title="Reset layout to the restaurant template" kind="soft" small icon="sparkle" onPress={useTemplate} />
                        <Hint>Sets food mode, blocks, filters, sorting and card style in one go. You can still change each one below.</Hint>
                    </Group>

                    <Group title="Food mode" section="catalog">
                        <Choice
                            options={choices('foodMode', ed.options.FOOD_MODES)}
                            value={h.foodMode}
                            onChange={(v) => ed.set('home', 'foodMode', v)}
                            last
                        />
                        <Hint>
                            Veg + non-veg shows the veg switch and the green / red dots. Pure veg and eggless shops hide them and the "Veg only" filter.
                        </Hint>
                    </Group>

                    <Group title="Home blocks" section="catalog" hint="Top to bottom. Switch a block off to hide it. 'All items' always stays.">
                        <ReorderList
                            section="catalog"
                            items={h.blocks.map((b) => ({ key: b.type, label: nameOf('block', b.type), enabled: b.enabled, locked: b.type === 'items' }))}
                            onChange={(next) => ed.set('home', 'blocks', next.map((i) => ({ type: i.key, enabled: i.enabled !== false })))}
                        />
                    </Group>

                    <Group title="Filters and sorting" section="catalog">
                        <MultiChoice
                            label="Filter chips"
                            hint="Up to 12"
                            options={choices('filter', ed.options.FILTER_IDS)}
                            value={h.filters}
                            max={12}
                            onChange={(v) => ed.set('home', 'filters', v)}
                        />
                        <MultiChoice
                            label="Sort options"
                            hint="At least 1"
                            options={choices('sort', ed.options.SORT_IDS)}
                            value={h.sortOptions}
                            min={1}
                            onChange={(v) => ed.set('home', 'sortOptions', v)}
                            last
                        />
                    </Group>

                    <Group title="Dish cards" section="catalog">
                        <Choice label="Card style" options={choices('cardStyle', ed.options.CARD_STYLES)} value={h.cardStyle} onChange={(v) => ed.set('home', 'cardStyle', v)} />
                    </Group>

                    <Group title="Dish options" section="catalog" hint="What customers can choose on a dish" flush>
                        {['sizes', 'addOns', 'spiceLevel', 'weightOptions'].map((k, i, a) => (
                            <Switch
                                key={k}
                                title={nameOf('itemOption', k)}
                                value={!!h.itemOptions[k]}
                                onValueChange={(v) => ed.set('home', 'itemOptions', { ...h.itemOptions, [k]: v })}
                                last={i === a.length - 1}
                            />
                        ))}
                    </Group>
                </>
            ) : null}
        </SettingsPage>
    );
}
