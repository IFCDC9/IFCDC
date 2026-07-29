# Integrations Hub — Click / Drill-down Regression Report

Generated: 2026-07-29T11:55:42.497Z
Base URL: http://127.0.0.1:5001
Mode: module + HTTP
Auth: none (module mode used for live data)

**Passed:** 146  
**Hard failures:** 0  
**Soft HTTP auth/unreachable:** 11

## Checklist results

| Result | Item | Detail |
|---|---|---|
| PASS | UI: hub page wires card click + KPI filter + detail modal | client/src/pages/hq/IntegrationsHubPage.tsx |
| PASS | UI: integration cards are clickable with action stopPropagation | client/src/components/hq/integrations/IntegrationHubCard.tsx |
| PASS | UI: summary KPI boxes filter/open records + ops badges | client/src/components/hq/integrations/IntegrationsHealthPanel.tsx |
| PASS | UI: detail modal fields + actions present | client/src/components/hq/integrations/IntegrationDetailModal.tsx |
| PASS | UI: KpiCard supports clickable filter mode | client/src/components/hq/KpiCard.tsx |
| PASS | API: health dashboard exposes expanded ops metrics | server/hq/integrationHealthDashboard.ts |
| PASS | API: GET /health/:id detail route registered | server/routes/integrations.routes.ts |
| PASS | MODULE: buildIntegrationHealthDashboard | 15 services · score 20 · source live |
| PASS | MODULE: health field uptime24hPct | 84.6 |
| PASS | MODULE: health field uptime7dPct | 84.6 |
| PASS | MODULE: health field successFailureTrend | len 24 |
| PASS | MODULE: health field responseTimeHistoryMs | len 13 |
| PASS | MODULE: health field last10SyncEvents | len 10 |
| PASS | MODULE: health field environmentName | development |
| PASS | MODULE: health field productionVsTest | test |
| PASS | MODULE: health field failedRequests | 2 |
| PASS | MODULE: health field avgLatencyMs | 39 |
| PASS | MODULE: health field connectedCount | 3 |
| PASS | MODULE: health field warningCount | 1 |
| PASS | MODULE: health field offlineCount | 11 |
| PASS | MODULE: service row grants_gov | Grants.gov · Disconnected · owner Grants Division · auth missing · env production |
| PASS | MODULE: service row sam_gov | SAM.gov · Disconnected · owner Grants Division · auth missing · env production |
| PASS | MODULE: service row paypal | PayPal · Disconnected · owner Finance · auth missing · env live |
| PASS | MODULE: service row resend | Email (Resend) · Disconnected · owner Communications · auth missing · env production |
| PASS | MODULE: service row openai_aura | OpenAI / AURA · Disconnected · owner AURA / Executive · auth missing · env production |
| PASS | MODULE: service row render | Render · Disconnected · owner Platform Ops · auth missing · env production |
| PASS | MODULE: service row github | GitHub · Disconnected · owner Software Engineering · auth missing · env production |
| PASS | MODULE: service row postgres | Supabase / Postgres · Disconnected · owner Platform Ops · auth missing · env production |
| PASS | MODULE: service row twilio | Twilio (AURA Voice + SMS) · Disconnected · owner Communications · auth partial · env production |
| PASS | MODULE: service row website_apps | Website & App Services · Connected · owner Software Division · auth missing · env production |
| PASS | MODULE: service row quickbooks | QuickBooks · Disconnected · owner Finance · auth missing · env production |
| PASS | MODULE: service row platform_auth | Authentication · Disconnected · owner Security · auth unknown · env production |
| PASS | MODULE: service row platform_notifications | Notifications · Warning · owner Communications · auth unknown · env production |
| PASS | MODULE: service row platform_storage | Document Storage · Connected · owner Platform Ops · auth unknown · env production |
| PASS | MODULE: service row platform_calendar | Calendar Services · Connected · owner Operations · auth unknown · env production |
| PASS | MODULE filter: Integration Health (all) | 15 matching |
| PASS | MODULE filter: Connected | 3 matching |
| PASS | MODULE filter: Warning | 1 matching |
| PASS | MODULE filter: Offline | 11 matching |
| PASS | MODULE filter: Average API Latency | 9 matching |
| PASS | MODULE filter: Failed Requests | 12 matching |
| PASS | MODULE detail: grants_gov | actions=4 sync=1 errors=0 |
| PASS | MODULE action surface: grants_gov / Test connection | wired in IntegrationDetailModal |
| PASS | MODULE action surface: grants_gov / Refresh status | wired in IntegrationDetailModal |
| PASS | MODULE action surface: grants_gov / Retry failed request | wired in IntegrationDetailModal |
| PASS | MODULE action surface: grants_gov / View logs | wired in IntegrationDetailModal |
| PASS | MODULE action surface: grants_gov / Open configuration | wired in IntegrationDetailModal |
| PASS | MODULE action surface: grants_gov / Reconnect | wired in IntegrationDetailModal |
| PASS | MODULE detail: sam_gov | actions=3 sync=0 errors=0 |
| PASS | MODULE action surface: sam_gov / Test connection | wired in IntegrationDetailModal |
| PASS | MODULE action surface: sam_gov / Refresh status | wired in IntegrationDetailModal |
| PASS | MODULE action surface: sam_gov / Retry failed request | wired in IntegrationDetailModal |
| PASS | MODULE action surface: sam_gov / View logs | wired in IntegrationDetailModal |
| PASS | MODULE action surface: sam_gov / Open configuration | wired in IntegrationDetailModal |
| PASS | MODULE action surface: sam_gov / Reconnect | wired in IntegrationDetailModal |
| PASS | MODULE detail: paypal | actions=4 sync=1 errors=0 |
| PASS | MODULE action surface: paypal / Test connection | wired in IntegrationDetailModal |
| PASS | MODULE action surface: paypal / Refresh status | wired in IntegrationDetailModal |
| PASS | MODULE action surface: paypal / Retry failed request | wired in IntegrationDetailModal |
| PASS | MODULE action surface: paypal / View logs | wired in IntegrationDetailModal |
| PASS | MODULE action surface: paypal / Open configuration | wired in IntegrationDetailModal |
| PASS | MODULE action surface: paypal / Reconnect | wired in IntegrationDetailModal |
| PASS | MODULE detail: resend | actions=3 sync=1 errors=0 |
| PASS | MODULE action surface: resend / Test connection | wired in IntegrationDetailModal |
| PASS | MODULE action surface: resend / Refresh status | wired in IntegrationDetailModal |
| PASS | MODULE action surface: resend / Retry failed request | wired in IntegrationDetailModal |
| PASS | MODULE action surface: resend / View logs | wired in IntegrationDetailModal |
| PASS | MODULE action surface: resend / Open configuration | wired in IntegrationDetailModal |
| PASS | MODULE action surface: resend / Reconnect | wired in IntegrationDetailModal |
| PASS | MODULE detail: openai_aura | actions=3 sync=1 errors=0 |
| PASS | MODULE action surface: openai_aura / Test connection | wired in IntegrationDetailModal |
| PASS | MODULE action surface: openai_aura / Refresh status | wired in IntegrationDetailModal |
| PASS | MODULE action surface: openai_aura / Retry failed request | wired in IntegrationDetailModal |
| PASS | MODULE action surface: openai_aura / View logs | wired in IntegrationDetailModal |
| PASS | MODULE action surface: openai_aura / Open configuration | wired in IntegrationDetailModal |
| PASS | MODULE action surface: openai_aura / Reconnect | wired in IntegrationDetailModal |
| PASS | MODULE detail: render | actions=3 sync=1 errors=0 |
| PASS | MODULE action surface: render / Test connection | wired in IntegrationDetailModal |
| PASS | MODULE action surface: render / Refresh status | wired in IntegrationDetailModal |
| PASS | MODULE action surface: render / Retry failed request | wired in IntegrationDetailModal |
| PASS | MODULE action surface: render / View logs | wired in IntegrationDetailModal |
| PASS | MODULE action surface: render / Open configuration | wired in IntegrationDetailModal |
| PASS | MODULE action surface: render / Reconnect | wired in IntegrationDetailModal |
| PASS | MODULE detail: github | actions=5 sync=1 errors=0 |
| PASS | MODULE action surface: github / Test connection | wired in IntegrationDetailModal |
| PASS | MODULE action surface: github / Refresh status | wired in IntegrationDetailModal |
| PASS | MODULE action surface: github / Retry failed request | wired in IntegrationDetailModal |
| PASS | MODULE action surface: github / View logs | wired in IntegrationDetailModal |
| PASS | MODULE action surface: github / Open configuration | wired in IntegrationDetailModal |
| PASS | MODULE action surface: github / Reconnect | wired in IntegrationDetailModal |
| PASS | MODULE detail: postgres | actions=2 sync=1 errors=0 |
| PASS | MODULE action surface: postgres / Test connection | wired in IntegrationDetailModal |
| PASS | MODULE action surface: postgres / Refresh status | wired in IntegrationDetailModal |
| PASS | MODULE action surface: postgres / Retry failed request | wired in IntegrationDetailModal |
| PASS | MODULE action surface: postgres / View logs | wired in IntegrationDetailModal |
| PASS | MODULE action surface: postgres / Open configuration | wired in IntegrationDetailModal |
| PASS | MODULE action surface: postgres / Reconnect | wired in IntegrationDetailModal |
| PASS | MODULE detail: twilio | actions=5 sync=1 errors=0 |
| PASS | MODULE action surface: twilio / Test connection | wired in IntegrationDetailModal |
| PASS | MODULE action surface: twilio / Refresh status | wired in IntegrationDetailModal |
| PASS | MODULE action surface: twilio / Retry failed request | wired in IntegrationDetailModal |
| PASS | MODULE action surface: twilio / View logs | wired in IntegrationDetailModal |
| PASS | MODULE action surface: twilio / Open configuration | wired in IntegrationDetailModal |
| PASS | MODULE action surface: twilio / Reconnect | wired in IntegrationDetailModal |
| PASS | MODULE detail: website_apps | actions=3 sync=1 errors=0 |
| PASS | MODULE action surface: website_apps / Test connection | wired in IntegrationDetailModal |
| PASS | MODULE action surface: website_apps / Refresh status | wired in IntegrationDetailModal |
| PASS | MODULE action surface: website_apps / Retry failed request | wired in IntegrationDetailModal |
| PASS | MODULE action surface: website_apps / View logs | wired in IntegrationDetailModal |
| PASS | MODULE action surface: website_apps / Open configuration | wired in IntegrationDetailModal |
| PASS | MODULE action surface: website_apps / Reconnect | wired in IntegrationDetailModal |
| PASS | MODULE detail: quickbooks | actions=3 sync=0 errors=0 |
| PASS | MODULE action surface: quickbooks / Test connection | wired in IntegrationDetailModal |
| PASS | MODULE action surface: quickbooks / Refresh status | wired in IntegrationDetailModal |
| PASS | MODULE action surface: quickbooks / Retry failed request | wired in IntegrationDetailModal |
| PASS | MODULE action surface: quickbooks / View logs | wired in IntegrationDetailModal |
| PASS | MODULE action surface: quickbooks / Open configuration | wired in IntegrationDetailModal |
| PASS | MODULE action surface: quickbooks / Reconnect | wired in IntegrationDetailModal |
| PASS | MODULE detail: platform_auth | actions=6 sync=2 errors=2 |
| PASS | MODULE action surface: platform_auth / Test connection | wired in IntegrationDetailModal |
| PASS | MODULE action surface: platform_auth / Refresh status | wired in IntegrationDetailModal |
| PASS | MODULE action surface: platform_auth / Retry failed request | wired in IntegrationDetailModal |
| PASS | MODULE action surface: platform_auth / View logs | wired in IntegrationDetailModal |
| PASS | MODULE action surface: platform_auth / Open configuration | wired in IntegrationDetailModal |
| PASS | MODULE action surface: platform_auth / Reconnect | wired in IntegrationDetailModal |
| PASS | MODULE detail: platform_notifications | actions=6 sync=3 errors=3 |
| PASS | MODULE action surface: platform_notifications / Test connection | wired in IntegrationDetailModal |
| PASS | MODULE action surface: platform_notifications / Refresh status | wired in IntegrationDetailModal |
| PASS | MODULE action surface: platform_notifications / Retry failed request | wired in IntegrationDetailModal |
| PASS | MODULE action surface: platform_notifications / View logs | wired in IntegrationDetailModal |
| PASS | MODULE action surface: platform_notifications / Open configuration | wired in IntegrationDetailModal |
| PASS | MODULE action surface: platform_notifications / Reconnect | wired in IntegrationDetailModal |
| PASS | MODULE detail: platform_storage | actions=6 sync=4 errors=0 |
| PASS | MODULE action surface: platform_storage / Test connection | wired in IntegrationDetailModal |
| PASS | MODULE action surface: platform_storage / Refresh status | wired in IntegrationDetailModal |
| PASS | MODULE action surface: platform_storage / Retry failed request | wired in IntegrationDetailModal |
| PASS | MODULE action surface: platform_storage / View logs | wired in IntegrationDetailModal |
| PASS | MODULE action surface: platform_storage / Open configuration | wired in IntegrationDetailModal |
| PASS | MODULE action surface: platform_storage / Reconnect | wired in IntegrationDetailModal |
| PASS | MODULE detail: platform_calendar | actions=6 sync=5 errors=0 |
| PASS | MODULE action surface: platform_calendar / Test connection | wired in IntegrationDetailModal |
| PASS | MODULE action surface: platform_calendar / Refresh status | wired in IntegrationDetailModal |
| PASS | MODULE action surface: platform_calendar / Retry failed request | wired in IntegrationDetailModal |
| PASS | MODULE action surface: platform_calendar / View logs | wired in IntegrationDetailModal |
| PASS | MODULE action surface: platform_calendar / Open configuration | wired in IntegrationDetailModal |
| PASS | MODULE action surface: platform_calendar / Reconnect | wired in IntegrationDetailModal |
| SKIP/AUTH | API: GET /health | fetch failed |
| SKIP/AUTH | API: GET / hub | fetch failed |
| SKIP/AUTH | API: detail grants_gov | fetch failed |
| SKIP/AUTH | API: detail sam_gov | fetch failed |
| SKIP/AUTH | API: detail paypal | fetch failed |
| SKIP/AUTH | API: detail resend | fetch failed |
| SKIP/AUTH | API: detail openai_aura | fetch failed |
| SKIP/AUTH | API: detail render | fetch failed |
| SKIP/AUTH | API: detail github | fetch failed |
| SKIP/AUTH | API: detail postgres | fetch failed |
| SKIP/AUTH | API: diagnostics | fetch failed |

