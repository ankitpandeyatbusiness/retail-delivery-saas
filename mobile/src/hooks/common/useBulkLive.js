// Keeps a bulk screen current: when any bulk order changes (the cook started it, the customer paid, the shop quoted...) the screen loads again by itself.
// id = only that bulk order (a detail screen); without it, any bulk order (a list). Several messages close together make one load. Also loads when the
// app comes back to the front, because a message sent while the phone slept is lost.
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { onBulkUpdate } from '../../api/common/socket';

export default function useBulkLive(load, id) {
    useEffect(() => {
        let timer = null;
        const soon = () => { clearTimeout(timer); timer = setTimeout(() => load(), 300); };
        const off = onBulkUpdate((p) => { if (!id || String(p?.bulkId) === String(id)) soon(); });
        const app = AppState.addEventListener('change', (st) => { if (st === 'active') soon(); });
        return () => { off(); app.remove(); clearTimeout(timer); };
    }, [load, id]);
}
