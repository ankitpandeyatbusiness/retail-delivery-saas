// The 4-digit PIN of a shared table, drawn for the DESKTOP website as four big boxes (the phone keeps its one wide input).
//   PinBoxes: the box he types into. One invisible input sits over the four boxes, so clicking anywhere focuses it; the box that is next glows.
//   PinShow:  the PIN a host reads out to the newcomer, in the same four boxes.
import React, { useRef, useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { useBrand } from '../common/kit';

const BOX = { width: 68, height: 80, borderRadius: 18, alignItems: 'center', justifyContent: 'center' };

export function PinBoxes({ value, onChange, onSubmit, autoFocus, error }) {
    const { primary, text, border, surface, error: bad } = useBrand();
    const ref = useRef(null);
    const [focus, setFocus] = useState(false);
    const at = Math.min(value.length, 3);
    return (
        <View style={{ alignSelf: 'center', marginTop: 18 }}>
            <View style={{ flexDirection: 'row', gap: 14 }}>
                {[0, 1, 2, 3].map((i) => {
                    const ch = value[i];
                    const cur = focus && i === at && value.length < 4;
                    return (
                        <View
                            key={i}
                            style={[BOX, {
                                borderWidth: 2, backgroundColor: surface, borderColor: error ? bad : cur ? primary : ch ? `${primary}99` : border,
                                boxShadow: cur ? `0 0 0 4px ${primary}26` : '0 0 0 0 transparent', transitionProperty: 'border-color, box-shadow', transitionDuration: '150ms',
                            }]}
                        >
                            {ch ? <Text style={{ color: text, fontSize: 36, fontWeight: '900' }}>{ch}</Text> : cur ? <View style={{ width: 2, height: 34, backgroundColor: primary }} /> : null}
                        </View>
                    );
                })}
            </View>
            <TextInput
                ref={ref}
                value={value}
                onChangeText={(v) => onChange(v.replace(/\D/g, '').slice(0, 4))}
                onSubmitEditing={onSubmit}
                onFocus={() => setFocus(true)}
                onBlur={() => setFocus(false)}
                keyboardType="number-pad"
                maxLength={4}
                autoFocus={autoFocus}
                caretHidden
                accessibilityLabel="PIN"
                style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0, outlineStyle: 'none', outlineWidth: 0, cursor: 'text' }}
            />
        </View>
    );
}

export function PinShow({ pin }) {
    const { primary } = useBrand();
    return (
        <View style={{ flexDirection: 'row', gap: 14, alignSelf: 'center', marginVertical: 6 }}>
            {String(pin || '').split('').map((d, i) => (
                <View key={i} style={[BOX, { backgroundColor: `${primary}1F`, borderWidth: 2, borderColor: `${primary}66` }]}>
                    <Text style={{ color: primary, fontSize: 40, fontWeight: '900' }}>{d}</Text>
                </View>
            ))}
        </View>
    );
}
