// One line for the rider while he is on his way: is his phone really sending his position to the customer?
//   green   "Sharing your location · sent 8 s ago"
//   amber   the position was sent but the server did not use it (the reason is shown)
//   red     no GPS position at all from this phone (indoors, location off, a fake-GPS app not running), or the send failed
// It reads the state kept by the location service (utils/riders/locationTask.js). Only for him to see.
import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../common/kit';
import { getLocationStatus } from '../../utils/riders/locationTask';
import { tr } from '../../i18n';

export default function LocationStatus({ style }) {
    const { ok, error, muted, text } = useBrand();
    const [, tick] = useState(0);
    useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
    const s = getLocationStatus();
    const now = Date.now();
    const fixAgo = s.fixAt ? Math.round((now - s.fixAt) / 1000) : null;
    const sentAgo = s.sentAt ? Math.round((now - s.sentAt) / 1000) : null;

    let color = ok;
    let icon = 'checkmark-circle';
    let line;
    if (fixAgo === null || fixAgo > 45) {
        color = error; icon = 'warning';
        line = fixAgo === null
            ? tr('This phone has not found a GPS position yet. Go outside, or check that Location is on.')
            : tr('No GPS position from this phone for {n} s. Go outside, or check that Location is on.', { n: fixAgo });
    } else if (s.error) {
        color = error; icon = 'warning';
        line = tr('Position found, but sending failed: {why}', { why: s.error });
    } else if (s.saved) {
        line = tr('Sharing your location · sent {n} s ago', { n: sentAgo ?? 0 });
    } else if (s.reason) {
        color = '#D97706'; icon = 'alert-circle';
        line = tr('Position found, but the shop\'s server did not use it: {why}', { why: s.reason });
    } else {
        color = muted; icon = 'time-outline';
        line = tr('Position found. Sending…');
    }
    return (
        <View style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>
            <Ionicons name={icon} size={16} color={color} />
            <Text style={{ color: color === muted ? text : color, fontWeight: '700', fontSize: 12.5, marginLeft: 6, flex: 1 }} numberOfLines={2}>{line}</Text>
        </View>
    );
}
