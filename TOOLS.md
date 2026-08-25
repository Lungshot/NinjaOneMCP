# NinjaONE MCP Server - Tools Reference

This document provides detailed information about all available tools in the NinjaONE MCP server.

## Confirmation Pattern

All tools that **mutate state** include a `confirm` boolean parameter (default `false`).
When `confirm` is false the tool performs a **dry-run**: it returns a human-readable
description of what would happen and instructs the caller to re-invoke with
`confirm: true` to execute.

Example dry-run response:
```
DRY RUN — no changes made.
Would reboot device id=123 (SCB-PC18) in NORMAL mode.
Re-call with confirm=true to execute.
```

Tools marked with **(confirm)** below use this pattern.

---

## Phase 1 — Read-only operations

### Device Management

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_devices` | List devices with optional filtering | `df?`, `pageSize?`, `after?` |
| `get_device` | Get device details by ID | `id` |
| `get_device_software` | Get installed software for a device | `id` |
| `get_device_activities` | Get activity history for a device | `id`, `pageSize?` |
| `get_device_dashboard_url` | Get dashboard URL for a device | `id` |
| `search_devices_by_name` | Search devices by name (client-side) | `name`, `limit?` |
| `find_windows11_devices` | Find Windows 11 devices | `limit?` |

### Organization Management

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_organizations` | List all organizations | `pageSize?`, `after?` |
| `get_organization` | Get organization details | `id` |
| `get_organization_locations` | Get locations for an organization | `id` |
| `get_organization_policies` | Get policies for an organization | `id` |
| `create_organization` | Create a new organization | `name`, `description?`, `nodeApprovalMode?`, `tags?` |
| `update_organization` | Update an organization | `id`, `name?`, `description?`, `tags?` |
| `generate_organization_installer` | Generate device installer | `installerType`, `organizationId?`, `locationId?` |

### Locations

| Tool | Description | Parameters |
|------|-------------|------------|
| `create_location` | Create a location | `organizationId`, `name`, `address?`, `description?` |
| `update_location` | Update a location | `organizationId`, `locationId`, `name?`, `address?`, `description?` |

### Alerts

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_alerts` | Get system alerts | `since?` |
| `get_alert` | Get alert by UID | `uid` |
| `get_device_alerts` | Get alerts for a device | `id`, `lang?` |

### Users & Roles

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_end_users` | List end users | — |
| `get_end_user` | Get end user by ID | `id` |
| `create_end_user` | Create an end user | `firstName`, `lastName`, `email`, `phone?`, `organizationId?`, `fullPortalAccess?`, `sendInvitation?` |
| `update_end_user` | Update an end user | `id`, `firstName?`, `lastName?`, `email?`, `phone?` |
| `delete_end_user` | Delete an end user | `id` |
| `get_technicians` | List technicians | — |
| `get_technician` | Get technician by ID | `id` |
| `add_role_members` | Add users to a role | `roleId`, `userIds` |
| `remove_role_members` | Remove users from a role | `roleId`, `userIds` |

