// Draws a legal document written in the simple form the admin app edits:
//   # heading     - bullet     1. numbered line     anything else is a paragraph
import React from 'react';
import { View, Text } from 'react-native';
import { useBrand } from './kit';

const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export default function LegalText({ text, title }) {
    const { text: ink, muted } = useBrand();
    const lines = String(text || '').split('\n');
    // the page header already shows the title: leave out the first heading when it is the same words
    const first = lines.findIndex((l) => l.trim());
    if (title && first >= 0 && /^#\s+/.test(lines[first].trim()) && norm(lines[first].replace(/^\s*#\s+/, '')) === norm(title)) lines.splice(first, 1);
    return (
        <View>
            {lines.map((raw, i) => {
                const line = raw.trim();
                if (!line) return <View key={i} style={{ height: 6 }} />;
                let m = line.match(/^#\s+(.*)$/);
                if (m) return <Text key={i} style={{ color: ink, fontSize: 16, fontWeight: '900', marginTop: i === 0 ? 0 : 18, marginBottom: 4 }}>{m[1]}</Text>;
                m = line.match(/^-\s+(.*)$/);
                if (m) return <Text key={i} style={{ color: ink, fontSize: 14.5, lineHeight: 21, marginTop: 3, paddingLeft: 14 }}>{'•  '}{m[1]}</Text>;
                m = line.match(/^(\d+)\.\s+(.*)$/);
                if (m) return <Text key={i} style={{ color: ink, fontSize: 14.5, lineHeight: 21, marginTop: 3, paddingLeft: 14 }}>{`${m[1]}.  `}{m[2]}</Text>;
                return <Text key={i} style={{ color: muted, fontSize: 14.5, lineHeight: 21, marginTop: 3 }}>{line}</Text>;
            })}
        </View>
    );
}
