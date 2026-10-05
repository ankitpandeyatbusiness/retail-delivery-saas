import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchProducts } from '../api/catalogApi';
import { useFilterStore } from '../store/useFilterStore';
import { useHomeStore } from '../store/useHomeStore';
import { FILTERS } from '../config/filterMap';

export default function useProducts() {
    const category = useFilterStore((s) => s.category);
    const active = useFilterStore((s) => s.active);
    const sort = useFilterStore((s) => s.sort);
    const defaultSort = useHomeStore((s) => s.config.sortOptions[0]);

    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [hasMore, setHasMore] = useState(false);
    const [error, setError] = useState(null);

    const page = useRef(1);
    const busy = useRef(false);
    const requestId = useRef(0);

    const params = useMemo(() => {
        const p = { sort: sort || defaultSort, limit: 20 };
        if (category) p.category = category;
        active.forEach((id) => Object.assign(p, FILTERS[id]?.params));
        return p;
    }, [category, active, sort, defaultSort]);

    const load = useCallback(async (reset) => {
        if (reset) {
            requestId.current += 1;
            page.current = 1;
            busy.current = false;
        }
        if (busy.current) return;
        const myId = requestId.current;
        busy.current = true;
        setLoading(true);
        setError(null);
        try {
            const data = await fetchProducts({ ...params, page: page.current });
            if (myId !== requestId.current) return; // a newer request replaced this one
            setItems((prev) => (reset ? data.items : [...prev, ...data.items]));
            setHasMore(data.hasMore);
            page.current += 1;
        } catch (e) {
            if (myId === requestId.current) setError('Could not load items');
        } finally {
            if (myId === requestId.current) {
                busy.current = false;
                setLoading(false);
            }
        }
    }, [params]);

    useEffect(() => { load(true); }, [load]);

    const loadMore = useCallback(() => {
        if (hasMore && !busy.current) load(false);
    }, [hasMore, load]);

    const reload = useCallback(() => load(true), [load]);

    return { items, loading, error, loadMore, reload };
}