### Contacts

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_contacts` | List contacts | — |
| `get_contact` | Get contact by ID | `id` |
| `create_contact` | Create a contact | `organizationId`, `firstName`, `lastName`, `email`, `phone?`, `jobTitle?` |
| `update_contact` | Update a contact | `id`, `firstName?`, `lastName?`, `email?`, `phone?`, `jobTitle?` |
| `delete_contact` | Delete a contact | `id` |

### Device Control

| Tool | Description | Parameters |
|------|-------------|------------|
| `control_windows_service` | Control a Windows service | `id`, `serviceId`, `action` (START/STOP/RESTART) |
| `configure_windows_service` | Configure service startup type | `id`, `serviceId`, `startupType` |

### Patch Scanning

| Tool | Description | Parameters |
|------|-------------|------------|
| `scan_device_os_patches` | Scan for OS patches | `id` |
| `scan_device_software_patches` | Scan for software patches | `id` |

### System Information Queries

| Tool | Description | Parameters |
|------|-------------|------------|
| `query_antivirus_status` | Antivirus status across devices | `df?`, `cursor?`, `pageSize?` |
| `query_antivirus_threats` | Antivirus threat detections | `df?`, `cursor?`, `pageSize?` |
| `query_computer_systems` | Computer system information | `df?`, `cursor?`, `pageSize?` |
| `query_device_health` | Device health status | `df?`, `cursor?`, `pageSize?` |
| `query_operating_systems` | Operating system info | `df?`, `cursor?`, `pageSize?` |
| `query_logged_on_users` | Currently logged-on users | `df?`, `cursor?`, `pageSize?` |

### Hardware Queries

| Tool | Description | Parameters |
|------|-------------|------------|
| `query_processors` | Processor information | `df?`, `cursor?`, `pageSize?` |
| `query_disks` | Disk drive information | `df?`, `cursor?`, `pageSize?` |
| `query_volumes` | Disk volume information | `df?`, `cursor?`, `pageSize?` |
| `query_network_interfaces` | Network interfaces | `df?`, `cursor?`, `pageSize?` |
| `query_raid_controllers` | RAID controllers | `df?`, `cursor?`, `pageSize?` |
| `query_raid_drives` | RAID drives | `df?`, `cursor?`, `pageSize?` |

### Software & Patch Queries

| Tool | Description | Parameters |
|------|-------------|------------|
| `query_software` | Installed software | `df?`, `cursor?`, `pageSize?` |
| `query_os_patches` | OS patches | `df?`, `cursor?`, `pageSize?` |
| `query_software_patches` | Software patches | `df?`, `cursor?`, `pageSize?` |
| `query_os_patch_installs` | OS patch install history | `df?`, `cursor?`, `pageSize?` |
| `query_software_patch_installs` | Software patch install history | `df?`, `cursor?`, `pageSize?` |
| `query_windows_services` | Windows services | `df?`, `cursor?`, `pageSize?` |

### Custom Fields & Policy Queries

| Tool | Description | Parameters |
|------|-------------|------------|
| `query_custom_fields` | Custom field values | `df?`, `cursor?`, `pageSize?` |
| `query_custom_fields_detailed` | Detailed custom fields | `df?`, `cursor?`, `pageSize?` |
| `query_scoped_custom_fields` | Scoped custom fields | `df?`, `cursor?`, `pageSize?` |
| `query_scoped_custom_fields_detailed` | Detailed scoped custom fields | `df?`, `cursor?`, `pageSize?` |
| `query_policy_overrides` | Policy overrides | `df?`, `cursor?`, `pageSize?` |
| `query_backup_usage` | Backup usage statistics | `df?`, `cursor?`, `pageSize?` |

### Region Utilities

| Tool | Description | Parameters |
|------|-------------|------------|
| `list_regions` | List supported regions and base URLs | — |
| `set_region` | Set region or base URL | `region?`, `baseUrl?` |

---

## Phase 2 — Write operations with confirmation guardrails

### Alert Management

| Tool | Confirm | Description | Parameters |
|------|---------|-------------|------------|
| `reset_alert` | **(confirm)** | Reset/acknowledge an alert | `uid`, `confirm?` |

### Device Management

| Tool | Confirm | Description | Parameters |
|------|---------|-------------|------------|
| `reboot_device` | **(confirm)** | Reboot a device | `id`, `mode?` (NORMAL/FORCED), `confirm?` |
| `set_device_maintenance` | **(confirm)** | Set maintenance mode | `id`, `mode` (ON/OFF), `duration?`, `confirm?` |
| `update_device` | **(confirm)** | Update display name or user data | `id`, `displayName?`, `userData?`, `confirm?` |

### Patch Application

| Tool | Confirm | Description | Parameters |
|------|---------|-------------|------------|
| `apply_device_os_patches` | **(confirm)** | Apply OS patches | `id`, `patches`, `confirm?` |
| `apply_device_software_patches` | **(confirm)** | Apply software patches | `id`, `patches`, `confirm?` |

### Ticketing (full CRUD)

| Tool | Confirm | Description | Parameters |
|------|---------|-------------|------------|
| `get_ticket_boards` | — | List all ticket boards | — |
| `get_tickets` | — | List tickets from a board | `boardId`, `pageSize?`, `after?` |
| `get_ticket` | — | Get ticket detail | `ticketId` |
| `get_ticket_log` | — | Get ticket activity log | `ticketId` |
| `create_ticket` | **(confirm)** | Create a new ticket | `boardId`, `subject`, `description?`, `status?`, `priority?`, `severity?`, `deviceId?`, `assignedAppUserId?`, `confirm?` |
| `update_ticket` | **(confirm)** | Update a ticket | `ticketId`, `subject?`, `description?`, `status?`, `priority?`, `severity?`, `assignedAppUserId?`, `confirm?` |
| `add_ticket_comment` | **(confirm)** | Add comment to a ticket | `ticketId`, `comment`, `appUserId?`, `confirm?` |

### Custom Field Writes

| Tool | Confirm | Description | Parameters |
|------|---------|-------------|------------|
| `update_device_custom_fields` | **(confirm)** | Write custom fields on a device | `deviceId`, `fields`, `confirm?` |
| `update_org_custom_fields` | **(confirm)** | Write custom fields on an org | `orgId`, `fields`, `confirm?` |

---

## Phase 3 — Webhooks & event-driven integration

### Webhook Configuration

| Tool | Confirm | Description | Parameters |
|------|---------|-------------|------------|
| `get_webhook_config` | — | Show current webhook config | — |
| `set_webhook_config` | **(confirm)** | Configure a webhook endpoint | `webhookUrl`, `secret?`, `activities?`, `confirm?` |
| `delete_webhook_config` | **(confirm)** | Remove webhook config | `confirm?` |

> Note: GET /v2/webhook is not supported by the NinjaOne API via client credentials. `get_webhook_config` returns an informational message.

### Polling Queries

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_stale_devices` | Devices not checked in for N hours | `sinceHours?` (default 48) |
| `get_devices_pending_patches` | Devices with pending/failed patches | `status?` (PENDING/FAILED) |

