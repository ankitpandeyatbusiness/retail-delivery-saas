// The bulk orders that are NOT paid yet and still need the owner's eye: a request waiting for his quote ('requested', this is the one that
// blinks) and a quote he sent that waits for the customer's advance ('quoted'). In the pipeline they count in "New"; once the advance is paid the
// bulk order has a work ticket and is counted like any order. A cancelled, declined or expired one is gone from here.
// Real time: every change of a bulk order comes by the live connection ('bulk:update', whoever made it: the customer, another owner phone, the
// server's job), and a quote that runs out is dropped by a timer set for its exact time.
import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useMenuFlags } from '../../utils/owners/menuFlags';
import { bulk as bulkApi } from '../../api/owners/shopApi';
import useBulkLive from '../common/useBulkLive';

export function useBulkAwaiting() {
    const bulkOn = useMenuFlags((s) => s.bulkOn);   // the super admin's switch for Bulk orders
    const [items, setItems] = useState([]);
    const load = useCallback(() => {
        if (!bulkOn) { setItems([]); return Promise.resolve(); }
        return bulkApi.list({ status: 'open' })
            .then((r) => setItems((r.items || []).filter((x) => x.status === 'requested' || x.status === 'quoted')))   // (the view's status: a quote that ran out already says 'expired')
            .catch(() => { });
    }, [bulkOn]);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    useBulkLive(load);   // also loads when the app comes back to the front: a live message sent while the phone slept is lost

    // a sent quote has a last moment: at that moment the card goes, with nothing to ask the server
    useEffect(() => {
        const ends = items.filter((x) => x.status === 'quoted' && x.quote?.validUntil).map((x) => new Date(x.quote.validUntil).getTime()).filter((t) => t > Date.now());
        if (!ends.length) return undefined;
        const t = setTimeout(load, Math.min(...ends) - Date.now() + 500);
        return () => clearTimeout(t);
    }, [items, load]);

    return { items, needs: items.filter((x) => x.status === 'requested'), reload: load };
}
