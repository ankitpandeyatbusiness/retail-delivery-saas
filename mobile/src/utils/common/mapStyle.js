// The clean map look used by every tracking map (the customer's live order, the order card, the owner's rider maps, the rider's own map):
// the road shapes, water and parks in soft colours, and NOTHING else. No shop or restaurant icons, no bus stops, no city / area
// names, no building names: the route, the rider and the home pin are what the eye should find, like Blinkit and Zomato.
// It is only a style that the phone applies to Google's map, so it costs nothing extra. The address pickers do NOT use it: when
// someone chooses an address he needs the place names.
import { useBrand } from '../../components/common/kit';

const off = { visibility: 'off' };

const LIGHT = [
    { elementType: 'geometry', stylers: [{ color: '#f2f2ee' }] },
    { elementType: 'labels.icon', stylers: [off] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#9a9a96' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }, { weight: 3 }] },
    { featureType: 'administrative', elementType: 'geometry', stylers: [off] },
    { featureType: 'administrative.land_parcel', stylers: [off] },
    { featureType: 'administrative.neighborhood', stylers: [off] },
    { featureType: 'administrative.locality', elementType: 'labels', stylers: [off] },
    { featureType: 'administrative.province', elementType: 'labels', stylers: [off] },
    { featureType: 'administrative.country', elementType: 'labels', stylers: [off] },
    { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#ebebe6' }] },
    { featureType: 'poi', stylers: [off] },
    { featureType: 'poi.park', elementType: 'geometry', stylers: [{ visibility: 'on' }, { color: '#e2eddb' }] },
    { featureType: 'transit', stylers: [off] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#e4e4df' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#fdf1d3' }] },
    { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#f1e2b6' }] },
    { featureType: 'road.local', elementType: 'labels', stylers: [off] },
    { featureType: 'road.arterial', elementType: 'labels.text.fill', stylers: [{ color: '#a8a8a3' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#cfe5f1' }] },
    { featureType: 'water', elementType: 'labels', stylers: [off] },
];

const DARK = [
    { elementType: 'geometry', stylers: [{ color: '#1d2024' }] },
    { elementType: 'labels.icon', stylers: [off] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#7d828a' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#1d2024' }, { weight: 3 }] },
    { featureType: 'administrative', elementType: 'geometry', stylers: [off] },
    { featureType: 'administrative.land_parcel', stylers: [off] },
    { featureType: 'administrative.neighborhood', stylers: [off] },
    { featureType: 'administrative.locality', elementType: 'labels', stylers: [off] },
    { featureType: 'administrative.province', elementType: 'labels', stylers: [off] },
    { featureType: 'administrative.country', elementType: 'labels', stylers: [off] },
    { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#23272c' }] },
    { featureType: 'poi', stylers: [off] },
    { featureType: 'poi.park', elementType: 'geometry', stylers: [{ visibility: 'on' }, { color: '#1f2b24' }] },
    { featureType: 'transit', stylers: [off] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2c3036' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#24282d' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3a3629' }] },
    { featureType: 'road.local', elementType: 'labels', stylers: [off] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#14202a' }] },
    { featureType: 'water', elementType: 'labels', stylers: [off] },
];

export const cleanMapStyle = (dark) => (dark ? DARK : LIGHT);

// inside a component: <MapView customMapStyle={useMapStyle()} />  (follows the app's light / dark theme)
export function useMapStyle() {
    const { dark } = useBrand();
    return cleanMapStyle(!!dark);
}
