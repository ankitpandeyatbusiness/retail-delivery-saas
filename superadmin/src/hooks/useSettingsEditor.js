import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { useShopStore } from '../store/useShopStore';
import { useShopsStore } from '../store/useShopsStore';
import { useOptionsStore } from '../store/useOptionsStore';
import { updateShop, previewConfig } from '../api/shopsApi';
import { errMsg } from '../api/adminClient';
import { toast } from '../components/feedback';
import { effectiveSettings, buildSettings, clone } from '../utils/settings';

/*
 * One editor for any group of settings sections.
 *
 *   const ed = useSettingsEditor(shopId, ['orders']);
 *   ed.draft.orders.minOrder          current value (saved, or the default)
 *   ed.set('orders', 'minOrder', 100) change one key
 *   ed.dirty / ed.save()              only the changed keys are put into the saved settings
 *   ed.preview                        what the customer app would receive (server answer, refreshed after edits)
 *
 * The backend replaces the whole `settings` document, so save() sends the saved document with the changes inside.
 * fixPatches(patches, { defaults }) may clean the changes before they are sent (for example blank text -> default).
 */
export default function useSettingsEditor(shopId, sections, { fixPatches } = {}) {
    const nav = useNavigation();
    const rec = useShopStore((s) => s.byId[shopId]);
    const { options, defaults, presets, error: optError } = useOptionsStore();
    const [draft, setDraft] = useState(null);
    const [dirtyKeys, setDirtyKeys] = useState({});
    const [saving, setSaving] = useState(false);
    const [errors, setErrors] = useState([]);
    const [preview, setPreview] = useState(null);
    const seq = useRef(0);

    useEffect(() => {
        if (!rec) useShopStore.getState().load(shopId);
        useOptionsStore.getState().load();
    }, [shopId, rec]);

    const effective = useMemo(
        () => (rec && options ? effectiveSettings({ tenant: rec.tenant, resolved: rec.resolved, options, defaults, presets }) : null),
        [rec, options, defaults, presets],
    );

    // fill the draft once, when the data first arrives
    useEffect(() => {
        if (effective && !draft) {
            const d = {};
            for (const sec of sections) d[sec] = clone(effective[sec]);
            setDraft(d);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [effective]);

    // 'tabs' is a plain list: set('tabs', null, newList). Everything else: set('orders', 'minOrder', 100)
    const set = useCallback((section, key, value) => {
        setDraft((d) => {
            if (key === null) return { ...d, [section]: value };
            return { ...d, [section]: { ...d[section], [key]: value } };
        });
        setDirtyKeys((k) => ({ ...k, [section]: { ...(k[section] || {}), [key === null ? '*' : key]: true } }));
        setErrors([]);
    }, []);

    const patches = useMemo(() => {
        if (!draft) return {};
        const p = {};
        for (const [section, keys] of Object.entries(dirtyKeys)) {
            if (keys['*']) p[section] = draft[section];
            else p[section] = Object.fromEntries(Object.keys(keys).map((k) => [k, draft[section][k]]));
        }
        return p;
    }, [draft, dirtyKeys]);

    const dirty = Object.keys(dirtyKeys).length > 0;
    const settingsNow = useMemo(() => {
        if (!rec) return null;
        return buildSettings(rec.tenant.settings, fixPatches ? fixPatches(patches, { defaults }) : patches);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rec, patches, defaults]);

    // live preview: ask the server what the app would get for this draft (waits until typing pauses)
    useEffect(() => {
        if (!rec || !draft) return undefined;
        const mine = ++seq.current;
        const t = rec.tenant;
        const id = setTimeout(async () => {
            try {
                const r = await previewConfig({
                    name: t.name, tagline: t.tagline, logo: t.logo, colors: t.colors, phone: t.phone, address: t.address,
                    delivery: t.delivery, business: t.business, settings: settingsNow,
                });
                if (mine === seq.current) { setPreview(r.config); setErrors(r.errors || []); }
            } catch (e) { /* the preview is a help, not a must */ }
        }, dirty ? 450 : 0);
        return () => clearTimeout(id);
    }, [rec, draft, settingsNow, dirty]);

    const save = useCallback(async () => {
        if (!dirty || saving) return false;
        setSaving(true);
        try {
            const r = await updateShop(shopId, { settings: settingsNow });
            useShopStore.getState().setTenant(shopId, r.tenant);
            useShopStore.getState().load(shopId, { quiet: true });
            useShopsStore.getState().patch(shopId, {});
            toast('Saved');
            nav.goBack();
            return true;
        } catch (e) {
            toast(errMsg(e), 'error');
            if (e?.response?.data?.errors) setErrors(e.response.data.errors);
            return false;
        } finally { setSaving(false); }
    }, [dirty, saving, shopId, settingsNow, nav]);

    return {
        ready: !!draft && !!options,
        error: optError,
        rec, options, defaults, presets,
        draft, set, dirty, save, saving, errors, preview,
    };
}
