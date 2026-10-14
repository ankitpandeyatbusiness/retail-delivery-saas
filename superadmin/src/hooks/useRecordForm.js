import { useCallback, useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { getRecord, createRecord, updateRecord, removeRecord } from '../api/catalogApi';
import { errMsg } from '../api/adminClient';
import { toast } from '../components/feedback';

/*
 * Create or edit one record of a catalog resource.
 *   blank        the form of a new record
 *   fromRecord   record from the server -> form values   (default: as is)
 *   toBody       form values -> what the server accepts
 *   validate     form -> { field: 'message' } (empty object = fine)
 */
export default function useRecordForm({ shopId, resource, id, blank, fromRecord = (r) => r, toBody, validate = () => ({}), label = 'Saved' }) {
    const nav = useNavigation();
    const [form, setForm] = useState(id ? null : blank);
    const [record, setRecord] = useState(null);
    const [error, setError] = useState('');
    const [errors, setErrors] = useState({});
    const [saving, setSaving] = useState(false);
    const [removing, setRemoving] = useState(false);
    const [dirty, setDirty] = useState(false);

    const load = useCallback(async () => {
        if (!id) return;
        try {
            const r = await getRecord(shopId, resource, id);
            setRecord(r);
            setForm(fromRecord(r));
            setError('');
        } catch (e) { setError(errMsg(e)); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shopId, resource, id]);
    useEffect(() => { load(); }, [load]);

    const set = useCallback((k, v) => {
        setForm((f) => ({ ...f, [k]: v }));
        setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));
        setDirty(true);
    }, []);

    const save = useCallback(async () => {
        const problems = validate(form);
        if (Object.keys(problems).length) { setErrors(problems); toast(Object.values(problems)[0], 'error'); return null; }
        setSaving(true);
        try {
            const body = toBody(form);
            const saved = id ? await updateRecord(shopId, resource, id, body) : await createRecord(shopId, resource, body);
            toast(label);
            nav.goBack();
            return saved;
        } catch (e) {
            toast(errMsg(e), 'error');
            return null;
        } finally { setSaving(false); }
    }, [form, id, shopId, resource, toBody, validate, nav, label]);

    const remove = useCallback(async () => {
        setRemoving(true);
        try {
            const r = await removeRecord(shopId, resource, id);
            toast(r.softDeleted ? 'Switched off' : 'Deleted');
            nav.goBack();
        } catch (e) { toast(errMsg(e), 'error'); throw e; } finally { setRemoving(false); }
    }, [shopId, resource, id, nav]);

    return { form, set, setForm, record, error, errors, saving, removing, dirty, save, remove, isNew: !id, reload: load };
}
