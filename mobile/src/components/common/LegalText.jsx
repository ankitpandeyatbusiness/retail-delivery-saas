// Draws a legal document written in the simple form the admin app edits:
//   # heading     - bullet     1. numbered line     anything else is a paragraph
import React from 'react';
import { View, Text } from 'react-native';
import { useBrand } from './kit';
import { tr } from '../../i18n';

const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// "About Vivyaan": the server fills the platform name into "About {platformName}". That text is too short for the app-wide pattern matcher (it would
// also catch other sentences that start with "About "), so this one heading is matched here.
const trHeading = (text) => {
    const done = tr(text);
    if (done !== text) return done;
    const m = /^About (.+)$/.exec(text);
    return m ? tr('About {platformName}', { platformName: m[1] }) : text;
};

// ONE look for every legal page and About Us, on every device (Android, iPhone, phone browser, tablet, desktop): the headings in pure white on a dark look,
// and the text under them grey.
export function useLegalInk() {
    const { text, muted, dark } = useBrand();
    return { heading: dark ? '#FFFFFF' : text, body: muted };
}

export default function LegalText({ text, title }) {
    const { heading: ink, body: para } = useLegalInk();
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
                if (m) return <Text key={i} style={{ color: ink, fontSize: 16, fontWeight: '900', marginTop: i === 0 ? 0 : 18, marginBottom: 4 }}>{trHeading(m[1])}</Text>;
                m = line.match(/^-\s+(.*)$/);
                if (m) return <Text key={i} style={{ color: para, fontSize: 14.5, lineHeight: 21, marginTop: 3, paddingLeft: 14 }}>{'•  '}{tr(m[1])}</Text>;
                m = line.match(/^(\d+)\.\s+(.*)$/);
                if (m) return <Text key={i} style={{ color: para, fontSize: 14.5, lineHeight: 21, marginTop: 3, paddingLeft: 14 }}>{`${m[1]}.  `}{tr(m[2])}</Text>;
                return <Text key={i} style={{ color: para, fontSize: 14.5, lineHeight: 21, marginTop: 3 }}>{tr(line)}</Text>;
            })}
        </View>
    );
}
