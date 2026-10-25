// A photo full screen: tap anywhere (or the cross) to close.
import React from 'react';
import { Modal, Pressable, View, StatusBar } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function PhotoViewer({ uri, onClose }) {
    const insets = useSafeAreaInsets();
    return (
        <Modal visible={!!uri} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
            <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: '#000000', justifyContent: 'center' }}>
                {uri ? <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="contain" /> : null}
                <View style={{ position: 'absolute', top: insets.top + 12, right: 16, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="close" size={24} color="#FFFFFF" />
                </View>
            </Pressable>
        </Modal>
    );
}
