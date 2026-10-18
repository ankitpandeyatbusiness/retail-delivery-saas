// The navigation chevron, like Google Maps: a sharp, notched arrowhead in the shop's colour with a white edge and NO shadow (a shadow is squashed when the marker lies flat on a tilted map), pointing UP.
// In navigation mode the map turns so that "forward" is always up, so the chevron always points forward. Used either as a fixed picture
// at the centre of the screen (the map moves underneath it) or, when the map is being explored, as the child of a flat marker.
import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// Ionicons "navigate" points to the top right: turned -45 degrees it points up
export default function NavChevron({ color, size = 46 }) {
    const box = size + 16;
    return (
        <View style={{ width: box, height: box, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons
                name="navigate" size={size + 10} color="#FFFFFF"
                style={{ position: 'absolute', transform: [{ rotate: '-45deg' }] }}
            />
            <Ionicons name="navigate" size={size} color={color} style={{ transform: [{ rotate: '-45deg' }] }} />
        </View>
    );
}
