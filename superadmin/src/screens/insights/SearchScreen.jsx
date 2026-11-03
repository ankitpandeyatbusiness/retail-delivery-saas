import React, { useState } from 'react';
import { Screen } from '../../components/layout';
import { SearchBar } from '../../components/inputs';
import SearchResults from '../../components/SearchResults';

// One box to find a shop (or a brand's branches), an order (by number or customer phone), a person (by phone), a rent invoice, or a screen.
// The same box is on the Home screen; this is the full-page version.
export default function SearchScreen() {
    const [q, setQ] = useState('');
    return (
        <Screen title="Search" subtitle="Shops, orders, people, invoices">
            <SearchBar value={q} onChangeText={setQ} placeholder="Shop or brand name, order no, phone, invoice no" />
            <SearchResults q={q} />
        </Screen>
    );
}
