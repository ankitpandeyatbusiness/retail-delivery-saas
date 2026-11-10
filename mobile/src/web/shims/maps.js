// Web stand-in for react-native-maps: Google Maps JavaScript API (the browser's own map).
// The app's 10 map screens call <MapView>, <Marker>, <Marker.Animated>, <Polyline>, <Circle> and a few methods through a ref; this gives them the
// same names and behaviour. Markers can hold any React content (the shop pin, the home pin, the rider scooter).
// Key: EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY (a BROWSER key: restrict it to your website addresses in Google Cloud > Credentials > HTTP referrers, and to the Maps JavaScript API).
// Without the key, or if Google refuses to load, a quiet placeholder is shown and nothing crashes.
import React, { createContext, forwardRef, useContext, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { View, Text } from 'react-native';
import { zoomFor, deltaFor, parseColor, dashSpec, padding, AnimatedRegion } from './mapMath';

export { AnimatedRegion };
export const PROVIDER_GOOGLE = 'google';
export const PROVIDER_DEFAULT = null;

const KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY;
const TOUCH = typeof window !== 'undefined' && ('ontouchstart' in window || (navigator && navigator.maxTouchPoints > 0));

/* ------------------------------ loading Google ------------------------------ */
let loading = null;
function loadGoogle() {
    if (typeof window === 'undefined') return Promise.reject(new Error('No browser'));
    if (window.google && window.google.maps && window.google.maps.Map) return Promise.resolve(window.google.maps);
    if (!KEY) return Promise.reject(new Error('No Google Maps key'));
    if (!loading) {
        loading = new Promise((resolve, reject) => {
            window.__googleMapsReady = () => resolve(window.google.maps);
            const el = document.createElement('script');
            el.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY)}&callback=__googleMapsReady&v=weekly`;
            el.async = true;
            el.onerror = () => { loading = null; el.remove(); reject(new Error('Google Maps could not be loaded')); };
            document.head.appendChild(el);
        });
    }
    return loading;
}

const MapCtx = createContext(null);
const gmaps = () => window.google.maps;

const latLng = (c) => {
    const v = c && c.v ? c.v : c;   // an AnimatedRegion keeps its position in .v
    return v && Number.isFinite(v.latitude) && Number.isFinite(v.longitude) ? { lat: v.latitude, lng: v.longitude } : null;
};

/* --------------------------------- the map --------------------------------- */
const MapView = forwardRef(function MapView(props, ref) {
    const { style, children, initialRegion, region, customMapStyle, scrollEnabled, zoomEnabled, showsUserLocation } = props;
    const box = useRef(null);
    const mapRef = useRef(null);
    const [map, setMap] = useState(null);
    const [failed, setFailed] = useState(!KEY);
    const handlers = useRef({});
    handlers.current = { onMapReady: props.onMapReady, onRegionChangeComplete: props.onRegionChangeComplete, onPanDrag: props.onPanDrag, onPress: props.onPress };

    const regionOf = (m) => {
        const b = m.getBounds();
        const c = m.getCenter();
        if (!b || !c) return null;
        const ne = b.getNorthEast(); const sw = b.getSouthWest();
        let lngDelta = ne.lng() - sw.lng();
        if (lngDelta < 0) lngDelta += 360;
        return { latitude: c.lat(), longitude: c.lng(), latitudeDelta: Math.abs(ne.lat() - sw.lat()), longitudeDelta: lngDelta };
    };

    useEffect(() => {
        if (!KEY) return undefined;
        let dead = false;
        const listeners = [];
        loadGoogle().then((gm) => {
            if (dead || !box.current) return;
            const r = region || initialRegion || { latitude: 20.5937, longitude: 78.9629, latitudeDelta: 30, longitudeDelta: 30 };
            const m = new gm.Map(box.current, {
                center: { lat: r.latitude, lng: r.longitude },
                zoom: zoomFor(r.longitudeDelta, box.current.clientWidth || 400),
                disableDefaultUI: true,
                zoomControl: zoomEnabled !== false && !TOUCH,   // the +/- buttons on a computer; fingers pinch on a touch screen
                gestureHandling: scrollEnabled === false ? 'none' : 'greedy',
                clickableIcons: false,
                keyboardShortcuts: false,
                styles: Array.isArray(customMapStyle) ? customMapStyle : undefined,
            });
            mapRef.current = m;
            let ready = false;
            listeners.push(m.addListener('idle', () => {
                const cur = regionOf(m);
                if (!ready) { ready = true; if (handlers.current.onMapReady) handlers.current.onMapReady(); }
                if (cur && handlers.current.onRegionChangeComplete) handlers.current.onRegionChangeComplete(cur);
            }));
            listeners.push(m.addListener('drag', () => { if (handlers.current.onPanDrag) handlers.current.onPanDrag({ nativeEvent: {} }); }));
            listeners.push(m.addListener('click', (e) => {
                if (handlers.current.onPress && e && e.latLng) handlers.current.onPress({ nativeEvent: { coordinate: { latitude: e.latLng.lat(), longitude: e.latLng.lng() } } });
            }));
            setMap(m);
        }).catch(() => { if (!dead) setFailed(true); });
        return () => { dead = true; listeners.forEach((l) => l.remove()); mapRef.current = null; setMap(null); };
    }, []);   // eslint-disable-line react-hooks/exhaustive-deps

    // a controlled region (the owner's small area map)
    useEffect(() => {
        const m = mapRef.current;
        if (!m || !region) return;
        m.setCenter({ lat: region.latitude, lng: region.longitude });
        m.setZoom(zoomFor(region.longitudeDelta, (box.current && box.current.clientWidth) || 400));
    }, [map, region && region.latitude, region && region.longitude, region && region.longitudeDelta]);   // eslint-disable-line react-hooks/exhaustive-deps

    // the blue "you are here" dot
    useEffect(() => {
        if (!map || !showsUserLocation || !navigator.geolocation) return undefined;
        const gm = gmaps();
        const dot = new gm.Marker({ map, clickable: false, zIndex: 999, icon: { path: gm.SymbolPath.CIRCLE, scale: 8, fillColor: '#4285F4', fillOpacity: 1, strokeColor: '#FFFFFF', strokeWeight: 2 } });
        const id = navigator.geolocation.watchPosition((p) => dot.setPosition({ lat: p.coords.latitude, lng: p.coords.longitude }), () => { }, { enableHighAccuracy: true, maximumAge: 15000 });
        return () => { navigator.geolocation.clearWatch(id); dot.setMap(null); };
    }, [map, showsUserLocation]);

    // what screens call through the ref
    useImperativeHandle(ref, () => {
        const m = () => mapRef.current;
        const centre = (c) => (c ? { lat: c.latitude, lng: c.longitude } : null);
        const camera = (cam) => {
            const mm = m(); if (!mm || !cam) return;
            if (cam.center) mm.panTo(centre(cam.center));
            if (Number.isFinite(cam.zoom)) mm.setZoom(cam.zoom);
            try { if (Number.isFinite(cam.heading)) mm.setHeading(cam.heading); if (Number.isFinite(cam.pitch)) mm.setTilt(cam.pitch); } catch (e) { /* a flat map has no heading */ }
        };
        return {
            animateToRegion: (r) => {
                const mm = m(); if (!mm || !r) return;
                mm.panTo(centre(r));
                mm.setZoom(zoomFor(r.longitudeDelta, (box.current && box.current.clientWidth) || 400));
            },
            animateCamera: camera,
            setCamera: camera,
            fitToCoordinates: (coords, opts = {}) => {
                const mm = m(); const gm = window.google && window.google.maps;
                if (!mm || !gm || !Array.isArray(coords) || !coords.length) return;
                const b = new gm.LatLngBounds();
                coords.forEach((c) => { const p = latLng(c); if (p) b.extend(p); });
                if (!b.isEmpty()) mm.fitBounds(b, padding(opts.edgePadding));
            },
            fitToElements: () => { },
            getCamera: async () => {
                const mm = m(); const c = mm && mm.getCenter();
                return { center: c ? { latitude: c.lat(), longitude: c.lng() } : null, zoom: mm ? mm.getZoom() : 0, heading: mm ? (mm.getHeading() || 0) : 0, pitch: mm ? (mm.getTilt() || 0) : 0 };
            },
            getMapBoundaries: async () => {
                const r = m() && regionOf(m());
                return r ? { northEast: { latitude: r.latitude + r.latitudeDelta / 2, longitude: r.longitude + r.longitudeDelta / 2 }, southWest: { latitude: r.latitude - r.latitudeDelta / 2, longitude: r.longitude - r.longitudeDelta / 2 } } : null;
            },
            pointForCoordinate: async () => ({ x: 0, y: 0 }),
            coordinateForPoint: async () => ({ latitude: 0, longitude: 0 }),
            takeSnapshot: async () => '',
        };
    }, []);

    if (failed) {
        return (
            <View style={[{ backgroundColor: '#e8ecef', alignItems: 'center', justifyContent: 'center', minHeight: 120 }, style]}>
                <Text style={{ color: '#6b7280', fontSize: 13 }}>Map is not available right now</Text>
            </View>
        );
    }
    return (
        <View style={[{ backgroundColor: '#e8ecef', minHeight: 120, overflow: 'hidden' }, style]}>
            {React.createElement('div', { ref: box, style: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } })}
            <MapCtx.Provider value={map}>{map ? children : null}</MapCtx.Provider>
        </View>
    );
});
export default MapView;

/* --------------------------------- markers --------------------------------- */
// A marker is a small <div> placed on the map by Google's OverlayView; its React children are drawn into it.
let OverlayClass = null;
function overlayClass() {
    if (OverlayClass) return OverlayClass;
    const gm = gmaps();
    OverlayClass = class extends gm.OverlayView {
        constructor(el, pos) { super(); this.el = el; this.pos = pos; }
        onAdd() { this.getPanes().overlayMouseTarget.appendChild(this.el); }
        draw() {
            const proj = this.getProjection();
            if (!proj || !this.pos) return;
            const pt = proj.fromLatLngToDivPixel(new (gmaps().LatLng)(this.pos.lat, this.pos.lng));
            if (pt) { this.el.style.left = `${pt.x}px`; this.el.style.top = `${pt.y}px`; }
        }
        onRemove() { if (this.el.parentNode) this.el.parentNode.removeChild(this.el); }
        setPosition(p) { this.pos = p; this.draw(); }
    };
    return OverlayClass;
}

export function Marker({ coordinate, anchor, rotation, zIndex, onPress, title, children }) {
    const map = useContext(MapCtx);
    const [el] = useState(() => { const d = document.createElement('div'); d.style.position = 'absolute'; return d; });
    const overlay = useRef(null);
    const pos = latLng(coordinate);

    useEffect(() => {
        if (!map) return undefined;
        const O = overlayClass();
        const o = new O(el, latLng(coordinate));
        o.setMap(map);
        overlay.current = o;
        return () => { o.setMap(null); overlay.current = null; };
    }, [map]);   // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => { if (overlay.current && pos) overlay.current.setPosition(pos); }, [pos && pos.lat, pos && pos.lng]);   // eslint-disable-line react-hooks/exhaustive-deps

    // a coordinate that moves by itself (the rider): follow it
    useEffect(() => {
        if (!coordinate || typeof coordinate.addListener !== 'function') return undefined;
        const id = coordinate.addListener((p) => { if (overlay.current) overlay.current.setPosition({ lat: p.latitude, lng: p.longitude }); });
        return () => coordinate.removeListener(id);
    }, [coordinate]);

    // anchor { x, y } is the part of the picture that sits ON the point (0..1); rotation turns it around that same point
    useEffect(() => {
        const a = anchor || { x: 0.5, y: 1 };
        el.style.transformOrigin = `${a.x * 100}% ${a.y * 100}%`;
        el.style.transform = `translate(${-a.x * 100}%, ${-a.y * 100}%)${rotation ? ` rotate(${rotation}deg)` : ''}`;
        el.style.zIndex = String(Number.isFinite(zIndex) ? zIndex : 0);
        el.style.cursor = onPress ? 'pointer' : 'default';
        if (title) el.title = String(title); else el.removeAttribute('title');
    }, [el, anchor && anchor.x, anchor && anchor.y, rotation, zIndex, onPress, title]);   // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!onPress) return undefined;
        const h = (e) => { e.stopPropagation(); onPress({ nativeEvent: { coordinate: pos ? { latitude: pos.lat, longitude: pos.lng } : null } }); };
        el.addEventListener('click', h);
        return () => el.removeEventListener('click', h);
    }, [el, onPress]);   // eslint-disable-line react-hooks/exhaustive-deps

    return createPortal(children == null ? null : children, el);
}
Marker.Animated = Marker;

/* ---------------------------- lines and circles ---------------------------- */
export function Polyline({ coordinates, strokeColor, strokeWidth = 1, zIndex, lineDashPattern }) {
    const map = useContext(MapCtx);
    const ref = useRef(null);
    useEffect(() => {
        if (!map) return undefined;
        const p = new (gmaps().Polyline)({ map, clickable: false });
        ref.current = p;
        return () => { p.setMap(null); ref.current = null; };
    }, [map]);
    const dashKey = JSON.stringify(lineDashPattern || null);
    useEffect(() => {
        const p = ref.current; if (!p) return;
        const { color, opacity } = parseColor(strokeColor, '#000000');
        const dash = dashSpec(lineDashPattern);
        p.setOptions({
            path: (coordinates || []).map(latLng).filter(Boolean),
            strokeColor: color,
            strokeOpacity: dash ? 0 : opacity,
            strokeWeight: strokeWidth,
            zIndex: Number.isFinite(zIndex) ? zIndex : undefined,
            icons: dash ? [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: opacity, strokeColor: color, strokeWeight: strokeWidth, scale: dash.scale }, offset: '0', repeat: dash.repeat }] : [],
        });
    }, [map, coordinates, strokeColor, strokeWidth, zIndex, dashKey]);   // eslint-disable-line react-hooks/exhaustive-deps
    return null;
}

export function Circle({ center, radius, fillColor, strokeColor, strokeWidth = 0, zIndex }) {
    const map = useContext(MapCtx);
    const ref = useRef(null);
    useEffect(() => {
        if (!map) return undefined;
        const c = new (gmaps().Circle)({ map, clickable: false });
        ref.current = c;
        return () => { c.setMap(null); ref.current = null; };
    }, [map]);
    useEffect(() => {
        const c = ref.current; if (!c) return;
        const fill = parseColor(fillColor, '#000000');
        const edge = parseColor(strokeColor, '#000000');
        const p = latLng(center);
        c.setOptions({
            center: p || undefined, radius: Number(radius) || 0,
            fillColor: fill.color, fillOpacity: fill.opacity,
            strokeColor: edge.color, strokeOpacity: strokeWidth > 0 ? edge.opacity : 0, strokeWeight: strokeWidth,
            zIndex: Number.isFinite(zIndex) ? zIndex : undefined,
        });
    }, [map, center && (center.latitude), center && (center.longitude), radius, fillColor, strokeColor, strokeWidth, zIndex]);   // eslint-disable-line react-hooks/exhaustive-deps
    return null;
}

const none = () => null;
export const Polygon = none;
export const Callout = none;
export const Overlay = none;
export { deltaFor };
