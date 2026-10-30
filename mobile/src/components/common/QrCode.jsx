// Draws a QR from the cells the server sends ({ size, rows: ['0110..'] }): plain views, so it needs no extra package and works offline.
import React, { useMemo } from 'react';
import { View } from 'react-native';

export default function QrCode({ qr, width = 220 }) {
    const cell = qr ? Math.max(1, Math.floor(width / qr.size)) : 1;
    const lines = useMemo(() => (qr?.rows || []).map((row) => {
        const runs = [];   // [dark?, length] so one row is a few views, not one per cell
        for (let i = 0; i < row.length; i++) {
            const dark = row[i] === '1';
            if (runs.length && runs[runs.length - 1][0] === dark) runs[runs.length - 1][1] += 1; else runs.push([dark, 1]);
        }
        return runs;
    }), [qr]);
    if (!qr) return null;
    const side = cell * qr.size;
    return (
        <View accessibilityLabel="QR code" style={{ backgroundColor: '#fff', padding: 12, borderRadius: 14, alignSelf: 'center' }}>
            <View style={{ width: side, height: side }}>
                {lines.map((runs, y) => (
                    <View key={y} style={{ flexDirection: 'row', height: cell }}>
                        {runs.map(([dark, n], i) => <View key={i} style={{ width: n * cell, height: cell, backgroundColor: dark ? '#000' : '#fff' }} />)}
                    </View>
                ))}
            </View>
        </View>
    );
}
