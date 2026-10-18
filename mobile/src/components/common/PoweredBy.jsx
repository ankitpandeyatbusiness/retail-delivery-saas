// "Powered by <company>" with a Contact button that calls the company's number. The name and the number are set in the admin app
// (Business details), so they change by themselves when the platform moves to another company.
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, Linking } from 'react-native';
import { useBrand } from './kit';
import { fetchPoweredBy } from '../../api/common/legalApi';
import { tr } from '../../i18n';

let cache = null;

export default function PoweredBy({ style }) {
    const { muted, primary } = useBrand();
    const [info, setInfo] = useState(cache);
    useEffect(() => {
        if (cache) return;
        fetchPoweredBy().then((r) => { cache = r; setInfo(r); }).catch(() => { });
    }, []);
    if (!info?.poweredBy) return null;
    const call = () => { if (info.contactPhone) Linking.openURL(`tel:${String(info.contactPhone).replace(/[^\d+]/g, '')}`).catch(() => { }); };
    return (
        <View style={[{ alignItems: 'center', paddingVertical: 10 }, style]}>
            <Text style={{ color: muted, fontSize: 12 }}>{tr('Powered by {poweredBy}', { poweredBy: info.poweredBy })}</Text>
            {info.contactPhone ? (
                <Pressable onPress={call} hitSlop={10} style={{ marginTop: 4, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: primary }}>
                    <Text style={{ color: primary, fontWeight: '800', fontSize: 12 }}>{tr('Contact')}</Text>
                </Pressable>
            ) : null}
        </View>
    );
}