### Activity Log

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_activities` | System-wide activity log | `pageSize?`, `after?`, `type?`, `deviceId?`, `userId?`, `status?` |

---

## Phase 4 — Script execution & policy management

### Script/Automation Execution

| Tool | Confirm | Description | Parameters |
|------|---------|-------------|------------|
| `list_automations` | — | List saved automation scripts | — |
| `run_device_script` | **(confirm)** | Run a script on a device | `deviceId`, `scriptId`, `runAs?`, `parameters?`, `timeout?`, `confirm?` |
| `get_script_result` | — | Poll script run result | `deviceId`, `activityId` |

> Note: Script execution requires authorization code flow in NinjaOne. `list_automations` may return an informational note if not available via client credentials.

> **`runAs` parameter**: The default execution context is `"system"` (lowercase). Using uppercase `"SYSTEM"` can cause credential access denied errors, especially on Linux devices. Always use lowercase `"system"` unless you have a specific reason to do otherwise.

### Policy Management

| Tool | Confirm | Description | Parameters |
|------|---------|-------------|------------|
| `get_policies` | — | List all policies | `templateOnly?` |
| `get_policy` | — | Get policy detail | `policyId` |
| `assign_device_policy` | **(confirm)** | Assign policy to a device | `deviceId`, `policyId`, `confirm?` |
| `get_device_policy_overrides` | — | Get policy overrides for a device | `id` |
| `reset_device_policy_overrides` | **(confirm)** | Reset all policy overrides | `id`, `confirm?` |

### Device Approval

| Tool | Confirm | Description | Parameters |
|------|---------|-------------|------------|
| `get_pending_devices` | — | List devices awaiting approval | — |
| `approve_devices` | **(confirm)** | Approve or reject devices | `mode` (APPROVE/REJECT), `deviceIds`, `confirm?` |

---

## Phase 5 — High-level script execution & job tracking

Phase 5 adds AI-oriented script execution: resolve scripts by name (not numeric ID), execute with automatic job correlation, and poll for completion — all in one tool call.

### Script Execution (High-Level)

| Tool | Confirm | Description | Parameters |
|------|---------|-------------|------------|
| `execute_script` | **(confirm)** | Execute a script by name with automatic tracking. Resolves name → ID, executes, correlates the new job, and polls until completion. | `device_id`, `script` (name), `parameters?`, `run_as?`, `confirm?` |
| `run_device_script` | **(confirm)** | Low-level: run a script by numeric ID. Use `execute_script` for AI-driven workflows — this is the raw API wrapper. | `deviceId`, `scriptId`, `type?`, `runAs?`, `parameters?`, `confirm?` |
| `get_script_result` | — | Poll the result of a previously triggered script run | `deviceId`, `activityId` |

> **`run_as` / `runAs` parameter**: The default execution context is `"system"` (lowercase). Using uppercase `"SYSTEM"` can cause credential access denied errors, especially on Linux devices. Always use lowercase `"system"` unless you have a specific reason to do otherwise.

### Job & Scripting Diagnostics

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_active_jobs` | Get active jobs for a device — useful for diagnosing what's running | `deviceId` |
| `get_device_scripting_options` | Get available scripting options (scripts and actions) for a specific device | `deviceId` |

