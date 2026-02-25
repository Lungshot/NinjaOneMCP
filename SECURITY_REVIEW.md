# NinjaOne MCP - Security Automation Review

## Purpose

Review of the NinjaOne MCP codebase for use in automated security reporting
workflows alongside SentinelOne, Huntress, and Umbrella DNS MCPs.

## Verdict: Strong Value Add

NinjaOne fills the **asset inventory and posture management** gap that
detection-focused tools (SentinelOne, Huntress, Umbrella) cannot. It provides
the organizational spine: which devices exist, what's installed, what's patched,
what's healthy, and who owns them.

## Security-Relevant Capabilities (60+ tools)

| Category | Key Tools | Report Value |
|---|---|---|
| Asset Inventory | `get_devices`, `query_computer_systems` | Baseline for all other data |
| Patch Posture | `query_os_patches`, `query_software_patches` | Missing critical patches per customer |
| AV Coverage | `query_antivirus_status`, `query_antivirus_threats` | Gaps in endpoint protection |
| Software Inventory | `query_software`, `get_device_software` | Unauthorized/vulnerable apps |
| Device Health | `query_device_health` | Offline, unhealthy, stale devices |
| Backup Status | `query_backup_usage` | Ransomware recovery readiness |
| Multi-tenant | `get_organizations` | Per-customer reporting |
| Alerts | `get_alerts`, `get_device_alerts` | NinjaOne-native alerting |

## Code Issues Found

### Critical
1. **CORS wildcard default** - `src/transport/http.ts:19,123` defaults to `origin: '*'`
2. **Hardcoded `Access-Control-Allow-Origin: *`** in SSE writeHead - `src/transport/http.ts:149`

### Medium
3. **No fetch timeouts** - `src/ninja-api.ts:109,161` - hanging requests block server
4. **SSRF via set_region** - `src/index.ts:1073` - arbitrary URLs accepted without validation
5. **Duplicate tool definition** - `src/index.ts:149-170` - `get_device_software` defined twice
6. **200-device search cap** - `src/index.ts:1216,1232` - silent truncation
7. **Alert device filter ignored** - `src/index.ts:1050` - `df` hardcoded to undefined
8. **Error messages leak endpoints** - `src/ninja-api.ts:90`

### Low
9. Version mismatch between package.json (1.2.13) and manifest.json (1.2.14)
10. Hardcoded maintenance disabledFeatures not configurable

## Missing API Coverage

The following NinjaOne API endpoints would enhance security workflows but are
not exposed in this MCP:

- `/v2/activities` - Global activity/audit log
- `/v2/ticketing/*` - Auto-create tickets from findings
- `/v2/device/{id}/script/*` - Remediation script execution
- Device custom field writes - Stamp risk scores/report dates
- Saved filters/groups - Map to report scopes

## Recommendation

Use this MCP as the asset and posture layer in the security reporting stack.
Before production use, fix items #3 (timeouts), #6 (search cap), and #7 (alert
filter) as they directly impact report accuracy.
