// The DESKTOP website for customers (a browser at least 1024 px wide): a top bar (DesktopTopBar: the shop, where to deliver, search, cart, account),
// the screens in a centred column, and in the bottom-right corner a small cart card (DesktopCartBar) that stays while the cart has something in it.
// The phone, the phone browser, tablets and the native app never reach this: useCustomerDesktop() is false there and the children are returned as they are.
import React from 'react';
import { View } from 'react-native';
import { useBrand } from '../common/kit';
import { useCustomerDesktop, DESKTOP_PAGE_MAX } from '../../utils/common/layout';
import GetAppBanner from './GetAppBanner';
import DesktopTopBar from './DesktopTopBar';
import DesktopCartBar from './DesktopCartBar';

const PAGE = DESKTOP_PAGE_MAX;

// The wrappers are the SAME on every screen size, only the top bar and the cart card come and go: resizing the window (or moving between the
// login screen and the rest) must never rebuild the navigator inside, or the customer would lose the place they were in.
export default function DesktopFrame({ navRef, routeName, children }) {
    const desktop = useCustomerDesktop();
    const brand = useBrand();
    const bare = !desktop || routeName === 'Login';   // the login screen has its own full-width desktop layout
    return (
        <View style={{ flex: 1, backgroundColor: desktop ? brand.background : undefined }}>
            {/* the website only: nothing is drawn in the phone app */}
            <GetAppBanner />
            {bare ? null : <DesktopTopBar navRef={navRef} routeName={routeName} />}
            <View style={{ flex: 1, flexDirection: 'row', width: '100%', maxWidth: bare ? undefined : PAGE, alignSelf: 'center' }}>
                <View style={{ flex: 1, overflow: bare ? undefined : 'hidden' }}>{children}</View>
            </View>
            {bare ? null : <DesktopCartBar navRef={navRef} routeName={routeName} />}
        </View>
    );
}
