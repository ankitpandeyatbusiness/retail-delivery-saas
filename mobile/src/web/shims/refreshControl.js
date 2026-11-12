// WEB ONLY. React Native Web's RefreshControl is an empty box, so "pull down to refresh" never did anything in the browser. This one is the same box, but
// it also tells src/utils/common/webPullRefresh.js which screen's refresh to run when the person pulls the page down.
import React, { useEffect, useRef } from 'react';
import View from 'react-native-web/dist/exports/View';
import { registerRefresh } from '../../utils/common/webPullRefresh';

export default function RefreshControl(props) {
    const { enabled, colors, progressBackgroundColor, size, tintColor, title, titleColor, progressViewOffset, refreshing, onRefresh, ...viewProps } = props;
    const fn = useRef(onRefresh);
    fn.current = onRefresh;
    useEffect(() => (onRefresh && enabled !== false ? registerRefresh(() => fn.current && fn.current()) : undefined), [!!onRefresh, enabled]);
    return <View {...viewProps} />;
}
