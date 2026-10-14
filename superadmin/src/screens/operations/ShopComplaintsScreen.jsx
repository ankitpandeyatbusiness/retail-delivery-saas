import React from 'react';
import { useRoute } from '@react-navigation/native';
import { Screen } from '../../components/layout';
import ComplaintsList from '../../components/ComplaintsList';

// The complaints of one shop. Open ones first; tap one to answer it.
export default function ShopComplaintsScreen() {
    const { shopId, name } = useRoute().params;
    return (
        <Screen title="Complaints" subtitle={name} scroll={false}>
            <ComplaintsList shopId={shopId} shopName={name} />
        </Screen>
    );
}
