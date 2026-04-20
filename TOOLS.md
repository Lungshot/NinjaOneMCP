# NinjaONE MCP Server - Tools Reference

This document provides detailed information about the available tools in the NinjaONE MCP server.

## Core Tools Available

### Device Management Tools

#### `get_devices`
**Description**: List all devices or filter by criteria  
**Parameters**:
- `df` (string, optional): Device filter expression (e.g., "org = 1")
- `pageSize` (number, optional): Number of results per page
- `after` (number, optional): Pagination cursor

**Example Usage**:
```json
{
  "df": "org = 1 AND status = 'ONLINE'",
  "pageSize": 50
}
```

#### `get_device`
**Description**: Get detailed information about a specific device  
**Parameters**:
- `id` (number, required): Device ID

**Example Usage**:
```json
{ "id": 12345 }
```

#### `reboot_device`
**Description**: Reboot a device with normal or forced mode  
**Parameters**:
- `id` (number, required): Device ID
- `mode` (string, required): Reboot mode ("NORMAL" or "FORCED")

**Example Usage**:
```json
{
  "id": 12345,
  "mode": "NORMAL"
}
```

### Query Tools

#### `query_antivirus_status`
**Description**: Query antivirus status across devices  
**Parameters**:
- `df` (string, optional): Device filter expression
- `cursor` (string, optional): Pagination cursor
- `pageSize` (number, optional): Number of results per page

**Example Usage**:
```json
{
  "df": "org = 1",
  "pageSize": 100
}
```

#### `query_device_health`
**Description**: Query device health status and metrics  
**Parameters**:
- `df` (string, optional): Device filter expression
- `cursor` (string, optional): Pagination cursor
- `pageSize` (number, optional): Number of results per page

**Example Usage**:
```json
{
  "df": "status = 'ONLINE'",
  "pageSize": 50
}
```

## Additional Tools

The server also exposes the following additional tools that cover device control, patch actions, organization details, alert details, users/roles, contacts, and approvals/policies.

### Device Control
- `set_device_maintenance`: Set maintenance mode ON/OFF for a device. When enabling it, the operator will choose a minutes/hours/days/weeks duration or mark it permanent.
- `get_device_dashboard_url`: Get device dashboard URL
- `control_windows_service`: Control a Windows service (START/STOP/RESTART)
- `configure_windows_service`: Configure a Windows service startup type (e.g., AUTOMATIC/MANUAL/DISABLED)

> ℹ️ **Owner details:** The NinjaONE API currently exposes device owner information only via the `assignedOwnerUid` field
> returned from `get_device`. Dedicated owner management endpoints are not available.

### Device Patch Actions
- `scan_device_os_patches`: Scan for OS patches on a device
- `apply_device_os_patches`: Apply OS patches on a device
- `scan_device_software_patches`: Scan for software patches on a device
- `apply_device_software_patches`: Apply software patches on a device

### Organization Details
- `get_organization`: Get organization details by ID
- `get_organization_locations`: Get locations for an organization
- `get_organization_policies`: Get organization policies
- `generate_organization_installer`: Generate installer for an organization/location

### Alert Details
- `get_alert`: Get a single alert by UID
- `reset_alert`: Reset/acknowledge an alert by UID
- `get_device_alerts`: Get alerts for a specific device

### Users & Roles
- `get_end_users`: List end users
- `get_end_user`: Get an end user by ID
- `get_technicians`: List technicians
- `get_technician`: Get a technician by ID
- `add_role_members`: Add users to a role
- `remove_role_members`: Remove users from a role

### Contacts
- `get_contacts`: List contacts
- `get_contact`: Get a contact by ID
- `create_contact`: Create a contact
- `update_contact`: Update a contact
- `delete_contact`: Delete a contact

### Device Approvals & Policies
- `approve_devices`: Approve or deny multiple devices (by IDs)
- `get_device_policy_overrides`: Get device policy overrides
- `reset_device_policy_overrides`: Reset/remove all policy overrides for a device
- `get_policies`: List policies (optionally templates only)

