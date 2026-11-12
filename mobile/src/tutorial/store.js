// The tutorial's memory: is it switched on, which story is running and at which step, which stories were finished.
// Kept on the device (cache), so a story survives the app restart that a panel switch causes. Only the demo uses it.
import { create } from 'zustand';
import { readCache, writeCache } from '../utils/common/cache';
import { storyById } from './stories';

const KEY = 'tutorial';
let lastTap = 0;

const save = (s) => writeCache(KEY, { enabled: s.enabled, activeId: s.activeId, step: s.step, done: s.done, offered: s.offered });

export const useTutorialStore = create((set, get) => ({
    loaded: false,
    enabled: true,      // the switch: off = explore freely
    activeId: null,     // the running story
    step: 0,
    done: [],           // finished story ids
    offered: false,     // the story menu was shown once after the demo started
    menuOpen: false,
    targetId: null,     // the button the current step circles (read by <CoachTarget>)

    hydrate: async () => {
        if (get().loaded) return;
        const c = (await readCache(KEY)) || {};
        const story = c.activeId ? storyById(c.activeId) : null;
        const step = story ? Math.min(Math.max(0, c.step | 0), story.steps.length - 1) : 0;
        set({ loaded: true, enabled: c.enabled !== false, activeId: story ? story.id : null, step, done: Array.isArray(c.done) ? c.done : [], offered: !!c.offered, targetId: story ? story.steps[step].target || null : null });
    },

    setEnabled: (on) => {
        set({ enabled: !!on, ...(on ? {} : { activeId: null, step: 0, targetId: null, menuOpen: false }) });
        save(get());
    },
    openMenu: () => { set({ menuOpen: true, offered: true }); save(get()); },
    closeMenu: () => set({ menuOpen: false }),

    start: (id) => {
        const story = storyById(id);
        if (!story) return;
        set({ enabled: true, activeId: id, step: 0, menuOpen: false, targetId: story.steps[0].target || null });
        save(get());
    },
    go: (n) => {
        const story = storyById(get().activeId);
        if (!story) return;
        if (n >= story.steps.length) { get().finish(); return; }
        const step = Math.max(0, n);
        set({ step, targetId: story.steps[step].target || null });
        save(get());
    },
    next: () => get().go(get().step + 1),
    back: () => get().go(get().step - 1),
    finish: () => {
        const { activeId, done } = get();
        set({ activeId: null, step: 0, targetId: null, done: activeId && !done.includes(activeId) ? [...done, activeId] : done, menuOpen: true });
        save(get());
    },
    quit: () => { set({ activeId: null, step: 0, targetId: null }); save(get()); },

    // a button that a step circles was tapped (called by <CoachTarget>): the story moves on
    // (a touch and a click can both arrive for one tap: the second is ignored)
    tapped: (id) => {
        if (get().targetId !== id) return;
        const now = Date.now();
        if (now - lastTap < 800) return;
        lastTap = now;
        setTimeout(() => get().next(), 350);
    },
}));
