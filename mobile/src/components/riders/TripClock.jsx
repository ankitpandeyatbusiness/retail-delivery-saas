// The time for this delivery, in one card.
//   before the food is collected   "About 25 min to reach the customer"  (the time allowed: road time + 5 minutes)
//   after it is collected          a countdown to the due time. If he runs late the timer turns red, counts how late he is, and
//                                  shows the estimated arrival time from his location. (Only for him to see: nothing is sent anywhere.)
import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../common/kit';
import { tr } from '../../i18n';

const clock = (sec) => {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`;
};

// the minutes left (or how late), shared with the map pin so the two always agree
export function dueOf({ dueAt, collectedAt, allowedSec }) {
    if (dueAt) return new Date(dueAt).getTime();
    if (collectedAt && allowedSec) return new Date(collectedAt).getTime() + allowedSec * 1000;
    return null;
}

// The server cancels an order that is this many minutes past its time (backend services/lateDelivery.js), warning one step before
const CANCEL_AFTER_MIN = 60;
const WARN_AFTER_MIN = 50;

export default function TripClock({ onTheWay, allowedSec, due, eta, style }) {
    const { surface, border, text, muted, primary, error } = useBrand();
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        if (!onTheWay || !due) return undefined;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [onTheWay, due]);

    if (!onTheWay) {
        if (!allowedSec) return null;
        return (
            <View style={[{ flexDirection: 'row', alignItems: 'center', borderRadius: 16, borderWidth: 1, borderColor: border, backgroundColor: surface, padding: 14 }, style]}>
                <Ionicons name="time-outline" size={26} color={primary} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={{ color: muted, fontSize: 12, fontWeight: '700' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{tr('Time to reach the customer')}</Text>
                    <Text style={{ color: text, fontSize: 24, fontWeight: '900' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{tr('About {min} min', { min: Math.round(allowedSec / 60) })}</Text>
                </View>
            </View>
        );
    }
    if (!due) return null;

    const left = Math.round((due - now) / 1000);
    const late = left < 0;
    const color = late ? error : text;
    const lateMin = late ? Math.max(1, Math.ceil(-left / 60)) : 0;
    const cancelIn = Math.max(1, CANCEL_AFTER_MIN - Math.floor(-left / 60));
    const etaMin = eta?.etaAt ? Math.max(1, Math.ceil((new Date(eta.etaAt).getTime() - now) / 60000)) : null;
    return (
        <View style={[{ flexDirection: 'row', alignItems: 'center', borderRadius: 16, borderWidth: late ? 2 : 1, borderColor: late ? error : border, backgroundColor: surface, padding: 14 }, style]}>
            <Ionicons name={late ? 'alarm' : 'timer-outline'} size={28} color={late ? error : primary} />
            <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ color: late ? error : muted, fontSize: 12, fontWeight: '800' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                    {late ? (etaMin ? tr('{late} min late · arriving in about {min} min', { late: lateMin, min: etaMin }) : tr('{late} min late', { late: lateMin })) : tr('Time left to deliver')}
                </Text>
                <Text style={{ color, fontSize: 30, fontWeight: '900', fontVariant: ['tabular-nums'] }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                    {late ? `+${clock(-left)}` : clock(left)}
                </Text>
                {late && lateMin >= WARN_AFTER_MIN ? (
                    <Text style={{ color: error, fontSize: 13, fontWeight: '900', marginTop: 2 }}>{tr('Deliver now. The order is cancelled in {min} min.', { min: cancelIn })}</Text>
                ) : null}
            </View>
        </View>
    );
}
