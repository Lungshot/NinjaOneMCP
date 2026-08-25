# NinjaONE MCP Server

A modern TypeScript MCP (Model Context Protocol) server for NinjaONE RMM platform with comprehensive API coverage and multiple transport options.

## Features

### 🚀 **Modern Architecture**
- Built with MCP SDK v1.17.1
- Full TypeScript support with strict typing
- Multiple transport protocols (STDIO, HTTP, SSE)
- Comprehensive error handling and logging
- Security-focused design

### 🔧 **Complete API Coverage**
- **Device Management**: List, control, maintain, and monitor devices
- **Patch Management**: OS and software patch scanning and deployment
- **Service Control**: Windows service management
- **Organization Management**: Multi-tenant organization handling
- **Contact Management**: Full CRUD operations for contacts
- **Alert Management**: Alert retrieval and acknowledgment
- **User Management**: End users and technicians
- **Policy Management**: Policy retrieval and overrides
- **Comprehensive Queries**: 21+ query endpoints covering:
  - System information (antivirus, health, OS, logged-on users)
  - Hardware details (processors, disks, volumes, network, RAID)
  - Software and patches (installed software, OS patches, software patches, patch installs)
  - Windows services management
  - Custom fields and policies (standard and scoped custom fields, policy overrides)
  - Backup usage statistics

### 🌐 **Transport Options**

#### STDIO Transport (Default)
Perfect for desktop MCP clients like Claude Desktop.

#### HTTP Transport
RESTful API with JSON responses:
- `/health` - Health check endpoint
- `/info` - Server information
- `/tools` - List available tools (informational)

#### Server-Sent Events (SSE)
Real-time streaming for web applications:
- `/events` - SSE connection endpoint

## Quick Start

### Prerequisites
- Node.js 18+
- NinjaONE OAuth client credentials (client ID and secret)
- PowerShell 7+ (for Windows development)

### Installation Options

#### Option 1: MCPB Bundle (Recommended)

**For Claude Desktop and MCP-compatible clients:**

Download the latest `ninjaone-rmm.mcpb` bundle file from this repository. This is a complete, production-ready MCP bundle that includes:

- Compiled server code with all dependencies
- Proper MCPB manifest for easy installation
- Security-hardened implementation
- Comprehensive error handling and logging

**📖 For detailed step-by-step installation instructions with screenshots, see [README-MCPB.md](README-MCPB.md)**

**Quick Installation:**
1. Download `ninjaone-rmm.mcpb` from this repository
2. Install through your MCP client (Claude Desktop supports MCPB installation)
3. **Click "Configure" on the installed extension** to enter your NinjaONE credentials

**Configuration required:**
- **Base URL**: Your NinjaONE regional endpoint (e.g., `https://app.ninjarmm.com`)
- **Client ID**: OAuth2 application client ID
- **Client Secret**: OAuth2 application client secret