### `execute_script` Flow

When called with `confirm=true`:

1. **Resolve**: `findScriptByName()` — exact match, then partial match. Returns candidates if ambiguous.
2. **Snapshot**: Captures active jobs (`GET /v2/device/{id}/jobs`) before execution.
3. **Execute**: `POST /v2/device/{id}/script/run` with the resolved script ID.
4. **Correlate**: Diffs before/after job snapshots to detect the newly created job. Never blocks on unrelated jobs.
5. **Track**: Polls `waitForScriptResult()` at 3-second intervals for up to 120s (configurable via `SCRIPT_POLL_TIMEOUT_MS` env var).
6. **Return**: `{ accepted, script, scriptId, deviceId, deviceName, runAs, activityId, jobCorrelation, trackingResult }`.

When called with `confirm=false`: dry-run showing the resolved script name, device name, run context, and parameters.

### Job Correlation

The implementation correlates **only** the job started by the current execution. Unrelated jobs (Windows Update, Patch Management, Backup, Antivirus, Reboot, Software Deployment) are explicitly ignored. The before/after job snapshot diff isolates the newly created job.

### Script List Cache

`list_automations` (backed by `GET /v2/automation/scripts`) caches results for 5 minutes to reduce API load during repeated name resolution.

---

## Device Filter Syntax

Use NinjaONE's filter syntax for the `df` parameter:

```
org = 1                           # Devices in organization 1
status = 'ONLINE'                 # Online devices only
name LIKE '%server%'              # Devices with 'server' in name
org = 1 AND status = 'ONLINE'     # Combined filter
lastSeen > '2024-01-01'          # Devices seen after date
os.name = 'Windows 10'           # Windows 10 devices
```

## Response Format

All tools return MCP-standard responses:
```json
{
  "content": [{ "type": "text", "text": "JSON formatted response data" }]
}
```

## API Limitations

- **Ticketing creation** requires authorization code flow (user context), not client credentials
- **Script execution** requires authorization code flow
- **Webhook GET** is not available via the API; use `set_webhook_config` / `delete_webhook_config`
- **Organization/location deletion** is only available via the NinjaOne dashboard
- **End user phone update** is read-only after creation
