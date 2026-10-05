import React from 'react';
import { ScrollView } from 'react-native';
import Pill from '../common/Pill';
import SortPill from './SortPill';
import { useHomeStore } from '../../store/useHomeStore';
import { useFilterStore } from '../../store/useFilterStore';
import { FILTERS } from '../../config/filterMap';

export default function FilterBar() {
    const filters = useHomeStore((s) => s.config.filters);
    const active = useFilterStore((s) => s.active);
    const toggle = useFilterStore((s) => s.toggleFilter);
    const ids = filters.filter((id) => FILTERS[id]); // skip ones the app can't draw yet

    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8 }}
        >
            <SortPill />
            {ids.map((id) => (
                <Pill key={id} label={FILTERS[id].label} active={active.includes(id)} onPress={() => toggle(id)} />
            ))}
        </ScrollView>
    );
}