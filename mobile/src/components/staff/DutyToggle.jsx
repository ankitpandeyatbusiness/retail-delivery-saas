// The Live switch on the cook's and the waiter's work screen, like the owner's: slide to go off duty (asks for how long) or live again.
// Only for a person who starts and ends duty by hand; one who works by the clock (the Profile page) has no switch here.
import React, { useState } from 'react';
import { LiveToggle } from '../owners/ui';
import OffDutySheet from '../common/OffDutySheet';
import { showToast } from '../customers/shop';
import { apiError } from '../../api/owners/shopApi';
import { saveDuty } from '../../api/staff/staffApi';
import { useStaffStore } from '../../store/staff/useStaffStore';
import { tr } from '../../i18n';

export default function DutyToggle() {
    const me = useStaffStore((s) => s.me);
    const [busy, setBusy] = useState(false);
    const [ask, setAsk] = useState(false);
    const status = me?.dutyStatus;
    if (!me || status === 'outside') return null;   // working by the clock: the Profile page has the hours
    const on = status === 'on';

    const set = async (online, extra = {}) => {
        setBusy(true);
        try {
            const r = await saveDuty({ online, ...extra });
            useStaffStore.getState().patchMe({ onDuty: r.onDuty, dutyStatus: r.status });
            showToast(online ? tr('You are live') : tr('You are off duty'));
        } catch (e) { showToast(apiError(e)); } finally { setBusy(false); }
    };
    const press = () => {
        if (busy) return;
        if (status === 'shop_closed') { showToast(tr('The shop is closed. You can go live when it opens.')); return; }
        if (status === 'holiday') { showToast(tr('Today is your day off.')); return; }
        if (on) setAsk(true); else set(true);
    };
    return (
        <>
            <LiveToggle on={on} busy={busy} onPress={press} />
            <OffDutySheet visible={ask} onClose={() => setAsk(false)} onPick={(extra) => set(false, extra)} />
        </>
    );
}
