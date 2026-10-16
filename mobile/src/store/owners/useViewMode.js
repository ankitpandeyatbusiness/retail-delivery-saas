// The owner can look at the app the way a customer sees it. This only switches which screens are drawn (see Landing in
// navigation/AppNavigator.jsx); the login stays the owner's, so the server still refuses an order from his number.
// Not saved: opening the app again always starts in the owner panel.
import { create } from 'zustand';

export const useViewMode = create((set) => ({
    customerView: false,
    setCustomerView: (customerView) => set({ customerView }),
}));
