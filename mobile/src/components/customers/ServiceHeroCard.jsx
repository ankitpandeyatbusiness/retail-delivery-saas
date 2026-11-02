// One service as a picture card in the Services list: the picture (or the shop's colours and a big icon), the name and the price over it.
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ServiceCover } from './ServiceHero';
import { tr } from '../../i18n';

const SHADOW = { textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 };

export default function ServiceHeroCard({ service, priceText, onPress }) {
    const hasPhoto = (service.photos || []).filter(Boolean).length > 0;
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => ({ marginHorizontal: 16, marginBottom: 14, borderRadius: 22, opacity: pressed ? 0.92 : 1, shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4 })}
        >
            <ServiceCover service={service} style={{ height: 156, borderRadius: 22, opacity: service.paused ? 0.78 : 1 }} fade={service.paused ? ['rgba(0,0,0,0.45)', 'rgba(0,0,0,0.82)'] : ['rgba(0,0,0,0.05)', 'rgba(0,0,0,0.72)']}>
                {service.paused ? (
                    <View style={{ position: 'absolute', top: 12, right: 12, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.9)' }}>
                        <Ionicons name="pause-circle" size={15} color="#B45309" style={{ marginRight: 5 }} />
                        <Text style={{ color: '#B45309', fontWeight: '800', fontSize: 12 }}>{tr('Temporarily unavailable')}</Text>
                    </View>
                ) : null}
                {hasPhoto ? (
                    <View style={{ position: 'absolute', top: 12, left: 12, width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.32)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name={service.icon || 'sparkles-outline'} size={19} color="#fff" />
                    </View>
                ) : null}
                <View style={{ position: 'absolute', left: 16, right: 16, bottom: 14, flexDirection: 'row', alignItems: 'flex-end' }}>
                    <View style={{ flex: 1, minWidth: 0, paddingRight: 10 }}>
                        <Text numberOfLines={1} style={[{ color: '#fff', fontSize: 21, fontWeight: '900' }, SHADOW]}>{tr(service.name)}</Text>
                        {priceText ? <Text numberOfLines={1} style={[{ color: 'rgba(255,255,255,0.92)', fontSize: 13.5, fontWeight: '700', marginTop: 3 }, SHADOW]}>{priceText}</Text> : null}
                    </View>
                    <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.24)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)', alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="arrow-forward" size={19} color="#fff" />
                    </View>
                </View>
            </ServiceCover>
        </Pressable>
    );
}