### Region Utilities
- `list_regions`: List supported regions and base URLs
- `set_region`: Set region by key or by explicit base URL

## Examples (JSON payloads)

Below are minimal example payloads you can use when calling tools via an MCP client.

### Device Control
- `set_device_maintenance`
```json
{ "id": 12345, "mode": "ON", "duration": { "value": 90, "unit": "MINUTES" } }
```

```json
{ "id": 12345, "mode": "ON", "duration": { "permanent": true } }
```

```json
{ "id": 12345, "mode": "OFF" }
```

- `control_windows_service`
```json
{ "id": 12345, "serviceId": "Spooler", "action": "RESTART" }
```

### Device Patch Actions
- `apply_device_os_patches`
```json
{ "id": 12345, "patches": [ { "kb": "KB5030211" } ] }
```

### Organization Details
- `generate_organization_installer`
```json
{ "installerType": "WINDOWS", "organizationId": 1, "locationId": 2 }
```

### Contacts
- `create_contact`
```json
{ "organizationId": 1, "firstName": "Jane", "lastName": "Doe", "email": "jane.doe@example.com" }
```

### Users & Roles
- `add_role_members`
```json
{ "roleId": 7, "userIds": [101, 102] }
```

### Alerts
- `get_alert`
```json
{ "uid": "ALERT_UID_123" }
```

- `reset_alert`
```json
{ "uid": "ALERT_UID_123" }
```

- `get_device_alerts`
```json
{ "id": 12345, "lang": "en-US" }
```

### Device Dashboard URL
- `get_device_dashboard_url`
```json
{ "id": 12345 }
```

### Policies
- `get_policies`
```json
{ "templateOnly": true }
```

### Device Approvals
- `approve_devices`
```json
{ "mode": "APPROVE", "deviceIds": [12345, 67890] }
```

### Windows Service Configuration
- `configure_windows_service`
```json
{ "id": 12345, "serviceId": "Spooler", "startupType": "DISABLED" }
```

### Region Utilities
- `list_regions`
```json
{}
```

- `set_region`
```json
{ "region": "eu" }
```
or
```json
{ "baseUrl": "https://eu.ninjarmm.com" }
```

### Organization Management Tools

#### `get_organizations`
**Description**: List all organizations with pagination  
**Parameters**:
- `pageSize` (number, optional): Number of results per page
- `after` (number, optional): Pagination cursor

**Example Usage**:
```json
{
  "pageSize": 25,
  "after": 0
}
```

### Alert Management Tools

#### `get_alerts`
**Description**: Get system alerts with optional filtering  
**Parameters**:
- `deviceFilter` (string, optional): Device filter expression
- `since` (string, optional): ISO timestamp for alerts since this time

**Example Usage**:
```json
{
  "deviceFilter": "org = 1",
  "since": "2024-01-01T00:00:00Z"
}
```

## Device Filter Syntax

The NinjaONE API uses a specific filter syntax for the `df` parameter:

### Basic Operators
- `=` : Equals
- `!=` : Not equals
- `>` : Greater than
- `<` : Less than
- `>=` : Greater than or equal
- `<=` : Less than or equal
- `LIKE` : Pattern matching (use % for wildcards)
- `IN` : Value in list

### Logical Operators
- `AND` : Logical AND
- `OR` : Logical OR
- `NOT` : Logical NOT

### Common Filter Examples

```
org = 1                           # Devices in organization 1
status = 'ONLINE'                 # Online devices only
name LIKE '%server%'              # Devices with 'server' in name
org = 1 AND status = 'ONLINE'     # Online devices in org 1
lastSeen > '2024-01-01'          # Devices seen after Jan 1, 2024
os.name = 'Windows 10'           # Windows 10 devices
```

### Available Fields for Filtering

