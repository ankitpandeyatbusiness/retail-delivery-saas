// The work screen of a kitchen or waiter person: the cook gets the kitchen queue, the waiter gets the floor.
import React from 'react';
import KitchenScreen from './KitchenScreen';
import WaiterScreen from './WaiterScreen';
import { useStaffStore } from '../../store/staff/useStaffStore';

export default function StaffHomeScreen() {
    const job = useStaffStore((st) => st.me?.role);
    return job === 'kitchen' ? <KitchenScreen /> : <WaiterScreen />;
}
