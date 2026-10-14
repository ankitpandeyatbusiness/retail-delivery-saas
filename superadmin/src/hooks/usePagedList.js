import { useCallback, useEffect, useRef, useState } from 'react';
import { errMsg } from '../api/adminClient';

/*
 * A list that loads page by page.
 *   fetchPage(page) -> { items, total?, hasMore?, page }
 * It reloads from page 1 whenever `deps` change, and ignores answers of an older request.
 */
export default function usePagedList(fetchPage, deps = []) {
    const [items, setItems] = useState([]);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);
    const [total, setTotal] = useState(null);
    const [state, setState] = useState('loading');   // loading | ready | error
    const [more, setMore] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState('');
    const seq = useRef(0);
    const fetchRef = useRef(fetchPage);
    fetchRef.current = fetchPage;

    const load = useCallback(async (p = 1, { silent = false } = {}) => {
        const mine = ++seq.current;
        if (p === 1 && !silent) setState((s) => (s === 'ready' ? s : 'loading'));
        if (p > 1) setMore(true);
        try {
            const r = await fetchRef.current(p);
            if (mine !== seq.current) return;
            setItems((cur) => (p === 1 ? r.items : [...cur, ...r.items]));
            setPage(p);
            setTotal(r.total ?? null);
            setHasMore(r.hasMore ?? (r.total !== undefined ? p * (r.limit || r.items.length || 1) < r.total : false));
            setState('ready');
            setError('');
        } catch (e) {
            if (mine !== seq.current) return;
            if (p === 1) { setError(errMsg(e)); setState('error'); }
        } finally {
            if (mine === seq.current) { setMore(false); setRefreshing(false); }
        }
    }, []);

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { const id = setTimeout(() => load(1), 0); return () => clearTimeout(id); }, deps);

    return {
        items, total, state, error, more, hasMore, refreshing,
        reload: () => load(1),
        refresh: () => { setRefreshing(true); load(1, { silent: true }); },
        silentReload: () => load(1, { silent: true }),
        loadMore: () => { if (hasMore && !more) load(page + 1); },
        setItems,
    };
}
