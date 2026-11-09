// The two per-shop god switches (set by the supreme admin on the shop's Plan screen): webEnabled and nativeEnabled (tenant.plan.*).
//   web on,  app on   both work (the website shows a "Get the app" banner; the app has no website button)
//   web off, app on   the website says "available on its app only" with the Play Store link; the app works
//   web on,  app off  the installed app (customers) says "this shop is now on the website" with a button; the website works
//   both off          both say "temporarily unavailable"
// A web request carries the header  x-client: web  (the website build sets it); every other request is the installed app. Owners, riders and staff
// are never shown the customer message: the apps decide by role, and the server only refuses NEW customer work (orders, bookings, bulk, inquiries).
const DOMAIN = () => process.env.PLATFORM_WEB_DOMAIN || 'vivyaan.co.in';

const isWeb = (req) => String(req?.headers?.['x-client'] || '').toLowerCase() === 'web';

// the state for one shop as seen by `client` ('web' | 'app'). tenant needs slug, androidPackage and plan.
function stateOf(tenant, client) {
    const p = tenant?.plan || {};
    const web = p.webEnabled !== false;
    const app = p.nativeEnabled !== false;
    const off = client === 'web' ? !web : !app;
    const webUrl = tenant?.slug ? `https://${tenant.slug}.${DOMAIN()}` : null;
    const playStoreUrl = tenant?.androidPackage ? `https://play.google.com/store/apps/details?id=${tenant.androidPackage}` : null;
    let kind = 'ok';
    let message = null;
    if (off) {
        if (!web && !app) { kind = 'unavailable'; message = 'This shop is temporarily unavailable. Please try again later.'; }
        else if (client === 'web') { kind = 'app_only'; message = 'This shop is available on its app only.'; }
        else { kind = 'web_only'; message = 'This shop is now on the website. Please order there.'; }
    }
    return { off, kind, message, webEnabled: web, nativeEnabled: app, webUrl: kind === 'web_only' ? webUrl : null, playStoreUrl: kind === 'app_only' ? playStoreUrl : null };
}

// what the config answer carries for the apps (the app asks for its own client)
const forConfig = (tenant, client) => {
    const s = stateOf(tenant, client);
    return { off: s.off, kind: s.kind, message: s.message, webUrl: s.webUrl, playStoreUrl: s.playStoreUrl, webEnabled: s.webEnabled, nativeEnabled: s.nativeEnabled, ...(client === 'web' && s.webEnabled && s.nativeEnabled && tenant?.androidPackage ? { getAppUrl: `https://play.google.com/store/apps/details?id=${tenant.androidPackage}` } : {}) };
};

// customer routes where a NEW piece of work starts (a change, never a read): refused while the channel is off
const NEW_WORK = /^\/api\/(orders|bookings|bulk|services|dinein)(\/|$|\?)/;
const refusal = (req, tenant) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return null;
    if (!NEW_WORK.test(req.originalUrl)) return null;
    const s = stateOf(tenant, isWeb(req) ? 'web' : 'app');
    if (!s.off) return null;
    return { error: s.message, channelOff: true, kind: s.kind, webUrl: s.webUrl, playStoreUrl: s.playStoreUrl };
};

module.exports = { stateOf, forConfig, refusal, isWeb };
