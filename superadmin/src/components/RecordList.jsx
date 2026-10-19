import React, { useCallback, useEffect, useState } from 'react';
import { View, FlatList } from 'react-native';
import { ActivityIndicator } from './Loading';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Screen, HeaderButton } from './layout';
import { FadeInRow } from './motion';
import { SearchBar } from './inputs';
import { Loading, Empty, ErrorBox } from './feedback';
import { listRecords } from '../api/catalogApi';
import usePagedList from '../hooks/usePagedList';
import { useTheme, spacing } from '../theme';

/*
 * A searchable, paged list of one catalog resource (collections, banners, coupons...).
 * renderRow(item, { open }) draws one row; open() goes to the edit screen.
 * New / edit screens receive { shopId, name, id? }.
 */
export default function RecordList({ shopId, shopName, resource, title, subtitle, formScreen, searchPlaceholder = 'Search', emptyTitle, emptyHint, renderRow, extraParams }) {
    const t = useTheme();
    const nav = useNavigation();
    const [q, setQ] = useState('');
    const [debounced, setDebounced] = useState('');
    useEffect(() => { const id = setTimeout(() => setDebounced(q.trim()), 300); return () => clearTimeout(id); }, [q]);

    const list = usePagedList(
        (page) => listRecords(shopId, resource, { page, limit: 30, ...(debounced ? { q: debounced } : {}), ...(extraParams || {}) }),
        [shopId, resource, debounced],
    );

    // coming back from the form: refresh quietly
    const first = React.useRef(true);
    useFocusEffect(useCallback(() => {
        if (first.current) { first.current = false; return; }
        list.silentReload();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []));

    const add = () => nav.navigate(formScreen, { shopId, name: shopName });
    const open = (item) => nav.navigate(formScreen, { shopId, name: shopName, id: item._id });

    return (
        <Screen
            title={title}
            subtitle={subtitle || shopName}
            scroll={false}
            right={<HeaderButton icon="add" onPress={add} />}
        >
            <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
                <SearchBar value={q} onChangeText={setQ} placeholder={searchPlaceholder} />
            </View>
            {list.state === 'loading' ? <Loading /> : list.state === 'error' ? <ErrorBox message={list.error} onRetry={list.reload} /> : (
                <FlatList
                    data={list.items}
                    keyExtractor={(i) => String(i._id)}
                    contentContainerStyle={{ padding: spacing.lg, paddingTop: 0, paddingBottom: spacing.xxl * 2, flexGrow: 1 }}
                    refreshing={list.refreshing}
                    onRefresh={list.refresh}
                    onEndReached={list.loadMore}
                    onEndReachedThreshold={0.4}
                    ListFooterComponent={list.more ? <ActivityIndicator color={t.primary} style={{ margin: spacing.lg }} /> : null}
                    ListEmptyComponent={
                        <Empty
                            icon="box"
                            title={debounced ? 'Nothing matches' : emptyTitle}
                            hint={debounced ? 'Try another search.' : emptyHint}
                            action={debounced ? undefined : 'Add one'}
                            onAction={add}
                        />
                    }
                    renderItem={({ item, index }) => <FadeInRow index={index}>{renderRow(item, { open: () => open(item) })}</FadeInRow>}
                />
            )}
        </Screen>
    );
}