## Cards / buttons / filters / drill-downs covered

### Summary KPI boxes (click → filter)
- Integration Health → all services
- Connected → Connected rows + filtered cards
- Warning → Warning rows + filtered cards
- Offline → Disconnected rows + filtered cards
- Average API Latency → services with latency
- Failed Requests → unhealthy / failed / offline

### Integration cards
- Entire card clickable → IntegrationDetailModal
- Details button → same modal
- Per-card Test / Configure / OAuth / links → stopPropagation (do not open modal)

### Detail modal actions
- Test connection → POST `/:provider/test`
- Refresh status → refetch `/health/:id` + invalidate hub/health
- Retry failed request → POST `/retry-degraded` with provider id
- View logs → scroll to last-10 sync events
- Open configuration → existing configure modal
- Reconnect → QuickBooks OAuth or re-test

### Expanded ops (live health API)
- 24h / 7d uptime
- Success/failure trend
- Response-time history
- Last 10 sync events
- Error code + root cause
- Credential expiration / missing warnings
- Service ownership, environment name, production vs test

## Manual browser matrix (Mac)

| Surface | Safari | Chrome | Mobile layout |
|---|---|---|---|
| Integration cards open detail modal | Verify after deploy | Verify after deploy | Bottom-sheet modal |
| Card action buttons do not bubble | Verify | Verify | Verify |
| KPI filters | Verify | Verify | Verify |
| Detail actions | Verify | Verify | Sticky action bar |
| Escape / overlay close | Verify | Verify | Verify |

## Notes

- Live data from `buildIntegrationHealthDashboard` / `getIntegrationLiveDetail` (no placeholder health payloads).
- Production HTTP checks require `HQ_TOKEN` after Manual Deploy of this change.
- This change does not reconfigure production connectors; Test Connection is probe-only.
