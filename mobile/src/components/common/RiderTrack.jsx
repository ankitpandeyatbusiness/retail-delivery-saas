// The rider on a tracking map, as in Blinkit: the route line that exists ONLY from the front of the rider to the home pin (the road
// behind him is "eaten" as he moves), and the rider himself as a top-down 3D-style scooter (RiderPin, in the shop's colour) gliding
// along the road. The marker is flat and its rotation is the BEARING of the road he is on, so the front wheel and handlebars point
// the way the route line goes. Before he has moved, the bearing comes from the road ahead of him (or the straight way to the home
// pin), never from "north".
// Render it INSIDE a <MapView>. It keeps its own state, so the screen around it is not redrawn while the scooter moves.
//   road     the route as [{ latitude, longitude }] (empty when the server has no real road)
//   loc      the latest position { lat, lng, heading? }
//   dest     the home pin { latitude, longitude }: with no road, the line is a dashed straight one from the rider to it
//   color    the shop's colour (the box and the helmet)
//   orderId  a different order starts again
import React, { useEffect, useState } from 'react';
import { Polyline, Marker } from 'react-native-maps';
import { useRoadGlide, bearingBetween } from '../../hooks/common/useRoadGlide';
import RiderPin, { RIDER_SIZE } from './RiderPin';

// lineWidth / casing (the white edge, extra width; 0 = none) / zIndex: for a map with several riders, where lines of different widths
// are stacked so that two routes on the same road both show. onPress: the scooter was tapped.
export default function RiderTrack({ road, loc, dest, orderId, color, estimate, title, size = RIDER_SIZE, lineWidth = 5, casing = 4, zIndex = 1, onPress, refreshKey }) {
    const g = useRoadGlide({ road, loc, resetKey: orderId });
    // the scooter is a custom view: its picture is taken again for a moment when it appears / its colour changes, then left alone
    const [loaded, setLoaded] = useState(false);
    const [settle, setSettle] = useState(true);
    useEffect(() => {
        setSettle(true);
        if (!loaded) return undefined;
        const t = setTimeout(() => setSettle(false), 500);
        return () => clearTimeout(t);
    }, [loaded, g.ready, color, refreshKey]);   // refreshKey: the screen came back into view, the native marker may have lost its picture

    const line = g.line && g.line.length > 1 ? g.line : (g.pos && dest ? [g.pos, dest] : []);
    const dashed = estimate || !(g.line && g.line.length > 1);
    // the bearing from the previous position to the new one while he moves; standing still, the road ahead, else the way to the home pin
    const heading = g.heading ?? (g.pos && dest ? bearingBetween(g.pos, dest) : 0);
    return (
        <>
            {/* a white edge under the line, so it stands out on the pale map; thick, as in Blinkit */}
            {line.length > 1 && casing > 0 ? <Polyline coordinates={line} strokeColor="#FFFFFF" strokeWidth={lineWidth + casing} zIndex={zIndex * 2} /> : null}
            {line.length > 1 && lineWidth > 0 ? <Polyline coordinates={line} strokeColor={color} strokeWidth={lineWidth} zIndex={zIndex * 2 + 1} lineDashPattern={dashed ? [10, 10] : undefined} /> : null}
            {g.ready ? (
                <Marker.Animated
                    coordinate={g.coordinate}
                    title={title}
                    anchor={{ x: 0.5, y: 0.5 }}
                    flat
                    rotation={heading}
                    zIndex={10 + zIndex}
                    onPress={onPress}
                    tracksViewChanges={settle}
                >
                    <RiderPin color={color} size={size} onReady={() => setLoaded(true)} />
                </Marker.Animated>
            ) : null}
        </>
    );
}
