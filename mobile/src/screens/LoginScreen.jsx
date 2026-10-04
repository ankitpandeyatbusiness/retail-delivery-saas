import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function LoginScreen() {
    const insets = useSafeAreaInsets();

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            <Animated.View entering={FadeInDown.delay(200).duration(800)} style={styles.header}>
                <Text style={styles.title}>retail-saas</Text>
                <Text style={styles.subtitle}>Universal Delivery Engine</Text>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(400).duration(800)} style={styles.formContainer}>
                {/* We will add the actual phone/OTP inputs here later */}
                <TouchableOpacity style={styles.primaryButton}>
                    <Text style={styles.buttonText}>Get Started</Text>
                </TouchableOpacity>
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#ffffff',
        paddingHorizontal: 24,
    },
    header: {
        marginTop: 80,
        marginBottom: 48,
    },
    title: {
        fontSize: 36,
        fontWeight: '800',
        color: '#000000',
        letterSpacing: -1,
    },
    subtitle: {
        fontSize: 16,
        color: '#666666',
        marginTop: 8,
        fontWeight: '500',
    },
    formContainer: {
        flex: 1,
    },
    primaryButton: {
        backgroundColor: '#E23744', // Zomato-style brand red
        paddingVertical: 16,
        borderRadius: 16,
        alignItems: 'center',
        shadowColor: '#E23744',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 4,
    },
    buttonText: {
        color: '#ffffff',
        fontSize: 18,
        fontWeight: '700',
    }
});