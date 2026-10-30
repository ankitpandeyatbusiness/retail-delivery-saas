// Shows the sliders (components/common/AlertSlider.jsx) for the owner, the cook, the waiter and the rider: one at a time, for any alert whose Slider
// switch is on (Alerts screen). The cook's and the waiter's live alerts (utils/staff/staffSound.js) and every notification that arrives while the app
// is open come here. New orders, the kitchen's problems and the customer's asks have their own bigger sheets and are not shown here.
import React, { useEffect } from 'react';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { useAlertPrefs, alertOn, alertGroup, alertSeconds } from '../../store/common/useAlertPrefs';
import { useSliderStore } from '../../store/common/useSliderStore';
import { onNotification } from '../../api/common/socket';
import { ownerRoute } from '../../utils/owners/notificationRoute';
import { themedAlert } from './dialog';
import { showToast } from '../customers/shop';
import { decideStaffLeave, decideLeave, apiError, booking as bookingApi } from '../../api/owners/shopApi';
import AlertSlider from './AlertSlider';
import { tr } from '../../i18n';

const shownOnce = new Set();   // catch-up sliders (an alert that arrived while the app was closed) are shown once, not on every return to the app

const OWN_SHEET = ['order_new', 'order_unaccepted_reminder', 'order_cancelled', 'kitchen_problem', 'pickup_time_request', 'order_cancel_request'];

// Turns this alert's slider off for good; if its voice is on, asks whether that should go too.
export async function turnOffSlider(type) {
    const g = alertGroup(type);
    if (!g) return;
    const prefs = useAlertPrefs.getState();
    if (!(await prefs.change(g.id, { p: false }))) { showToast(tr('Could not save. Try again.')); return; }
    if (alertOn(type, 'v')) {
        themedAlert(tr('Also turn off the voice?'), tr('{name} will no longer be read out.', { name: tr(g.label) }), [
            { text: tr('Keep the voice'), style: 'cancel', onPress: () => showToast(tr('Slider turned off for good. You can turn it on again in Alerts.')) },
            { text: tr('Turn off the voice'), onPress: async () => { await prefs.change(g.id, { v: false }); showToast(tr('Slider and voice turned off for good. You can turn them on again in Alerts.')); } },
        ], { icon: 'volume-mute-outline' });
    } else showToast(tr('Slider turned off for good. You can turn it on again in Alerts.'));
}

// a slider for one alert, if its Slider switch is on
export function showSlider({ key, type, title, body, data, once }) {
    if (!type || !alertOn(type, 'p')) return;
    if (!String(title || '').trim() && !String(body || '').trim()) return;   // a slider with nothing to say is never shown
    if (once) {
        if (shownOnce.has(String(key))) return;
        shownOnce.add(String(key));
        if (shownOnce.size > 200) shownOnce.delete(shownOnce.values().next().value);
    }
    const sec = alertSeconds(type);
    useSliderStore.getState().push({ key: String(key || `${type}:${Date.now()}`), type, title, body, data: data || {}, sticky: sec === 0 });
}

export default function AlertSliderHost({ navRef }) {
    const role = useAuthStore((s) => s.user?.role);
    const access = useOwnerStore((s) => s.access);
    const item = useSliderStore((s) => s.queue[0]);
    const mine = ['admin', 'rider', 'kitchen', 'waiter'].includes(role);
    const on = mine && !(role === 'admin' && access === 'blocked');   // also while the owner looks at the customer app (the Soundbox voice speaks then too)

    useEffect(() => {
        if (!on) { useSliderStore.getState().clear(); return undefined; }
        return onNotification((n) => {
            const t = String(n?.type || '');
            if (!t || (OWN_SHEET.includes(t) && role === 'admin')) return;
            if (!alertGroup(t)) return;
            showSlider({ key: n.id || n._id, once: true, type: t, title: n.title, body: n.body, data: n.data });
        });
    }, [on, role]);

    if (!on || !item) return null;
    const next = () => useSliderStore.getState().next();
    // where "Open" goes: the owner's pages as before; a rider's order; the cook and the waiter stay on their work screen
    const to = role === 'admin' ? ownerRoute({ type: item.type, data: item.data })
        : role === 'rider' && item.data?.orderId ? { name: 'OrderDetail', params: { id: String(item.data.orderId) } } : null;
    const open = to ? () => { next(); if (navRef?.isReady?.()) navRef.navigate(to.name, to.params); } : undefined;
    // a leave request asks a question: the answers are right on the slider
    const d = item.data || {};
    const answer = (call, approve) => async () => {
        try { await call(approve); next(); showToast(approve ? tr('Leave approved') : tr('Leave not approved')); } catch (e) { showToast(apiError(e)); }
    };
    const decide = role === 'admin' && d.leaveId && (item.type === 'staff_leave_request' || item.type === 'rider_leave_request')
        ? (item.type === 'staff_leave_request' ? (approve) => decideStaffLeave(d.leaveId, approve) : (approve) => decideLeave(d.leaveId, { approve }))
        : null;
    // a new table booking asks a question too: Allow tells the guest it is confirmed; Deny opens the page where the owner may write a reason
    const bookingActions = role === 'admin' && item.type === 'booking_new' && d.bookingId ? [
        { label: tr('Allow'), onPress: async () => { try { await bookingApi.allow(d.bookingId); next(); showToast(tr('Table confirmed')); } catch (e) { showToast(apiError(e)); } } },
        { label: tr('Deny'), kind: 'danger', onPress: () => { next(); if (navRef?.isReady?.()) navRef.navigate('OwnerBookingDeny', { id: String(d.bookingId) }); } },
    ] : undefined;
    const actions = decide ? [{ label: tr('Approve'), onPress: answer(decide, true) }, { label: tr('Reject'), kind: 'danger', onPress: answer(decide, false) }] : bookingActions;
    // the key makes a new slider start fresh (its bar and its slide) when the one before it has gone
    return <AlertSlider key={item.key} item={item} sec={alertSeconds(item.type)} onClose={next} onOpen={open} actions={actions} onTurnOff={() => { next(); turnOffSlider(item.type); }} />;
}
