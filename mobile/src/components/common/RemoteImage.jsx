import React from 'react';
import { Image } from 'expo-image';

export default function RemoteImage({ uri, style }) {
    return (
        <Image
            source={uri ? { uri } : undefined}
            style={[{ backgroundColor: '#EEEEEE' }, style]}
            contentFit="cover"
            transition={200}
            cachePolicy="memory-disk"
            recyclingKey={uri}
        />
    );
}