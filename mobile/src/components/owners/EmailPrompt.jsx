// The owner's email is needed: the platform sends bills and official documents there. When it is missing, this sheet asks for it
// (and the code mailed to it) and cannot be closed until the address is confirmed. Checked a moment after the panel opens and
// when the app returns to the front.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import EmailVerifySheet from './EmailVerifySheet';
import { fetchProfile } from '../../api/owners/shopApi';
import { tr } from '../../i18n';

export default function EmailPrompt() {
    const [missing, setMissing] = useState(false);
    const checking = useRef(false);

    const check = useCallback(async () => {
        if (checking.current) return;
        checking.current = true;
        try { const p = await fetchProfile(); setMissing(!!p.emailRequired); } catch (e) { /* the panel works without it */ } finally { checking.current = false; }
    }, []);
    useEffect(() => {
        const t = setTimeout(check, 1500);
        const sub = AppState.addEventListener('change', (st) => { if (st === 'active') check(); });
        return () => { clearTimeout(t); sub.remove(); };
    }, [check]);

    return <EmailVerifySheet visible={missing} required title={tr('Add your email')} onDone={() => setMissing(false)} />;
}