- `id` : Device ID
- `name` : Device name
- `status` : Device status (ONLINE, OFFLINE, etc.)
- `org` : Organization ID
- `lastSeen` : Last seen timestamp
- `os.name` : Operating system name
- `os.version` : Operating system version
- `type` : Device type
- `location` : Location ID

## Response Format

All tools return responses in the following format:

```json
{
  "content": [
    {
      "type": "text",
      "text": "JSON formatted response data"
    }
  ]
}
```

The actual data varies by tool but typically includes:
- Array of objects for list operations
- Single object for detail operations
- Status information for action operations

## Error Handling

The server provides comprehensive error handling:

- Invalid Tool: Returns MethodNotFound error
- API Errors: Returns InternalError with details
- Authentication: Returns an error if OAuth client credentials are missing or invalid (NINJA_CLIENT_ID / NINJA_CLIENT_SECRET)
- Network Issues: Returns connection error details

## Rate Limiting

Be aware of NinjaONE API rate limits:
- Standard limits apply per access token
- Large queries may need pagination
- Use appropriate `pageSize` values to avoid timeouts

## Security Considerations

- Never expose API tokens in client-side code
- Use environment variables for credentials
- Implement proper CORS settings for HTTP mode
- Monitor API usage and access patterns

## Extended Tools (Available in Full Implementation)

The current implementation includes core tools. A full implementation would include:

### Device Operations
- `set_device_maintenance`
- `approve_devices`

### Patch Management
- `scan_device_os_patches`
- `apply_device_os_patches`
- `scan_device_software_patches`
- `apply_device_software_patches`

### Service Management
- `control_windows_service`
- `configure_windows_service`

### Additional Queries
- `query_computer_systems`
- `query_operating_systems`
- `query_processors`
- `query_disks`
- `query_volumes`
- `query_network_interfaces`
- `query_software`
- `query_os_patches`
- `query_software_patches`

And many more covering all aspects of the NinjaONE platform.

### Authentication (authorization_code flow)
- `ninja_auth_status` — show auth mode, token expiry, refresh-token state.
- `ninja_auth_login` — start browser login; returns `authorizeUrl`. Pass
  `{ "manual": true }` to skip loopback and only return the URL.
- `ninja_auth_paste_redirect` — complete login by pasting the full redirect
  URL (contains `?code=...&state=...`). Required for headless/manual flows.
- `ninja_auth_logout` — clear stored tokens (`~/.ninjaone-mcp/tokens.json`).

### Ticketing
- `get_tickets` — filter/paginate tickets.
- `get_ticket`, `create_ticket`, `update_ticket`.
- `get_ticket_log_entries`, `add_ticket_log_entry` — comments & activity.
- `get_ticketing_attributes` — statuses/priorities/custom-field metadata.
- `get_ticketing_contacts` — ticket contact directory.

### Scripts (require `NINJA_AUTH_MODE=authorization_code`)
- `get_device_scripting_options` — scripts/actions available on a device.
- `run_device_script` — execute a script; payload follows NinjaOne spec
  (`{ type, uid|id, parameters?, runAs? }`).
- `get_job_status` — poll a job by UID.

### NinjaOne Documentation
- `get_document_templates`, `get_document_template`.
- `create_document_template`, `update_document_template`.
- `get_organization_documents`, `create_organization_document`,
  `update_organization_document`.

### Device Custom Fields
- `get_device_custom_fields`, `update_device_custom_fields` (object of
  `{ fieldName: value }`).

### Webhooks
- `set_webhook` (PUT), `delete_webhook`.

### Attachments
- `get_attachment` — returns `{ contentType, base64, size }`.

### Backup (additions)
- `query_backup_jobs`, `query_backup_integrity` — in addition to the existing
  `query_backup_usage`.

## Support and Documentation

For detailed API documentation, refer to:
- NinjaONE Official API Documentation
- Device Filter Syntax Guide
- MCP Protocol Specification

For issues with this MCP server, check the server logs and ensure proper configuration of environment variables.
