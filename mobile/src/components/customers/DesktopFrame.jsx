// The DESKTOP website for customers (a browser at least 1024 px wide): a top bar (DesktopTopBar: the shop, where to deliver, search, cart, account),
// the screens in a centred column, and in the bottom-right corner a small cart card (DesktopCartBar) that stays while the cart has something in it.
// The phone, the phone browser, tablets and the native app never reach this: useCustomerDesktop() is false there and the children are returned as they are.
import React from 'react';
import { View } from 'react-native';
import { useBrand } from '../common/kit';
import { useCustomerDesktop, useOwnerDesktop, useStaffDesktop, DESKTOP_PAGE_MAX } from '../../utils/common/layout';
import OwnerSidebar from '../owners/OwnerSidebar';
import StaffSidebar from '../staff/StaffSidebar';
import GetAppBanner from './GetAppBanner';
import DesktopTopBar from './DesktopTopBar';
import DesktopCartBar from './DesktopCartBar';

const PAGE = DESKTOP_PAGE_MAX;

// The wrappers are the SAME on every screen size, only the top bar and the cart card come and go: resizing the window (or moving between the
// login screen and the rest) must never rebuild the navigator inside, or the customer would lose the place they were in.
export default function DesktopFrame({ navRef, routeName, children }) {
    const desktop = useCustomerDesktop();
    const brand = useBrand();
    const ownerDesk = useOwnerDesktop();   // the shop owner on a computer: a sidebar on the left, no top bar
    const staffDesk = useStaffDesktop();   // a cook or a waiter on a computer: their own sidebar
    const sideDesk = ownerDesk || staffDesk;
    const bare = !desktop || routeName === 'Login';   // the login screen has its own full-width desktop layout
    return (
        <View style={{ flex: 1, backgroundColor: desktop ? brand.background : undefined }}>
            {/* the website only: nothing is drawn in the phone app */}
            <GetAppBanner />
            {bare ? null : <DesktopTopBar navRef={navRef} routeName={routeName} />}
            <View style={{ flex: 1, flexDirection: sideDesk ? 'row' : 'column' }}>
                {ownerDesk && routeName !== 'Login' ? <OwnerSidebar routeName={routeName} /> : null}
                {staffDesk && routeName !== 'Login' ? <StaffSidebar routeName={routeName} /> : null}
                <View style={{ flex: 1, flexDirection: 'row', width: '100%', maxWidth: bare || sideDesk ? undefined : PAGE, alignSelf: sideDesk ? 'stretch' : 'center' }}>
                    <View style={{ flex: 1, overflow: bare ? undefined : 'hidden' }}>{children}</View>
                </View>
            </View>
            {bare ? null : <DesktopCartBar navRef={navRef} routeName={routeName} />}
        </View>
    );
}
