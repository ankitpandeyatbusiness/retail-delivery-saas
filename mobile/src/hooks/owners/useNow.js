// The current time, updated every second, for countdowns ("cancels in 6:42") and "5 min ago" labels.
// Only runs while a screen that uses it is on screen. (JavaScript timers stop with the screen off, which is fine here.)
import { useEffect, useState } from 'react';

export function useNow(intervalMs = 1000, enabled = true) {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        if (!enabled) return undefined;
        setNow(Date.now());
        const t = setInterval(() => setNow(Date.now()), intervalMs);
        return () => clearInterval(t);
    }, [intervalMs, enabled]);
    return now;
}
