import { create } from 'zustand';

interface OrderState {
  grabbedOrder: Record<string, unknown> | null;
  setGrabbedOrder: (order: Record<string, unknown> | null) => void;
}

export const useOrderStore = create<OrderState>((set) => ({
  grabbedOrder: null,
  setGrabbedOrder: (order: Record<string, unknown> | null) => set({ grabbedOrder: order }),
}));
