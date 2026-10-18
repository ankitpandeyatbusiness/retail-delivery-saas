// The rider on a tracking map, as in Blinkit: the route line that exists ONLY from the front of the rider to the home pin (the road
// behind him is "eaten" as he moves), and the rider himself as a top-down 3D-style scooter (RiderPin, in the shop's colour) gliding
// along the road. The marker is flat and its rotation is the BEARING of the road he is on, so the front wheel and handlebars point
// the way the route line goes. Before he has moved, the bearing comes from the road ahead of him (or the straight way to the home
// pin), never from "north".
// halo: radius in metres of the transparent disk under the rider (0 = none). solid: a solid line even when it is only the straight fallback.
// marker: 'scooter' (default), 'chevron' (the navigation arrow as a map marker) or 'none' (no marker: the caller shows a fixed chevron).
// onMove(pos, heading): called as the rider glides, so a camera can follow exactly that point.
// Render it INSIDE a <MapView>. It keeps its own state, so the screen around it is not redrawn while the scooter moves.
//   road     the route as [{ latitude, longitude }] (empty when the server has no real road)
//   loc      the latest position { lat, lng, heading? }
//   dest     the home pin { latitude, longitude }: with no road, the line is a dashed straight one from the rider to it
//   color    the shop's colour (the box and the helmet)
//   orderId  a different order starts again
import React, { useEffect, useState } from 'react';
import { Polyline, Marker, Circle } from 'react-native-maps';
import { useRoadGlide, bearingBetween } from '../../hooks/common/useRoadGlide';
import RiderPin, { RIDER_SIZE } from './RiderPin';
import NavChevron from './NavChevron';

// lineWidth / casing (the white edge, extra width; 0 = none) / zIndex: for a map with several riders, where lines of different widths
// are stacked so that two routes on the same road both show. onPress: the scooter was tapped.
export default function RiderTrack({ road, loc, dest, orderId, color, estimate, title, size = RIDER_SIZE, lineWidth = 5, casing = 4, zIndex = 1, onPress, refreshKey, marker = 'scooter', onMove, halo = 0, solid = false, lineColor, headingOverride }) {
    const g = useRoadGlide({ road, loc, resetKey: orderId });
    // the scooter is a custom view: its picture is taken again for a moment when it appears / its colour changes, then left alone
    const [loaded, setLoaded] = useState(false);
    const [settle, setSettle] = useState(true);
    useEffect(() => {
        setSettle(true);
        if (!loaded && marker === 'scooter') return undefined;
        const t = setTimeout(() => setSettle(false), 500);
        return () => clearTimeout(t);
    }, [loaded, g.ready, color, refreshKey]);   // refreshKey: the screen came back into view, the native marker may have lost its picture

    useEffect(() => { if (g.pos) onMove?.(g.pos, g.heading); }, [g.pos, g.heading]);   // eslint-disable-line react-hooks/exhaustive-deps

    const line = g.line && g.line.length > 1 ? g.line : (g.pos && dest ? [g.pos, dest] : []);
    const dashed = !solid && (estimate || !(g.line && g.line.length > 1));
    const tint = /^#[0-9a-f]{6}$/i.test(color || '') ? `rgba(${parseInt(color.slice(1, 3), 16)},${parseInt(color.slice(3, 5), 16)},${parseInt(color.slice(5, 7), 16)},0.1)` : 'rgba(229,57,53,0.1)';
    // the bearing from the previous position to the new one while he moves; standing still, the road ahead, else the way to the home pin
    // headingOverride: navigation mode passes the SAME bearing the camera uses, so the flat arrow always points to the top of the screen
    const heading = headingOverride ?? g.heading ?? (g.pos && dest ? bearingBetween(g.pos, dest) : 0);
    return (
        <>
            {/* a white edge under the line, so it stands out on the pale map; thick, as in Blinkit */}
            {line.length > 1 && casing > 0 ? <Polyline coordinates={line} strokeColor="#FFFFFF" strokeWidth={lineWidth + casing} zIndex={zIndex * 2} /> : null}
            {line.length > 1 && lineWidth > 0 ? <Polyline coordinates={line} strokeColor={lineColor || color} strokeWidth={lineWidth} zIndex={zIndex * 2 + 1} lineDashPattern={dashed ? [10, 10] : undefined} /> : null}
            {/* halo: a soft disk of this many metres under the rider, so the icon sits ON the map (navigation mode) */}
            {g.ready && halo > 0 && g.pos ? <Circle center={g.pos} radius={halo} fillColor={tint} strokeWidth={0} strokeColor="transparent" zIndex={9} /> : null}
            {g.ready && marker !== 'none' ? (
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
                    {marker === 'chevron' ? <NavChevron color={color} size={Math.round(size * 0.65)} /> : <RiderPin color={color} size={size} onReady={() => setLoaded(true)} />}
                </Marker.Animated>
            ) : null}
        </>
    );
}
