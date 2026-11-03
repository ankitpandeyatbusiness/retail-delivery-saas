// In a brand with branches the BRAND OWNER pays the rent and tops up the shared SMS wallet. A branch manager sees this note
// where the Pay / Add money buttons would be. canPay comes from the server (false only for a branch manager of a brand).
import React from 'react';
import { Text } from 'react-native';
import { Card } from './ui';
import { useBrand } from '../common/kit';
import { tr } from '../../i18n';

export default function BrandPayGate({ canPay, children }) {
    const { text, muted } = useBrand();
    if (canPay !== false) return children;
    return (
        <Card>
            <Text style={{ color: text, fontWeight: '900' }}>{tr('Your brand owner pays')}</Text>
            <Text style={{ color: muted, marginTop: 4 }}>{tr('The brand owner pays the rent and tops up the SMS wallet for every branch. You can see everything here.')}</Text>
        </Card>
    );
}
