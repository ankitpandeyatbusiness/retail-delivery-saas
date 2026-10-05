import React from 'react';
import Pill from '../common/Pill';
import { useHomeStore } from '../../store/useHomeStore';
import { useFilterStore } from '../../store/useFilterStore';
import { SORT_LABELS } from '../../config/filterMap';

export default function SortPill() {
    const options = useHomeStore((s) => s.config.sortOptions);
    const sort = useFilterStore((s) => s.sort);
    const setSort = useFilterStore((s) => s.setSort);
    if (options.length < 2) return null;

    const current = options.includes(sort) ? sort : options[0];
    const next = () => setSort(options[(options.indexOf(current) + 1) % options.length]);

    return <Pill label={`Sort: ${SORT_LABELS[current]}`} active={false} onPress={next} />;
}