**Note**: Reads work with OAuth2 client credentials. Ticket writes (`create_ticket`, `update_ticket`, `add_ticket_comment`) and `run_device_script` require user-context tokens — see [User-Context OAuth](#user-context-oauth-authorization-code-flow).

#### Option 2: From Source (Development)

```bash
# Clone and install dependencies
cd C:\path\to\NinjaOneMCP
npm install
```

**⚠️ Important:** See [SETUP.md](SETUP.md) for detailed configuration instructions, especially for MCP client integration.

### Configuration

Edit your `.env` file (local development only; MCP clients do not load .env):
```env
NINJA_CLIENT_ID=your_client_id
NINJA_CLIENT_SECRET=your_client_secret
NINJA_BASE_URL=https://app.ninjarmm.com
# Or set a region key instead of base URL:
# NINJA_REGION=eu
# Optional: override auto-detect candidates
# NINJA_BASE_URLS=https://app.ninjarmm.com,https://eu.ninjarmm.com
MCP_MODE=stdio
HTTP_PORT=3000
SSE_PORT=3001
```

### Build and Run

```bash
# Build TypeScript
npm run build

# Run with different transports
npm run start           # STDIO (default)
npm run start:http      # HTTP on port 3000
npm run start:sse       # SSE on port 3001

# Development mode with auto-rebuild
npm run dev
```

### User-Context OAuth (Authorization Code Flow)

NinjaOne requires a user-context token for ticket write operations and script execution. The server transparently prefers a stored user-context token when present and falls back to client_credentials for reads.

**One-time setup:**

1. In NinjaOne admin → Apps → API, create a **Web Application** client app (not "API Services") with:
   - Redirect URI: `http://localhost:8765/callback`
   - Scopes: Monitoring + Management + Control
   - Allowed grant types: Authorization code + Client credentials + Refresh token
2. Put the new client ID/secret in `.env` (and the MCP client config — see below).
3. Run `npm run auth`. A browser opens to the NinjaOne consent screen; click **Authorize** + **Remember my decision**.
4. The refresh token is saved to `~/.ninjaone-mcp/tokens.json` (mode 600).

After that, ticket and script operations work attributed to the consenting user. Each teammate runs `npm run auth` on their own machine.

**Tip:** if your default browser is intercepted by an extension/proxy and shows a JSON 404 instead of the consent screen, copy the URL printed in the terminal into an incognito window.

## Usage Examples

### Device Management
```typescript
// List devices with filter
await ninjaAPI.getDevices("org = 1", 50, 0);

// Get specific device (owner UID available via assignedOwnerUid field)
await ninjaAPI.getDevice(12345);

// Reboot device
await ninjaAPI.rebootDevice(12345, "NORMAL");

// Set maintenance mode for 2 hours
await ninjaAPI.setDeviceMaintenance(12345, "ON", { value: 2, unit: "HOURS" });

// Set maintenance mode permanently
await ninjaAPI.setDeviceMaintenance(12345, "ON", { permanent: true });

// Turn off maintenance mode
await ninjaAPI.setDeviceMaintenance(12345, "OFF");
```

#### MCP Tool: Get Installed Software for a Device

```json
{
  "method": "tools.call",
  "params": {
    "name": "get_device_software",
    "arguments": {
      "id": 12345
    }
  }
}
```

**Response:**

```json
[
  {
    "name": "Microsoft Edge",
    "version": "124.0.2478.97",
    "publisher": "Microsoft Corporation",
    "installDate": "2024-04-02T18:45:00Z",
    "location": "C:\\Program Files\\Microsoft\\Edge\\Application",
    "size": 214748364,
    "productCode": "{F3A0D9B7-1234-4DCC-A560-42E9FF0F0A13}"
  }
]
```

Each object in the response matches the `Application` schema from the NinjaONE API and represents a single installed application.

> ℹ️ **Note:** The NinjaONE public API does not expose dedicated endpoints for reading or setting device owners. Owner
> information is returned as the `assignedOwnerUid` field in the `getDevice` response.

### Query Operations
```typescript
// Query antivirus status
await ninjaAPI.queryAntivirusStatus("org = 1");

// Query hardware information
await ninjaAPI.queryProcessors();
await ninjaAPI.queryDisks();
await ninjaAPI.queryNetworkInterfaces();

// Query software and patches
await ninjaAPI.querySoftware();
await ninjaAPI.queryOSPatches();
await ninjaAPI.queryWindowsServices();

// Query custom fields and policies
await ninjaAPI.queryCustomFields();
await ninjaAPI.queryPolicyOverrides();

// Query backup usage
await ninjaAPI.queryBackupUsage();
```

### Patch Management
```typescript
// Scan for OS patches
await ninjaAPI.scanDeviceOSPatches(12345);

// Apply patches
await ninjaAPI.applyDeviceOSPatches(12345, patchArray);
```

## API Limitations

The NinjaOne Public API has the following known limitations:

### Organizations & Locations
- **Delete Organization**: Organizations can only be deleted via the NinjaOne dashboard
- **Delete Location**: Locations can only be deleted via the NinjaOne dashboard
- **Update nodeApprovalMode**: This setting is read-only after organization creation

### End Users
- **Update Phone**: The phone field can be set during creation but cannot be updated afterwards

### Auth Flow Restrictions
NinjaOne returns `403 user_context_required` for several endpoints when called with a client_credentials token. These require an authorization_code (user-context) token:
- `create_ticket`, `update_ticket`, `add_ticket_comment`
- `run_device_script`

Run `npm run auth` once to bootstrap the user-context flow — see [User-Context OAuth](#user-context-oauth-authorization-code-flow). Reads and most device-management writes (e.g. `set_device_maintenance`, `assign_device_policy`) work with either flow.

## MCP Integration

### Claude Desktop Configuration (Generic)

Important: MCP clients do not load `.env`. Provide all required environment variables in the MCP client config.

File location (Windows): `%APPDATA%\Claude\claude_desktop_config.json`

Generic example (adjust your paths and env values):

```json
{
  "mcpServers": {
    "ninjaone": {
      "command": "node",
      "args": [
        "C:\\Path\\to\\NinjaOneMCP\\dist\\index.js"
      ],
      "cwd": "C:\\Path\\to\\NinjaOneMCP",
      "env": {
        "NINJA_CLIENT_ID": "<your_client_id>",
        "NINJA_CLIENT_SECRET": "<your_client_secret>",
        "NINJA_BASE_URL": "https://api.ninjarmm.com",
        "MCP_MODE": "stdio",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

Adjust these fields:
- Path: Set `args[0]` to your actual `dist\index.js` path and `cwd` to the repo root path on your machine.
- Region: Set `NINJA_BASE_URL` to your region, e.g. `https://eu.ninjarmm.com` for EU tenants.
- Credentials: Provide your OAuth client credentials via `NINJA_CLIENT_ID` and `NINJA_CLIENT_SECRET`.

Build first so `dist/index.js` exists: `npm install && npm run build`. Then restart Claude Desktop after editing the config.

### Available Tools

The server provides 29+ tools covering all major NinjaONE operations:

**Device Tools**: `get_devices`, `get_device`, `reboot_device`, `get_device_activities`, `get_device_software`, `search_devices_by_name`, `find_windows11_devices`

#### Device Software Inventory Tool

- **Tool**: `get_device_software`
- **Description**: Get installed software for a specific device.
- **Parameters**:
  - `id` (number, required) – Target device ID.

**Organization Tools**: `get_organizations`, `get_alerts`

**System Information Query Tools**: `query_antivirus_status`, `query_antivirus_threats`, `query_computer_systems`, `query_device_health`, `query_operating_systems`, `query_logged_on_users`

**Hardware Query Tools**: `query_processors`, `query_disks`, `query_volumes`, `query_network_interfaces`, `query_raid_controllers`, `query_raid_drives`

**Software & Patch Query Tools**: `query_software`, `query_os_patches`, `query_software_patches`, `query_os_patch_installs`, `query_software_patch_installs`, `query_windows_services`

**Custom Fields & Policy Query Tools**: `query_custom_fields`, `query_custom_fields_detailed`, `query_scoped_custom_fields`, `query_scoped_custom_fields_detailed`, `query_policy_overrides`

**Backup Query Tools**: `query_backup_usage`

## Region and Base URL

The server can resolve the correct regional API endpoint in three ways:

- Explicit base URL: set `NINJA_BASE_URL` (e.g., `https://eu.ninjarmm.com`). This takes precedence over all other options.
- Region key: set `NINJA_REGION` to one of `us`, `us2`, `eu`, `ca`, `oc`. The server maps it to the proper base URL.
- Auto-detect: if neither of the above is set, the server tries candidates in order until OAuth succeeds.
  - Default candidates: `https://app.ninjarmm.com`, `https://us2.ninjarmm.com`, `https://eu.ninjarmm.com`, `https://ca.ninjarmm.com`, `https://oc.ninjarmm.com`
  - Override list via `NINJA_BASE_URLS` (comma-separated) if needed.

Runtime tools:
- `list_regions` – returns supported regions and base URLs
- `set_region` – set by `{ "region": "eu" }` or `{ "baseUrl": "https://eu.ninjarmm.com" }`

## API Reference

### Tool Parameters

Most tools support these common parameters:

- `df` (string): Device filter expression (e.g., "org = 1 AND status = 'ONLINE'")
- `pageSize` (number): Results per page (default: 50)
- `cursor` (string): Pagination cursor for queries
- `id` (number): Resource identifier for specific operations

### API Endpoints

| Method | Path | Description | Used by |
| ------ | ---- | ----------- | ------- |
| GET | `/v2/device/{id}/software` | Returns the installed software inventory for the target device. | `get_device_software` tool |

### Device Filters

Use NinjaONE's filter syntax:
```
org = 1 AND status = 'ONLINE'
name LIKE '%server%'
os.name = 'Windows 10'
lastSeen > '2024-01-01'
```

## Phase 2/3/4 — Extended Features

### Confirmation Pattern (Phase 2+)

All tools that mutate state include a `confirm` boolean parameter (default `false`).
When `confirm` is false, the tool performs a **dry-run** showing what would happen:

```
DRY RUN — no changes made.
Would reboot device id=123 (SCB-PC18) in NORMAL mode.
Re-call with confirm=true to execute.
```

This gives the operator a chance to review before committing.

### Phase 2 — Write Operations
- **Alert management**: `reset_alert` with dry-run
- **Device updates**: `update_device`, `reboot_device`, `set_device_maintenance` — all with confirm guards
- **Patch application**: `apply_device_os_patches`, `apply_device_software_patches` with dry-run
- **Ticketing (full CRUD)**: `get_ticket_boards`, `get_tickets`, `get_ticket`, `get_ticket_log`, `create_ticket`, `update_ticket`, `add_ticket_comment`
- **Custom field writes**: `update_device_custom_fields`, `update_org_custom_fields`

### Phase 3 — Webhooks & Event-Driven
- **Webhook config**: `get_webhook_config`, `set_webhook_config`, `delete_webhook_config`
- **Stale devices**: `get_stale_devices` — find devices that haven't checked in
- **Pending patches**: `get_devices_pending_patches` — fleet-wide patch status
- **Activity log**: `get_activities` — system-wide audit trail

### Phase 4 — Script Execution & Policy Management
- **Automations**: `list_automations`, `run_device_script`, `get_script_result`
- **Policy management**: `get_policy`, `assign_device_policy` with confirm
- **Device approval**: `get_pending_devices`, `approve_devices` with confirm

> **Note**: Ticket writes (`create_ticket`, `update_ticket`, `add_ticket_comment`) and `run_device_script` require a user-context token (authorization_code flow). Run `npm run auth` once to enable them — see [User-Context OAuth](#user-context-oauth-authorization-code-flow). Reads keep working with client_credentials alone.

See [TOOLS.md](TOOLS.md) for the complete tool reference with parameters.

## Architecture

```
src/
├── index.ts              # Main server and transport selection
├── ninja-api.ts          # NinjaONE API client wrapper
└── transport/
    └── http.ts           # HTTP and SSE transport implementations
```

## Security Features

- **Secure Credential Management**: Environment-based token storage
- **CORS Protection**: Configurable origin restrictions
- **Request Validation**: JSON-RPC format validation
- **Error Sanitization**: Prevents sensitive data leakage
- **Rate Limiting Ready**: Structured for rate limit implementation

## Development

### Project Structure
- Modern ES modules with TypeScript
- Comprehensive error handling
- Extensive logging and debugging
- Clean separation of concerns

### Testing
```bash
# Run API connectivity test
npm test
```

### Contributing
1. Follow TypeScript strict mode requirements
2. Add proper error handling for new endpoints
3. Update tool definitions for new features
4. Test with all transport modes

## Troubleshooting

### Common Issues

**Connection Errors**
- Verify `NINJA_CLIENT_ID` and `NINJA_CLIENT_SECRET` are correct and have required scopes
- Set `NINJA_BASE_URL` or `NINJA_REGION` appropriately (or rely on auto-detect)
- Ensure network connectivity to NinjaONE API

**Permission Errors**
- Verify your OAuth client has required scopes (monitoring, management, control)
- Check organization/location access permissions
- `403 user_context_required` on ticket writes / `run_device_script` → run `npm run auth` to bootstrap the user-context flow
- `access denied` / credential errors when running scripts → ensure `runAs` is lowercase `"system"` (not uppercase `"SYSTEM"`); uppercase can cause credential access denials, especially on Linux devices


**Transport Issues**
- For STDIO: Ensure proper MCP client configuration
- For HTTP: Check port availability and CORS settings
- For SSE: Verify WebSocket support in client

### Debug Mode
Set `LOG_LEVEL=debug` in your `.env` file for detailed logging.

## License

MIT License - see LICENSE file for details.

## Distribution

### MCPB Bundle Format

This MCP server is distributed as a `.mcpb` (MCP Bundle) file following the official MCPB specification. The bundle contains:

- **Production server code**: Compiled JavaScript with all dependencies included
- **MCPB manifest**: Proper manifest.json for client compatibility
- **Security features**: Input validation, error handling, and logging
- **Documentation**: Complete setup and usage instructions

### Bundle Features

- **Self-contained**: No external dependencies required
- **Cross-platform**: Compatible with Windows, macOS, and Linux
- **MCP-compliant**: Follows official MCP protocol specifications
- **Security-hardened**: Comprehensive error handling and input validation
- **Production-ready**: Includes logging, monitoring, and debugging capabilities

### Creating a New Bundle

To rebuild the distribution bundle:

```bash
# Install the MCPB CLI tool
npm install -g @anthropic-ai/mcpb

# Validate the manifest
mcpb validate manifest.json

# Create the .mcpb bundle
mcpb pack . ninjaone-rmm.mcpb
```

The resulting `.mcpb` file can be installed directly in Claude Desktop and other MCP-compatible clients through drag-and-drop or import functionality.

## Support

This is a community-maintained MCP server. For NinjaONE API issues, consult the official NinjaONE documentation.
