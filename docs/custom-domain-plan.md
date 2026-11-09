# Custom domain (Pro) - plan

Status: PLAN ONLY, nothing built. It needs the web build first (the Cloudflare Worker that serves the customer website), see the web and PWA plan.

## What you said
A Pro client gives you their domain (and name servers). You set it up yourself from the superadmin app. The client does nothing in the app. Everything is hosted on Cloudflare.

## Two ways on Cloudflare

| | A. Cloudflare for SaaS (custom hostnames) | B. The client's whole domain on your Cloudflare |
|---|---|---|
| What the client does | Adds ONE record at their domain company: `order.theirshop.com` CNAME to your fallback name (for example `shops.vivyaan.co.in`) | Changes the name servers of the whole domain to Cloudflare's two name servers |
| Name servers | Not changed. Their email and existing site keep working | Moved to you. You must copy every existing record (email, website) or it breaks |
| Padlock (SSL) | Cloudflare makes and renews it for each hostname | Cloudflare makes it for the zone |
| Plain `theirshop.com` (no `order.`) | Only if their domain company allows a CNAME on the bare domain (most do not) | Works |
| Your effort per client | A few minutes, by API or dashboard | More: zone, records, a Worker route, checks |
| Risk | Low | Higher: you now run their DNS |

Recommendation: use A for every client and ask them for a subdomain such as `order.theirshop.com`. Use B only when a client insists on the bare domain and accepts that you take over their DNS. Check Cloudflare's current price and limits for custom hostnames before you promise it (there is a free allowance, then a small per-hostname monthly price).

## What gets built (later)

**Server**
- `Tenant.customDomain`: `{ host, status: requested | waiting_dns | active | failed | removed, cfHostnameId, validation (records to show), verifiedAt, note }`. One host belongs to one shop (unique, lower case).
- Hostname to shop: the request's Host header is looked up in active custom domains (the same place that reads `x-tenant-slug` today). CORS allows only active hosts.
- Cloudflare calls (one service file): create the custom hostname, read its status, delete it. Keys in `.env`: `CF_API_TOKEN` (SSL and custom hostnames only), `CF_ZONE_ID`, `CF_FALLBACK_ORIGIN`.
- Pro gate: only a Pro shop can connect. When Pro ends, the domain stops working after the grace days and shows the gentle "website paused" page. The record is kept so it comes back on renewal.
- Safety: only the supreme admin can connect or remove (money guard list), a reason is logged, one pending request per shop, removing is always possible.

**Superadmin app** (the shop's Plan screen, a "Custom domain" card, only shown for Pro)
1. Type the domain the client gave you.
2. "Connect": the app creates the hostname and shows the exact records to send the client (the CNAME, and a validation record if Cloudflare asks for one). A "Copy message for the client" button gives a ready text.
3. "Check status": shows waiting, active or failed with the reason. Once active it is live.
4. "Remove": stops it and deletes it at Cloudflare.

**Owner app:** no screen needed. The Plan list already says "Your own website name (custom domain)". The row stays a teaser; the owner asks you through Help and support.

## Steps with the client (A)
1. Client sends you the domain, and says which subdomain (for example `order.theirshop.com`).
2. You connect it in the superadmin app and copy the message.
3. Client adds the CNAME (and the validation record if shown) at their domain company. This usually takes minutes, sometimes a few hours.
4. You press Check status until it says active. Open the site and test an order.
5. Add the link to the shop's Play Store and share material.

## Open questions before building
- Cloudflare account: a plan that includes Cloudflare for SaaS (confirm in your dashboard).
- Which fallback name to use (for example `shops.vivyaan.co.in`).
- Whether the shop's customers must keep working on the `shopname.vivyaan.co.in` link as well (recommended: yes, both work).
- Order of work: the website build first, then this (about a day of work after the Worker exists).
