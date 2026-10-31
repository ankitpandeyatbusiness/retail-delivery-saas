// The inquiry the owner is looking at right now (its screen is open): the voice for the customer's replies on it stays quiet, the toast still shows.
import { create } from 'zustand';

export const useOpenInquiry = create((set) => ({
    id: null,
    set: (id) => set({ id: id ? String(id) : null }),
}));

export const isOpenInquiry = (type, data) => type === 'inquiry_customer_reply' && !!data?.inquiryId && String(data.inquiryId) === useOpenInquiry.getState().id;
