import { useEffect, useState } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { fetchMe } from '../api/authApi';

// Is the person logged in the supreme admin (the one superadmin who may change money, the settlement sheet and the agreements)?
// The server decides (GET /admin/me); this only hides buttons the server would refuse anyway.
let cached = { token: null, value: false };

export function useSupreme() {
    const token = useAuthStore((s) => s.token);
    const [value, setValue] = useState(cached.token === token ? cached.value : false);
    useEffect(() => {
        if (!token) return undefined;
        if (cached.token === token) { setValue(cached.value); return undefined; }
        let on = true;
        fetchMe().then((m) => { cached = { token, value: !!m.supreme }; if (on) setValue(!!m.supreme); }).catch(() => { });
        return () => { on = false; };
    }, [token]);
    return value;
}
