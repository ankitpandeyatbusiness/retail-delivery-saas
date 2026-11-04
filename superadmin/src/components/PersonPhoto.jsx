import React from 'react';
import { ZoomImage } from './ImageViewer';
import { Avatar } from './ui';

// The person's own picture when there is one, otherwise the coloured initials.
export default function PersonPhoto({ uri, name, size = 44, section = 'riders' }) {
    if (!uri) return <Avatar name={name} size={size} section={section} />;
    return <ZoomImage source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#00000010' }} />;
}
