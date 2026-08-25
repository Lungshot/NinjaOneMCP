/**
 * NinjaONE MCP Server - Optimized version without optional features
 * Supports STDIO, HTTP, and SSE transports with fixed filtering
 * MCP SDK v1.17.1 compatible
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import { NinjaOneAPI } from './ninja-api.js';
import type { MaintenanceUnit, MaintenanceWindowSelection } from './ninja-api.js';
import { createHttpServer, createSseServer } from './transport/http.js';
import { config } from 'dotenv';

config();

const MAINTENANCE_UNIT_SECONDS: Record<MaintenanceUnit, number> = {
  MINUTES: 60,
  HOURS: 60 * 60,
  DAYS: 24 * 60 * 60,
  WEEKS: 7 * 24 * 60 * 60
};

/**
 * Fixed tool definitions - removed complex filtering, kept all functionality
 */
const TOOLS = [
  // Device Management Tools
  {
    name: 'get_devices',
    description: 'List all devices with basic filtering. Use simple filters only.',
    inputSchema: {
      type: 'object',
      properties: {
        pageSize: { type: 'number', description: 'Number of results per page (default: 50)' },
        after: { type: 'number', description: 'Pagination cursor' },
        df: { type: 'string', description: 'Simple device filter (e.g., "offline = true")' }
      }
    }
  },
  {
    name: 'list_regions',
    description: 'List supported NinjaONE regions and base URLs',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'set_region',
    description: 'Set region or base URL for API requests',
    inputSchema: {
      type: 'object',
      properties: {
        region: { type: 'string', description: 'Region key (us, us2, eu, ca, oc)' },
        baseUrl: { type: 'string', description: 'Custom base URL (overrides region if provided)' }
      }
    }
  },
  {
    name: 'get_device',
    description: 'Get detailed information about a specific device',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Device ID' }
      },
      required: ['id']
    }
  },
  {
    name: 'reboot_device',
    description: 'Reboot a device with normal or forced mode. Set confirm=true to execute; default is dry-run.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Device ID' },
        mode: { type: 'string', enum: ['NORMAL', 'FORCED'], description: 'Reboot mode (default: NORMAL)' },
        confirm: { type: 'boolean', description: 'Set to true to execute. Default false (dry-run).' }
      },
      required: ['id']
    }
  },
  {
    name: 'set_device_maintenance',
    description: 'Set maintenance mode for a device. Set confirm=true to execute; default is dry-run.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Device ID' },
        mode: { type: 'string', enum: ['ON', 'OFF'], description: 'Maintenance mode' },
        duration: {
          type: 'object',
          description: 'Duration details when enabling maintenance mode',
          properties: {
            permanent: {
              type: 'boolean',
              description: 'Set true for permanent maintenance mode'
            },
            value: {
              type: 'number',
              description: 'Length of the maintenance window (required when not permanent)'
            },
            unit: {
              type: 'string',
              enum: ['MINUTES', 'HOURS', 'DAYS', 'WEEKS'],
              description: 'Time unit for the maintenance window (required when not permanent)'
            }
          }
        },
        confirm: { type: 'boolean', description: 'Set to true to execute. Default false (dry-run).' }
      },
      required: ['id', 'mode']
    }
  },
  {
    name: 'get_organizations',
    description: 'List all organizations with pagination',
    inputSchema: {
      type: 'object',
      properties: {
        pageSize: { type: 'number', description: 'Number of results per page' },
        after: { type: 'number', description: 'Pagination cursor' }
      }
    }
  },
  {
    name: 'get_alerts',
    description: 'Get system alerts with basic filtering',
    inputSchema: {
      type: 'object',
      properties: {
        sourceType: { type: 'string', description: 'Alert source type filter' },
        since: { type: 'string', description: 'ISO timestamp — return alerts created after this time' },
        df: { type: 'string', description: 'Device filter (e.g., "org = 1")' }
      }
    }
  },
  {
    name: 'get_device_activities',
    description: 'Get activities for a specific device',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Device ID' },
        pageSize: { type: 'number', description: 'Number of results per page' },
        type: { type: 'string', description: 'Activity type filter (e.g., AUTOMATION, DEVICE, ALERT, PATCHING, TICKETING)' }
      },
      required: ['id']
    }
  },
  {
    name: 'get_device_automation_activities',
    description: 'Get recent automation/script activities for a device (filtered, token-efficient — defaults to 10 results)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Device ID' },
        pageSize: { type: 'number', description: 'Number of results (default: 10)' }
      },
      required: ['id']
    }
  },
  /**
   * Get installed software inventory for a specific device.
   * Returns the list of installed applications including version, publisher,
   * and install date metadata for asset and compliance tracking.
   * Useful for: software asset management, compliance audits, security assessments.
   */
  {
    name: 'get_device_software',
    description: 'Get installed software for a specific device',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Device ID' }
      },
      required: ['id']
    }
  },
  {
    name: 'get_device_dashboard_url',
    description: 'Get the dashboard URL for a specific device',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Device ID' }
      },
      required: ['id']
    }
  },
  {
    name: 'search_devices_by_name',
    description: 'Search devices by system name (client-side filtering)',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'System name to search for' },
        limit: { type: 'number', description: 'Maximum results to return (default: 10)' }
      },
      required: ['name']
    }
  },
  {
    name: 'find_windows11_devices',
    description: 'Find all Windows 11 devices (client-side filtering)',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum results to return (default: 20)' }
      }
    }
  },

  // Device Control
  {
    name: 'control_windows_service',
    description: 'Control a Windows service on a device',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Device ID' },
        serviceId: { type: 'string', description: 'Service ID' },
        action: { type: 'string', description: 'Action to perform (e.g., START, STOP, RESTART)' }
      },
      required: ['id', 'serviceId', 'action']
    }
  },
  {
    name: 'configure_windows_service',
    description: 'Configure a Windows service startup type on a device',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Device ID' },
        serviceId: { type: 'string', description: 'Service ID' },
        startupType: { type: 'string', description: 'Startup type (e.g., AUTOMATIC, MANUAL, DISABLED)' }
      },
      required: ['id', 'serviceId', 'startupType']
    }
  },
  // Device Patching
  {
    name: 'scan_device_os_patches',
    description: 'Scan for OS patches on a device',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Device ID' }
      },
      required: ['id']
    }
  },
  {
    name: 'apply_device_os_patches',
    description: 'Apply OS patches on a device. Set confirm=true to execute; default is dry-run.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Device ID' },
        patches: { type: 'array', items: { type: 'object' }, description: 'List of OS patches to apply' },
        confirm: { type: 'boolean', description: 'Set to true to execute. Default false (dry-run).' }
      },
      required: ['id', 'patches']
    }
  },
  {
    name: 'scan_device_software_patches',
    description: 'Scan for software patches on a device',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Device ID' }
      },
      required: ['id']
    }
  },
  {
    name: 'apply_device_software_patches',
    description: 'Apply software patches on a device. Set confirm=true to execute; default is dry-run.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Device ID' },
        patches: { type: 'array', items: { type: 'object' }, description: 'List of software patches to apply' },
        confirm: { type: 'boolean', description: 'Set to true to execute. Default false (dry-run).' }
      },
      required: ['id', 'patches']
    }
  },

  // Organizations - details
  {
    name: 'get_organization',
    description: 'Get organization details by ID',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number', description: 'Organization ID' } },
      required: ['id']
    }
  },
  {
    name: 'get_organization_locations',
    description: 'Get locations for an organization',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number', description: 'Organization ID' } },
      required: ['id']
    }
  },
  {
    name: 'get_organization_policies',
    description: 'Get policies for an organization',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number', description: 'Organization ID' } },
      required: ['id']
    }
  },
  {
    name: 'generate_organization_installer',
    description: 'Generate installer for an organization/location',
    inputSchema: {
      type: 'object',
      properties: {
        organizationId: { type: 'number', description: 'Organization ID' },
        locationId: { type: 'number', description: 'Location ID' },
        installerType: { type: 'string', description: 'Installer type (e.g., WINDOWS_MSI, MAC_DMG, MAC_PKG, LINUX_DEB, LINUX_RPM)' }
      },
      required: ['organizationId', 'locationId', 'installerType']
    }
  },
  // Organization CRUD
  // Delete operations are intentionally omitted because the public API
  // does not expose organization or location removal endpoints.
  {
    name: 'create_organization',
    description: 'Create a new organization',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Organization name' },
        description: { type: 'string', description: 'Organization description' },
        nodeApprovalMode: {
          type: 'string',
          description: 'Device approval mode (AUTOMATIC, MANUAL, REJECT)',
          enum: ['AUTOMATIC', 'MANUAL', 'REJECT']
        },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags' }
      },
      required: ['name']
    }
  },
  {
    name: 'update_organization',
    description: 'Update an organization (node approval mode is read-only after creation)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Organization ID' },
        name: { type: 'string', description: 'Organization name' },
        description: { type: 'string', description: 'Organization description' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags' }
      },
      required: ['id']
    }
  },

  // Location CRUD
  {
    name: 'create_location',
    description: 'Create a new location for an organization',
    inputSchema: {
      type: 'object',
      properties: {
        organizationId: { type: 'number', description: 'Organization ID' },
        name: { type: 'string', description: 'Location name' },
        address: { type: 'string', description: 'Location address' },
        description: { type: 'string', description: 'Location description' }
      },
      required: ['organizationId', 'name']
    }
  },
  {
    name: 'update_location',
    description: 'Update a location',
    inputSchema: {
      type: 'object',
      properties: {
        organizationId: { type: 'number', description: 'Organization ID' },
        locationId: { type: 'number', description: 'Location ID' },
        name: { type: 'string', description: 'Location name' },
        address: { type: 'string', description: 'Location address' },
        description: { type: 'string', description: 'Location description' }
      },
      required: ['organizationId', 'locationId']
    }
  },

  // Alerts - details
  {
    name: 'get_alert',
    description: 'Get a specific alert by UID',
    inputSchema: {
      type: 'object',
      properties: { uid: { type: 'string', description: 'Alert UID' } },
      required: ['uid']
    }
  },
  {
    name: 'reset_alert',
    description: 'Reset/acknowledge an alert by UID. Set confirm=true to execute; default is dry-run.',
    inputSchema: {
      type: 'object',
      properties: {
        uid: { type: 'string', description: 'Alert UID' },
        confirm: { type: 'boolean', description: 'Set to true to execute. Default false (dry-run).' }
      },
      required: ['uid']
    }
  },
  {
    name: 'get_device_alerts',
    description: 'Get alerts for a specific device',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number', description: 'Device ID' }, lang: { type: 'string', description: 'Language code' } },
      required: ['id']
    }
  },

  // Users & Roles
  {
    name: 'get_end_users',
    description: 'List end users',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_end_user',
    description: 'Get an end user by ID',
    inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] }
  },
  {
    name: 'create_end_user',
    description: 'Create a new end user',
    inputSchema: {
      type: 'object',
      properties: {
        firstName: { type: 'string', description: 'First name of the end user' },
        lastName: { type: 'string', description: 'Last name of the end user' },
        email: { type: 'string', description: 'Email address of the end user' },
        phone: { type: 'string', description: 'Phone number of the end user' },
        organizationId: { type: 'number', description: 'Organization identifier' },
        fullPortalAccess: { type: 'boolean', description: 'Grant full portal access' },
        sendInvitation: { type: 'boolean', description: 'Send an invitation email to the end user' }
      },
      required: ['firstName', 'lastName', 'email']
    }
  },
  {
    name: 'update_end_user',
    description: 'Update an end user (Note: phone field cannot be changed after creation)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'End user ID' },
        firstName: { type: 'string', description: 'First name' },
        lastName: { type: 'string', description: 'Last name' },
        email: { type: 'string', description: 'Email address' },
        phone: { type: 'string', description: 'Phone number (read-only after creation)' }
      },
      required: ['id']
    }
  },
  {
    name: 'delete_end_user',
    description: 'Delete an end user by ID',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number', description: 'End user identifier' } },
      required: ['id']
    }
  },
  {
    name: 'get_technicians',
    description: 'List technicians',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_technician',
    description: 'Get a technician by ID',
    inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] }
  },
  {
    name: 'add_role_members',
    description: 'Add users to a role',
    inputSchema: { type: 'object', properties: { roleId: { type: 'number' }, userIds: { type: 'array', items: { type: 'number' } } }, required: ['roleId', 'userIds'] }
  },
  {
    name: 'remove_role_members',
    description: 'Remove users from a role',
    inputSchema: { type: 'object', properties: { roleId: { type: 'number' }, userIds: { type: 'array', items: { type: 'number' } } }, required: ['roleId', 'userIds'] }
  },

  // Contacts
  {
    name: 'get_contacts',
    description: 'List contacts',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_contact',
    description: 'Get a contact by ID',
    inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] }
  },
  {
    name: 'create_contact',
    description: 'Create a contact',
    inputSchema: {
      type: 'object',
      properties: {
        organizationId: { type: 'number' },
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        jobTitle: { type: 'string' }
      },
      required: ['organizationId', 'firstName', 'lastName', 'email']
    }
  },
  {
    name: 'update_contact',
    description: 'Update a contact',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        jobTitle: { type: 'string' }
      },
      required: ['id']
    }
  },
  {
    name: 'delete_contact',
    description: 'Delete a contact',
    inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] }
  },

  // Device approvals and policy
  {
    name: 'approve_devices',
    description: 'Approve or reject multiple devices. Set confirm=true to execute; default is dry-run.',
    inputSchema: { type: 'object', properties: { mode: { type: 'string', enum: ['APPROVE', 'REJECT'], description: 'APPROVE or REJECT' }, deviceIds: { type: 'array', items: { type: 'number' } }, confirm: { type: 'boolean', description: 'Set to true to execute. Default false (dry-run).' } }, required: ['mode', 'deviceIds'] }
  },
  {
    name: 'get_device_policy_overrides',
    description: 'Get policy overrides for a device',
    inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] }
  },
  {
    name: 'reset_device_policy_overrides',
    description: 'Reset/remove all policy overrides for a device. Set confirm=true to execute; default is dry-run.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Device ID' },
        confirm: { type: 'boolean', description: 'Set to true to execute. Default false (dry-run).' }
      },
      required: ['id']
    }
  },
  {
    name: 'get_policies',
    description: 'List policies (optionally templates only)',
    inputSchema: {
      type: 'object',
      properties: {
        templateOnly: { type: 'boolean', description: 'If true, return only policy templates' }
      }
    }
  },

  // System Information Query Tools
  {
    name: 'query_antivirus_status',
    description: 'Query antivirus status information across devices',
    inputSchema: {
      type: 'object',
      properties: {
        df: { type: 'string', description: 'Device filter' },
        cursor: { type: 'string', description: 'Pagination cursor' },
        pageSize: { type: 'number', description: 'Number of results per page (default: 50)' }
      }
    }
  },
  {
    name: 'query_antivirus_threats',
    description: 'Query antivirus threat detections across devices',
    inputSchema: {
      type: 'object',
      properties: {
        df: { type: 'string', description: 'Device filter' },
        cursor: { type: 'string', description: 'Pagination cursor' },
        pageSize: { type: 'number', description: 'Number of results per page (default: 50)' }
      }
    }
  },
  {
    name: 'query_computer_systems',
    description: 'Query computer system information across devices',
    inputSchema: {
      type: 'object',
      properties: {
        df: { type: 'string', description: 'Device filter' },
        cursor: { type: 'string', description: 'Pagination cursor' },
        pageSize: { type: 'number', description: 'Number of results per page (default: 50)' }
      }
    }
  },
  {
    name: 'query_device_health',
    description: 'Query device health status information',
    inputSchema: {
      type: 'object',
      properties: {
        df: { type: 'string', description: 'Device filter' },
        cursor: { type: 'string', description: 'Pagination cursor' },
        pageSize: { type: 'number', description: 'Number of results per page (default: 50)' }
      }
    }
  },
  {
    name: 'query_operating_systems',
    description: 'Query operating system information across devices',
    inputSchema: {
      type: 'object',
      properties: {
        df: { type: 'string', description: 'Device filter' },
        cursor: { type: 'string', description: 'Pagination cursor' },
        pageSize: { type: 'number', description: 'Number of results per page (default: 50)' }
      }
    }
  },
  {
    name: 'query_logged_on_users',
    description: 'Query currently logged on users across devices',
    inputSchema: {
      type: 'object',
      properties: {
        df: { type: 'string', description: 'Device filter' },
        cursor: { type: 'string', description: 'Pagination cursor' },
        pageSize: { type: 'number', description: 'Number of results per page (default: 50)' }
      }
    }
  },

  // Hardware Query Tools
  {
    name: 'query_processors',
    description: 'Query processor information across devices',
    inputSchema: {
      type: 'object',
      properties: {
        df: { type: 'string', description: 'Device filter' },
        cursor: { type: 'string', description: 'Pagination cursor' },
        pageSize: { type: 'number', description: 'Number of results per page (default: 50)' }
      }
    }
  },
  {
    name: 'query_disks',
    description: 'Query disk drive information across devices',
    inputSchema: {
      type: 'object',
      properties: {
        df: { type: 'string', description: 'Device filter' },
        cursor: { type: 'string', description: 'Pagination cursor' },
        pageSize: { type: 'number', description: 'Number of results per page (default: 50)' }
      }
    }
  },
  {
    name: 'query_volumes',
    description: 'Query disk volume information across devices',
    inputSchema: {
      type: 'object',
      properties: {
        df: { type: 'string', description: 'Device filter' },
        cursor: { type: 'string', description: 'Pagination cursor' },
        pageSize: { type: 'number', description: 'Number of results per page (default: 50)' }
      }
    }
  },
  {
    name: 'query_network_interfaces',
    description: 'Query network interface information across devices',
    inputSchema: {
      type: 'object',
      properties: {
        df: { type: 'string', description: 'Device filter' },
        cursor: { type: 'string', description: 'Pagination cursor' },
        pageSize: { type: 'number', description: 'Number of results per page (default: 50)' }
      }
    }
  },
  {
    name: 'query_raid_controllers',
    description: 'Query RAID controller information across devices',
    inputSchema: {
      type: 'object',
      properties: {
        df: { type: 'string', description: 'Device filter' },
        cursor: { type: 'string', description: 'Pagination cursor' },
        pageSize: { type: 'number', description: 'Number of results per page (default: 50)' }
      }
    }
  },
  {
    name: 'query_raid_drives',
    description: 'Query RAID drive information across devices',
    inputSchema: {
      type: 'object',
      properties: {
        df: { type: 'string', description: 'Device filter' },
        cursor: { type: 'string', description: 'Pagination cursor' },
        pageSize: { type: 'number', description: 'Number of results per page (default: 50)' }
      }
    }
  },

  // Software and Patch Query Tools
  {
    name: 'query_software',
    description: 'Query installed software across devices',
    inputSchema: {
      type: 'object',
      properties: {
        df: { type: 'string', description: 'Device filter' },
        cursor: { type: 'string', description: 'Pagination cursor' },
        pageSize: { type: 'number', description: 'Number of results per page (default: 50)' }
      }
    }
  },
  {
    name: 'query_os_patches',
    description: 'Query operating system patches across devices',
    inputSchema: {
      type: 'object',
      properties: {
        df: { type: 'string', description: 'Device filter' },
        cursor: { type: 'string', description: 'Pagination cursor' },
        pageSize: { type: 'number', description: 'Number of results per page (default: 50)' }
      }
    }
  },
  {
    name: 'query_software_patches',
    description: 'Query software patches across devices',
    inputSchema: {
      type: 'object',
      properties: {
        df: { type: 'string', description: 'Device filter' },
        cursor: { type: 'string', description: 'Pagination cursor' },
        pageSize: { type: 'number', description: 'Number of results per page (default: 50)' }
      }
    }
  },
  {
    name: 'query_os_patch_installs',
    description: 'Query OS patch installation history across devices',
    inputSchema: {
      type: 'object',
      properties: {
        df: { type: 'string', description: 'Device filter' },
        cursor: { type: 'string', description: 'Pagination cursor' },
        pageSize: { type: 'number', description: 'Number of results per page (default: 50)' }
      }
    }
  },
  {
    name: 'query_software_patch_installs',
    description: 'Query software patch installation history across devices',
    inputSchema: {
      type: 'object',
      properties: {
        df: { type: 'string', description: 'Device filter' },
        cursor: { type: 'string', description: 'Pagination cursor' },
        pageSize: { type: 'number', description: 'Number of results per page (default: 50)' }
      }
    }
  },
  {
    name: 'query_windows_services',
    description: 'Query Windows services across devices',
    inputSchema: {
      type: 'object',
      properties: {
        df: { type: 'string', description: 'Device filter' },
        cursor: { type: 'string', description: 'Pagination cursor' },
        pageSize: { type: 'number', description: 'Number of results per page (default: 50)' }
      }
    }
  },

  // Custom Fields and Policy Query Tools
  {
    name: 'query_custom_fields',
    description: 'Query custom field values across devices',
    inputSchema: {
      type: 'object',
      properties: {
        df: { type: 'string', description: 'Device filter' },
        cursor: { type: 'string', description: 'Pagination cursor' },
        pageSize: { type: 'number', description: 'Number of results per page (default: 50)' }
      }
    }
  },
  {
    name: 'query_custom_fields_detailed',
    description: 'Query detailed custom field information across devices',
    inputSchema: {
      type: 'object',
      properties: {
        df: { type: 'string', description: 'Device filter' },
        cursor: { type: 'string', description: 'Pagination cursor' },
        pageSize: { type: 'number', description: 'Number of results per page (default: 50)' }
      }
    }
  },
  {
    name: 'query_scoped_custom_fields',
    description: 'Query scoped custom field values across devices',
    inputSchema: {
      type: 'object',
      properties: {
        df: { type: 'string', description: 'Device filter' },
        cursor: { type: 'string', description: 'Pagination cursor' },
        pageSize: { type: 'number', description: 'Number of results per page (default: 50)' }
      }
    }
  },
  {
    name: 'query_scoped_custom_fields_detailed',
    description: 'Query detailed scoped custom field information across devices',
    inputSchema: {
      type: 'object',
      properties: {
        df: { type: 'string', description: 'Device filter' },
        cursor: { type: 'string', description: 'Pagination cursor' },
        pageSize: { type: 'number', description: 'Number of results per page (default: 50)' }
      }
    }
  },
  {
    name: 'query_policy_overrides',
    description: 'Query policy override information across devices',
    inputSchema: {
      type: 'object',
      properties: {
        df: { type: 'string', description: 'Device filter' },
        cursor: { type: 'string', description: 'Pagination cursor' },
        pageSize: { type: 'number', description: 'Number of results per page (default: 50)' }
      }
    }
  },

  // Backup Query Tools
  {
    name: 'query_backup_usage',
    description: 'Query backup usage statistics across devices',
    inputSchema: {
      type: 'object',
      properties: {
        df: { type: 'string', description: 'Device filter' },
        cursor: { type: 'string', description: 'Pagination cursor' },
        pageSize: { type: 'number', description: 'Number of results per page (default: 50)' }
      }
    }
  },

  // Auto-paginating search tools
  {
    name: 'search_software',
    description: 'Search installed software across all devices by name. Auto-paginates and filters server-side — much faster than manually iterating query_software.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Software name to search for (case-insensitive partial match)' },
        df: { type: 'string', description: 'Device filter (e.g., "org = 1")' },
        maxResults: { type: 'number', description: 'Maximum results to return (default: 50)' }
      },
      required: ['name']
    }
  },
  {
    name: 'search_os_patches',
    description: 'Search OS patches across all devices by name. Auto-paginates and filters server-side.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Patch name/KB to search for (case-insensitive partial match)' },
        df: { type: 'string', description: 'Device filter' },
        maxResults: { type: 'number', description: 'Maximum results to return (default: 50)' }
      },
      required: ['name']
    }
  },
  {
    name: 'search_windows_services',
    description: 'Search Windows services across all devices by name. Auto-paginates and filters server-side.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Service name to search for (case-insensitive partial match)' },
        df: { type: 'string', description: 'Device filter' },
        maxResults: { type: 'number', description: 'Maximum results to return (default: 50)' }
      },
      required: ['name']
    }
  },

  // Phase 2 — Write operations with confirmation guardrails

  {
    name: 'update_device',
    description: 'Update a device display name or user-defined fields. Set confirm=true to execute; default is dry-run.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Device ID' },
        displayName: { type: 'string', description: 'New display name' },
        userData: { type: 'object', description: 'Key-value pairs of user-defined fields' },
        confirm: { type: 'boolean', description: 'Set to true to execute. Default false (dry-run).' }
      },
      required: ['id']
    }
  },
  {
    name: 'update_device_custom_fields',
    description: 'Write custom field values on a device. Set confirm=true to execute; default is dry-run.',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: { type: 'number', description: 'Device ID' },
        fields: { type: 'object', description: 'Key-value pairs of custom fields to set' },
        confirm: { type: 'boolean', description: 'Set to true to execute. Default false (dry-run).' }
      },
      required: ['deviceId', 'fields']
    }
  },
  {
    name: 'update_org_custom_fields',
    description: 'Write custom field values on an organization. Set confirm=true to execute; default is dry-run.',
    inputSchema: {
      type: 'object',
      properties: {
        orgId: { type: 'number', description: 'Organization ID' },
        fields: { type: 'object', description: 'Key-value pairs of custom fields to set' },
        confirm: { type: 'boolean', description: 'Set to true to execute. Default false (dry-run).' }
      },
      required: ['orgId', 'fields']
    }
  },

  // Ticketing
  {
    name: 'get_ticket_boards',
    description: 'List all ticket boards',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_ticket_statuses',
    description: 'List all ticket status values configured in NinjaOne (parent + sub-statuses). Use before update_ticket to find valid status names.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_tickets',
    description: 'List tickets from a board with pagination',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: { type: 'number', description: 'Ticket board ID' },
        pageSize: { type: 'number', description: 'Results per page (default: 25)' },
        lastCursorId: { type: 'number', description: 'Pagination cursor (last cursor ID from previous response)' }
      },
      required: ['boardId']
    }
  },
  {
    name: 'get_ticket',
    description: 'Get full detail for a single ticket',
    inputSchema: {
      type: 'object',
      properties: { ticketId: { type: 'number', description: 'Ticket ID' } },
      required: ['ticketId']
    }
  },
  {
    name: 'get_ticket_log',
    description: 'Get activity log for a ticket',
    inputSchema: {
      type: 'object',
      properties: { ticketId: { type: 'number', description: 'Ticket ID' } },
      required: ['ticketId']
    }
  },
  {
    name: 'create_ticket',
    description: 'Create a new ticket. Set confirm=true to execute; default is dry-run.',
    inputSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'number', description: 'Organization (client) ID' },
        ticketFormId: { type: 'number', description: 'Ticket form ID (default: 1)' },
        summary: { type: 'string', description: 'Ticket summary (max 200 chars)' },
        description: { type: 'string', description: 'Ticket description body text' },
        status: { type: 'string', enum: ['NEW', 'OPEN', 'WAITING', 'PAUSED', 'RESOLVED', 'CLOSED'], description: 'Ticket status (default: NEW)' },
        priority: { type: 'string', enum: ['NONE', 'LOW', 'MEDIUM', 'HIGH'], description: 'Priority' },
        severity: { type: 'string', enum: ['NONE', 'MINOR', 'MODERATE', 'MAJOR', 'CRITICAL'], description: 'Severity' },
        type: { type: 'string', enum: ['PROBLEM', 'QUESTION', 'INCIDENT', 'TASK'], description: 'Ticket type' },
        nodeId: { type: 'number', description: 'Associated device (node) ID' },
        assignedAppUserId: { type: 'number', description: 'Assigned technician user ID' },
        confirm: { type: 'boolean', description: 'Set to true to execute. Default false (dry-run).' }
      },
      required: ['summary']
    }
  },
  {
    name: 'update_ticket',
    description: 'Update an existing ticket. Fetches current state automatically — only specify fields you want to change. Set confirm=true to execute; default is dry-run.',
    inputSchema: {
      type: 'object',
      properties: {
        ticketId: { type: 'number', description: 'Ticket ID' },
        summary: { type: 'string', description: 'Ticket subject/summary (max 200 chars)' },
        status: { type: 'string', description: 'Status name (e.g. NEW, OPEN, WAITING, PAUSED, RESOLVED, CLOSED, APPROVED, REJECTED — or tenant-specific sub-statuses like "Awaiting Response"). Fetch full catalog via get_ticket_statuses.' },
        priority: { type: 'string', enum: ['NONE', 'LOW', 'MEDIUM', 'HIGH'], description: 'Priority' },
        severity: { type: 'string', enum: ['NONE', 'MINOR', 'MODERATE', 'MAJOR', 'CRITICAL'], description: 'Severity' },
        type: { type: 'string', enum: ['PROBLEM', 'QUESTION', 'INCIDENT', 'TASK'], description: 'Ticket type' },
        assignedAppUserId: { type: 'number', description: 'Assigned technician user ID' },
        comment: { type: 'string', description: 'Optional comment to add with the update' },
        confirm: { type: 'boolean', description: 'Set to true to execute. Default false (dry-run).' }
      },
      required: ['ticketId']
    }
  },
  {
    name: 'add_ticket_comment',
    description: 'Add a comment/note to a ticket via POST /v2/ticketing/ticket/{id}/comment. Set confirm=true to execute; default is dry-run.',
    inputSchema: {
      type: 'object',
      properties: {
        ticketId: { type: 'number', description: 'Ticket ID' },
        comment: { type: 'string', description: 'Comment text' },
        public: { type: 'boolean', description: 'Whether the comment is visible to end users (default true)' },
        confirm: { type: 'boolean', description: 'Set to true to execute. Default false (dry-run).' }
      },
      required: ['ticketId', 'comment']
    }
  },

  // Phase 3 — Webhooks & event-driven

  {
    name: 'get_webhook_config',
    description: 'Show the current NinjaOne webhook configuration',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'set_webhook_config',
    description: 'Configure a webhook endpoint for NinjaOne events. Set confirm=true to execute; default is dry-run.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Webhook URL to receive events' },
        activities: { type: 'object', description: 'Map of activity categories to event type arrays (e.g., {"DEVICE": ["ADDED", "DELETED"]})' },
        expand: { type: 'array', items: { type: 'string' }, description: 'Activity types to include expanded data for' },
        headers: {
          type: 'array',
          description: 'Custom HTTP headers (array of {name, value} objects) — use for auth/secrets',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              value: { type: 'string' }
            },
            required: ['name', 'value']
          }
        },
        organizationIds: { type: 'array', items: { type: 'number' }, description: 'Limit webhook to specific organization IDs (optional)' },
        confirm: { type: 'boolean', description: 'Set to true to execute. Default false (dry-run).' }
      },
      required: ['url']
    }
  },
  {
    name: 'delete_webhook_config',
    description: 'Remove the webhook configuration. Set confirm=true to execute; default is dry-run.',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: { type: 'boolean', description: 'Set to true to execute. Default false (dry-run).' }
      }
    }
  },
  {
    name: 'get_stale_devices',
    description: 'List devices that have not checked in for more than N hours',
    inputSchema: {
      type: 'object',
      properties: {
        sinceHours: { type: 'number', description: 'Hours since last check-in (default: 48)' }
      }
    }
  },
  {
    name: 'get_devices_pending_patches',
    description: 'List devices with pending or failed OS patches across the fleet',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['PENDING', 'FAILED'], description: 'Patch status filter (default: PENDING)' }
      }
    }
  },
  {
    name: 'get_activities',
    description: 'Query the NinjaOne system-wide activity log',
    inputSchema: {
      type: 'object',
      properties: {
        pageSize: { type: 'number', description: 'Results per page (default: 50)' },
        after: { type: 'number', description: 'Return activities after this activity ID' },
        olderThan: { type: 'number', description: 'Return activities older than this activity ID' },
        newerThan: { type: 'number', description: 'Return activities newer than this activity ID' },
        type: { type: 'string', description: 'Activity type filter' },
        df: { type: 'string', description: 'Device filter (e.g., "org = 1")' },
        user: { type: 'number', description: 'Filter by user ID' },
        status: { type: 'string', description: 'Filter by status' }
      }
    }
  },

  // Phase 4 — Script execution & policy management

  {
    name: 'list_automations',
    description: 'List all saved automation scripts/tasks in NinjaOne',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'run_device_script',
    description: 'Execute a saved automation script on a device. Set confirm=true to execute; default is dry-run.',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: { type: 'number', description: 'Device ID' },
        scriptId: { type: 'number', description: 'Script/automation ID from NinjaOne' },
        type: { type: 'string', enum: ['ACTION', 'SCRIPT'], description: 'Script type (default: SCRIPT)' },
        runAs: { type: 'string', description: 'Execution context. Use lowercase "system" (default) to avoid access denied errors — uppercase "SYSTEM" can cause credential access denials, especially on Linux devices.' },
        parameters: { type: 'string', description: 'Script parameters string' },
        confirm: { type: 'boolean', description: 'Set to true to execute. Default false (dry-run).' }
      },
      required: ['deviceId', 'scriptId']
    }
  },
  {
    name: 'get_script_result',
    description: 'Poll the result of a previously triggered script run',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: { type: 'number', description: 'Device ID' },
        activityId: { type: 'number', description: 'Activity ID from the script run' }
      },
      required: ['deviceId', 'activityId']
    }
  },
  {
    name: 'get_policy',
    description: 'Get full detail for a specific policy',
    inputSchema: {
      type: 'object',
      properties: { policyId: { type: 'number', description: 'Policy ID' } },
      required: ['policyId']
    }
  },
  {
    name: 'assign_device_policy',
    description: 'Assign a policy to a device. Set confirm=true to execute; default is dry-run.',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: { type: 'number', description: 'Device ID' },
        policyId: { type: 'number', description: 'Policy ID to assign' },
        confirm: { type: 'boolean', description: 'Set to true to execute. Default false (dry-run).' }
      },
      required: ['deviceId', 'policyId']
    }
  },
  {
    name: 'get_pending_devices',
    description: 'List all devices awaiting approval',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'device_filter_help',
    description: 'Get help on NinjaOne Device Filter (df) syntax',
    inputSchema: { type: 'object', properties: {} }
  },

  // Phase 5 — High-level script execution & job tracking

  {
    name: 'execute_script',
    description: 'Execute an automation script by name with automatic tracking. Resolves script name → ID, executes, and polls until completion. Set confirm=true to execute; default is dry-run.',
    inputSchema: {
      type: 'object',
      properties: {
        device_id: { type: 'number', description: 'Device ID' },
        script: { type: 'string', description: 'Script name (not numeric ID). The MCP will resolve the name to an ID automatically.' },
        parameters: { type: 'string', description: 'Script parameters string (max 30,000 chars, max 50 params)' },
        run_as: { type: 'string', description: 'Execution context. Use lowercase "system" (default) to avoid access denied errors — uppercase "SYSTEM" can cause credential access denials, especially on Linux devices.' },
        confirm: { type: 'boolean', description: 'Set to true to execute. Default false (dry-run).' }
      },
      required: ['device_id', 'script']
    }
  },
  {
    name: 'get_active_jobs',
    description: 'Get active jobs for a device — useful for diagnostics and monitoring script execution',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: { type: 'number', description: 'Device ID' }
      },
      required: ['deviceId']
    }
  },
  {
    name: 'get_device_scripting_options',
    description: 'Get available scripting options (scripts and actions) for a specific device',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: { type: 'number', description: 'Device ID' }
      },
      required: ['deviceId']
    }
  }
];

/**
 * NinjaONE MCP Server Class with multiple transports
 */
class NinjaOneMCPServer {
  private server: Server;
  private api: NinjaOneAPI;

  constructor() {
    try {
      this.api = new NinjaOneAPI();
      this.server = new Server(
        {
          name: 'ninjaone-mcp-server',
          version: '1.2.0',
        },
        {
          capabilities: {
            tools: {}
          }
        }
      );
      this.setupToolHandlers();
    } catch (error) {
      console.error('Failed to initialize NinjaONE MCP Server:', error);
      throw error;
    }
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: TOOLS
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      try {
        console.error(`Executing tool: ${name}`);
        const result = await this.routeToolCall(name, args || {});
        return result;
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  private dryRun(message: string) {
    return {
      content: [{
        type: 'text',
        text: `DRY RUN — no changes made.\n${message}\nRe-call with confirm=true to execute.`
      }]
    };
  }

  private result(data: any) {
    // Use compact JSON to minimise token consumption in Claude Desktop.
    // For array responses, prepend a count so the model knows the size at a glance.
    let text: string;
    if (Array.isArray(data)) {
      text = `{"count":${data.length},"results":${JSON.stringify(data)}}`;
    } else if (data?.results && Array.isArray(data.results)) {
      text = JSON.stringify({ ...data, count: data.results.length });
    } else {
      text = JSON.stringify(data);
    }
    return {
      content: [{
        type: 'text',
        text
      }]
    };
  }

  private async routeToolCall(name: string, args: any) {
    try {
      switch (name) {
        // ── Device Management (read) ──
        case 'get_devices':
          return this.result(await this.api.getDevices(args.df, args.pageSize || 50, args.after));
        case 'get_device':
          return this.result(await this.api.getDevice(args.id));
        case 'get_device_dashboard_url':
          return this.result(await this.api.getDeviceDashboardUrl(args.id));
        case 'get_device_software':
          return this.result(await this.api.getDeviceSoftware(args.id));
        case 'get_device_activities':
          return this.result(await this.api.getDeviceActivities(args.id, args.pageSize, undefined, args.type));
        case 'get_device_automation_activities':
          return this.result(await this.api.getDeviceActivities(args.id, args.pageSize || 10, undefined, 'AUTOMATION'));
        case 'search_devices_by_name':
          return this.result(await this.searchDevicesByName(args.name, args.limit || 10));
        case 'find_windows11_devices':
          return this.result(await this.findWindows11Devices(args.limit || 20));

        // ── Device Management (write — confirm guarded) ──
        case 'reboot_device': {
          const mode = args.mode || 'NORMAL';
          if (!args.confirm) {
            const device = await this.api.getDevice(args.id);
            return this.dryRun(`Would reboot device id=${args.id} (${device.systemName || device.displayName || 'unknown'}) in ${mode} mode.`);
          }
          return this.result(await this.api.rebootDevice(args.id, mode));
        }
        case 'set_device_maintenance': {
          if (typeof args.id !== 'number') {
            throw new McpError(ErrorCode.InvalidParams, 'Device ID must be a number');
          }
          if (args.mode !== 'ON' && args.mode !== 'OFF') {
            throw new McpError(ErrorCode.InvalidParams, 'Maintenance mode must be ON or OFF');
          }

          let durationSelection: MaintenanceWindowSelection | undefined;
          if (args.mode === 'ON') {
            if (args.duration === null || args.duration === undefined || typeof args.duration !== 'object') {
              throw new McpError(ErrorCode.InvalidParams, 'Duration details are required when enabling maintenance mode');
            }
            const duration = args.duration;
            const permanent = duration.permanent === true;
            if (permanent) {
              durationSelection = { permanent: true };
            } else {
              const value = duration.value;
              const unitRaw = duration.unit;
              if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
                throw new McpError(ErrorCode.InvalidParams, 'Duration value must be a positive number');
              }
              const unit = typeof unitRaw === 'string' ? unitRaw.toUpperCase() : '';
              if (!Object.prototype.hasOwnProperty.call(MAINTENANCE_UNIT_SECONDS, unit)) {
                throw new McpError(ErrorCode.InvalidParams, 'Duration unit must be one of MINUTES, HOURS, DAYS, or WEEKS');
              }
              const seconds = Math.round(value * MAINTENANCE_UNIT_SECONDS[unit as MaintenanceUnit]);
              if (seconds < 15 * 60) {
                throw new McpError(ErrorCode.InvalidParams, 'Maintenance windows must be at least 15 minutes long');
              }
              durationSelection = { permanent: false, value, unit: unit as MaintenanceUnit, seconds };
            }
          }

          if (!args.confirm) {
            const device = await this.api.getDevice(args.id);
            const desc = args.mode === 'OFF'
              ? `Would disable maintenance mode on device id=${args.id} (${device.systemName || device.displayName || 'unknown'}).`
              : durationSelection?.permanent
                ? `Would enable PERMANENT maintenance mode on device id=${args.id} (${device.systemName || device.displayName || 'unknown'}).`
                : `Would enable maintenance mode on device id=${args.id} (${device.systemName || device.displayName || 'unknown'}) for ${(durationSelection as any)?.value} ${(durationSelection as any)?.unit}.`;
            return this.dryRun(desc);
          }
          return this.result(await this.api.setDeviceMaintenance(args.id, args.mode, durationSelection));
        }
        case 'update_device': {
          if (!args.confirm) {
            const device = await this.api.getDevice(args.id);
            const changes: string[] = [];
            if (args.displayName) changes.push(`displayName → "${args.displayName}"`);
            if (args.userData) changes.push(`userData → ${JSON.stringify(args.userData)}`);
            return this.dryRun(`Would update device id=${args.id} (${device.systemName || device.displayName || 'unknown'}).\nChanges: ${changes.join(', ') || 'none specified'}`);
          }
          const body: any = {};
          if (args.displayName !== undefined) body.displayName = args.displayName;
          if (args.userData !== undefined) body.userData = args.userData;
          return this.result(await this.api.updateDevice(args.id, body));
        }

        // ── Alerts ──
        case 'get_alerts':
          return this.result(await this.api.getAlerts(args.df, args.sourceType, args.since));
        case 'get_alert':
          return this.result(await this.api.getAlert(args.uid));
        case 'get_device_alerts':
          return this.result(await this.api.getDeviceAlerts(args.id, args.lang));
        case 'reset_alert': {
          if (!args.confirm) {
            const alert = await this.api.getAlert(args.uid);
            const desc = alert.message || alert.subject || 'unknown';
            const devId = alert.deviceId || 'unknown';
            return this.dryRun(`Would reset alert uid=${args.uid} (${desc}) on device id=${devId}.`);
          }
          return this.result(await this.api.resetAlert(args.uid));
        }

        // ── Organizations ──
        case 'get_organizations':
          return this.result(await this.api.getOrganizations(args.pageSize, args.after));
        case 'get_organization':
          return this.result(await this.api.getOrganization(args.id));
        case 'get_organization_locations':
          return this.result(await this.api.getOrganizationLocations(args.id));
        case 'get_organization_policies':
          return this.result(await this.api.getOrganizationPolicies(args.id));
        case 'generate_organization_installer':
          return this.result(await this.api.generateOrganizationInstaller(args.installerType, args.locationId, args.organizationId));
        case 'create_organization':
          return this.result(await this.api.createOrganization(args.name, args.description, args.nodeApprovalMode, args.tags));
        case 'update_organization':
          return this.result(await this.api.updateOrganization(args.id, args.name, args.description, undefined, args.tags));

        // ── Locations ──
        case 'create_location':
          return this.result(await this.api.createLocation(args.organizationId, args.name, args.address, args.description));
        case 'update_location':
          return this.result(await this.api.updateLocation(args.organizationId, args.locationId, args.name, args.address, args.description));

        // ── Region utilities ──
        case 'list_regions':
          return this.result(this.api.listRegions());
        case 'set_region':
          if (args.baseUrl) this.api.setBaseUrl(args.baseUrl);
          else if (args.region) this.api.setRegion(args.region);
          else throw new McpError(ErrorCode.InvalidParams, 'Provide either region or baseUrl');
          return this.result({ ok: true });

        // ── Device Control ──
        case 'control_windows_service':
          return this.result(await this.api.controlWindowsService(args.id, args.serviceId, args.action));
        case 'configure_windows_service':
          return this.result(await this.api.configureWindowsService(args.id, args.serviceId, args.startupType));

        // ── Patching ──
        case 'scan_device_os_patches':
          return this.result(await this.api.scanDeviceOSPatches(args.id));
        case 'scan_device_software_patches':
          return this.result(await this.api.scanDeviceSoftwarePatches(args.id));
        case 'apply_device_os_patches': {
          if (!args.confirm) {
            const device = await this.api.getDevice(args.id);
            const patchList = (args.patches || []).map((p: any) => p.id || JSON.stringify(p)).join(', ');
            return this.dryRun(`Would apply ${args.patches?.length || 0} OS patch(es) to device id=${args.id} (${device.systemName || device.displayName || 'unknown'}).\nPatches: ${patchList}`);
          }
          return this.result(await this.api.applyDeviceOSPatches(args.id, args.patches));
        }
        case 'apply_device_software_patches': {
          if (!args.confirm) {
            const device = await this.api.getDevice(args.id);
            const patchList = (args.patches || []).map((p: any) => p.id || JSON.stringify(p)).join(', ');
            return this.dryRun(`Would apply ${args.patches?.length || 0} software patch(es) to device id=${args.id} (${device.systemName || device.displayName || 'unknown'}).\nPatches: ${patchList}`);
          }
          return this.result(await this.api.applyDeviceSoftwarePatches(args.id, args.patches));
        }

        // ── Users & Roles ──
        case 'get_end_users':
          return this.result(await this.api.getEndUsers());
        case 'get_end_user':
          return this.result(await this.api.getEndUser(args.id));
        case 'create_end_user':
          return this.result(await this.api.createEndUser(
            { firstName: args.firstName, lastName: args.lastName, email: args.email, phone: args.phone, organizationId: args.organizationId, fullPortalAccess: args.fullPortalAccess },
            args.sendInvitation
          ));
        case 'update_end_user':
          return this.result(await this.api.updateEndUser(args.id, args.firstName, args.lastName, args.email, args.phone));
        case 'delete_end_user':
          return this.result(await this.api.deleteEndUser(args.id));
        case 'get_technicians':
          return this.result(await this.api.getTechnicians());
        case 'get_technician':
          return this.result(await this.api.getTechnician(args.id));
        case 'add_role_members':
          return this.result(await this.api.addRoleMembers(args.roleId, args.userIds));
        case 'remove_role_members':
          return this.result(await this.api.removeRoleMembers(args.roleId, args.userIds));

        // ── Contacts ──
        case 'get_contacts':
          return this.result(await this.api.getContacts());
        case 'get_contact':
          return this.result(await this.api.getContact(args.id));
        case 'create_contact':
          return this.result(await this.api.createContact(args.organizationId, args.firstName, args.lastName, args.email, args.phone, args.jobTitle));
        case 'update_contact':
          return this.result(await this.api.updateContact(args.id, args.firstName, args.lastName, args.email, args.phone, args.jobTitle));
        case 'delete_contact':
          return this.result(await this.api.deleteContact(args.id));

        // ── Device approvals & policy ──
        case 'approve_devices': {
          if (!args.confirm) {
            return this.dryRun(`Would ${args.mode} ${args.deviceIds.length} device(s): [${args.deviceIds.join(', ')}].`);
          }
          return this.result(await this.api.approveDevices(args.mode, args.deviceIds));
        }
        case 'get_device_policy_overrides':
          return this.result(await this.api.getDevicePolicyOverrides(args.id));
        case 'reset_device_policy_overrides': {
          if (!args.confirm) {
            const overrides = await this.api.getDevicePolicyOverrides(args.id);
            return this.dryRun(`Would reset all policy overrides on device id=${args.id}.\nCurrent overrides: ${JSON.stringify(overrides, null, 2)}`);
          }
          return this.result(await this.api.resetDevicePolicyOverrides(args.id));
        }
        case 'get_policies':
          return this.result(await this.api.getPolicies(args.templateOnly));

        // ── System Information Queries ──
        case 'query_antivirus_status':
          return this.result(await this.api.queryAntivirusStatus(args.df, args.cursor, args.pageSize || 50));
        case 'query_antivirus_threats':
          return this.result(await this.api.queryAntivirusThreats(args.df, args.cursor, args.pageSize || 50));
        case 'query_computer_systems':
          return this.result(await this.api.queryComputerSystems(args.df, args.cursor, args.pageSize || 50));
        case 'query_device_health':
          return this.result(await this.api.queryDeviceHealth(args.df, args.cursor, args.pageSize || 50));
        case 'query_operating_systems':
          return this.result(await this.api.queryOperatingSystems(args.df, args.cursor, args.pageSize || 50));
        case 'query_logged_on_users':
          return this.result(await this.api.queryLoggedOnUsers(args.df, args.cursor, args.pageSize || 50));

        // ── Hardware Queries ──
        case 'query_processors':
          return this.result(await this.api.queryProcessors(args.df, args.cursor, args.pageSize || 50));
        case 'query_disks':
          return this.result(await this.api.queryDisks(args.df, args.cursor, args.pageSize || 50));
        case 'query_volumes':
          return this.result(await this.api.queryVolumes(args.df, args.cursor, args.pageSize || 50));
        case 'query_network_interfaces':
          return this.result(await this.api.queryNetworkInterfaces(args.df, args.cursor, args.pageSize || 50));
        case 'query_raid_controllers':
          return this.result(await this.api.queryRaidControllers(args.df, args.cursor, args.pageSize || 50));
        case 'query_raid_drives':
          return this.result(await this.api.queryRaidDrives(args.df, args.cursor, args.pageSize || 50));

        // ── Software & Patch Queries ──
        case 'query_software':
          return this.result(await this.api.querySoftware(args.df, args.cursor, args.pageSize || 50));
        case 'query_os_patches':
          return this.result(await this.api.queryOSPatches(args.df, args.cursor, args.pageSize || 50));
        case 'query_software_patches':
          return this.result(await this.api.querySoftwarePatches(args.df, args.cursor, args.pageSize || 50));
        case 'query_os_patch_installs':
          return this.result(await this.api.queryOSPatchInstalls(args.df, args.cursor, args.pageSize || 50));
        case 'query_software_patch_installs':
          return this.result(await this.api.querySoftwarePatchInstalls(args.df, args.cursor, args.pageSize || 50));
        case 'query_windows_services':
          return this.result(await this.api.queryWindowsServices(args.df, args.cursor, args.pageSize || 50));

        // ── Custom Fields & Policy Queries ──
        case 'query_custom_fields':
          return this.result(await this.api.queryCustomFields(args.df, args.cursor, args.pageSize || 50));
        case 'query_custom_fields_detailed':
          return this.result(await this.api.queryCustomFieldsDetailed(args.df, args.cursor, args.pageSize || 50));
        case 'query_scoped_custom_fields':
          return this.result(await this.api.queryScopedCustomFields(args.df, args.cursor, args.pageSize || 50));
        case 'query_scoped_custom_fields_detailed':
          return this.result(await this.api.queryScopedCustomFieldsDetailed(args.df, args.cursor, args.pageSize || 50));
        case 'query_policy_overrides':
          return this.result(await this.api.queryPolicyOverrides(args.df, args.cursor, args.pageSize || 50));

        // ── Backup ──
        case 'query_backup_usage':
          return this.result(await this.api.queryBackupUsage(args.df, args.cursor, args.pageSize || 50));

        // ── Auto-paginating search tools ──
        case 'search_software':
          return this.result(await this.api.queryAllFiltered('/v2/queries/software', {
            df: args.df,
            filter: { text: args.name, fields: ['name', 'publisher'] },
            maxResults: args.maxResults || 50
          }));
        case 'search_os_patches':
          return this.result(await this.api.queryAllFiltered('/v2/queries/os-patches', {
            df: args.df,
            filter: { text: args.name, fields: ['name', 'kbNumber'] },
            maxResults: args.maxResults || 50
          }));
        case 'search_windows_services':
          return this.result(await this.api.queryAllFiltered('/v2/queries/windows-services', {
            df: args.df,
            filter: { text: args.name, fields: ['name', 'displayName'] },
            maxResults: args.maxResults || 50
          }));

        // ── Phase 2: Custom field writes ──
        case 'update_device_custom_fields': {
          if (!args.confirm) {
            return this.dryRun(`Would update custom fields on device id=${args.deviceId}.\nFields: ${JSON.stringify(args.fields, null, 2)}`);
          }
          return this.result(await this.api.updateDeviceCustomFields(args.deviceId, args.fields));
        }
        case 'update_org_custom_fields': {
          if (!args.confirm) {
            return this.dryRun(`Would update custom fields on organization id=${args.orgId}.\nFields: ${JSON.stringify(args.fields, null, 2)}`);
          }
          return this.result(await this.api.updateOrganizationCustomFields(args.orgId, args.fields));
        }

        // ── Phase 2: Ticketing ──
        case 'get_ticket_boards':
          return this.result(await this.api.getTicketBoards());
        case 'get_ticket_statuses':
          return this.result(await this.api.getTicketStatuses());
        case 'get_tickets':
          return this.result(await this.api.getTickets(args.boardId, args.pageSize || 25, args.lastCursorId));
        case 'get_ticket':
          return this.result(await this.api.getTicket(args.ticketId));
        case 'get_ticket_log':
          return this.result(await this.api.getTicketLog(args.ticketId));
        case 'create_ticket': {
          if (!args.confirm) {
            return this.dryRun(`Would create ticket.\nSummary: "${args.summary}"\nStatus: ${args.status || 'NEW'}\nPriority: ${args.priority || 'not set'}\nDevice: ${args.nodeId || 'none'}`);
          }
          const body: any = {
            summary: args.summary,
            status: args.status || 'NEW',
            ticketFormId: args.ticketFormId || 1
          };
          if (args.clientId !== undefined) body.clientId = args.clientId;
          if (args.description !== undefined) body.description = { public: true, body: args.description };
          if (args.priority !== undefined) body.priority = args.priority;
          if (args.severity !== undefined) body.severity = args.severity;
          if (args.type !== undefined) body.type = args.type;
          if (args.assignedAppUserId !== undefined) body.assignedAppUserId = args.assignedAppUserId;
          if (args.nodeId !== undefined) body.nodeId = args.nodeId;
          return this.result(await this.api.createTicket(body));
        }
        case 'update_ticket': {
          if (!args.confirm) {
            const changes: string[] = [];
            if (args.summary) changes.push(`summary → "${args.summary}"`);
            if (args.status) changes.push(`status → "${args.status}"`);
            if (args.priority) changes.push(`priority → "${args.priority}"`);
            if (args.severity) changes.push(`severity → "${args.severity}"`);
            if (args.type) changes.push(`type → "${args.type}"`);
            if (args.assignedAppUserId) changes.push(`assignedAppUserId → ${args.assignedAppUserId}`);
            if (args.comment) changes.push(`comment: "${args.comment}"`);
            return this.dryRun(`Would update ticket id=${args.ticketId}.\nChanges: ${changes.join(', ') || 'none specified'}`);
          }
          const ticketFields: any = {};
          if (args.summary !== undefined) ticketFields.summary = args.summary;
          if (args.status !== undefined) ticketFields.status = args.status;
          if (args.priority !== undefined) ticketFields.priority = args.priority;
          if (args.severity !== undefined) ticketFields.severity = args.severity;
          if (args.type !== undefined) ticketFields.type = args.type;
          if (args.assignedAppUserId !== undefined) ticketFields.assignedAppUserId = args.assignedAppUserId;
          const comment = args.comment ? { public: true, body: args.comment } : undefined;
          return this.result(await this.api.updateTicket(args.ticketId, ticketFields, comment));
        }
        case 'add_ticket_comment': {
          if (!args.confirm) {
            return this.dryRun(`Would add comment to ticket id=${args.ticketId}.\nComment: "${args.comment}"`);
          }
          const isPublic = args.public !== false;
          return this.result(await this.api.addTicketComment(args.ticketId, args.comment, isPublic));
        }

        // ── Phase 3: Webhooks ──
        case 'get_webhook_config':
          return this.result(await this.api.getWebhookConfig());
        case 'set_webhook_config': {
          if (!args.confirm) {
            return this.dryRun(`Would configure webhook.\nURL: ${args.url}\nActivities: ${args.activities ? JSON.stringify(args.activities) : 'all'}`);
          }
          const body: any = { url: args.url };
          if (args.activities !== undefined) body.activities = args.activities;
          if (args.expand !== undefined) body.expand = args.expand;
          if (args.headers !== undefined) body.headers = args.headers;
          if (args.organizationIds !== undefined) body.organizationIds = args.organizationIds;
          return this.result(await this.api.setWebhookConfig(body));
        }
        case 'delete_webhook_config': {
          if (!args.confirm) {
            return this.dryRun(`Would delete the current webhook configuration.`);
          }
          return this.result(await this.api.deleteWebhookConfig());
        }

        // ── Phase 3: Polling queries ──
        case 'get_stale_devices':
          return this.result(await this.api.getStaleDevices(args.sinceHours || 48));
        case 'get_devices_pending_patches':
          return this.result(await this.api.getDevicesWithPendingPatches(args.status || 'PENDING'));
        case 'get_activities':
          return this.result(await this.api.getActivities({
            pageSize: args.pageSize || 50,
            after: args.after,
            olderThan: args.olderThan,
            newerThan: args.newerThan,
            type: args.type,
            df: args.df,
            user: args.user,
            status: args.status
          }));

        // ── Phase 4: Script execution ──
        case 'list_automations':
          return this.result(await this.api.getAutomations());
        case 'run_device_script': {
          if (!args.confirm) {
            const device = await this.api.getDevice(args.deviceId);
            return this.dryRun(`Would run script id=${args.scriptId} on device id=${args.deviceId} (${device.systemName || device.displayName || 'unknown'}).\nType: ${args.type || 'SCRIPT'}\nRun as: ${args.runAs || 'system'}\nParameters: ${args.parameters || 'none'}`);
          }
          return this.result(await this.api.runDeviceScript(args.deviceId, {
            type: args.type || 'SCRIPT',
            id: args.scriptId,
            runAs: args.runAs || 'system',
            parameters: args.parameters
          }));
        }
        case 'get_script_result':
          return this.result(await this.api.getScriptResult(args.deviceId, args.activityId));

        // ── Phase 4: Policy management ──
        case 'get_policy':
          return this.result(await this.api.getPolicy(args.policyId));
        case 'assign_device_policy': {
          if (!args.confirm) {
            const device = await this.api.getDevice(args.deviceId);
            return this.dryRun(`Would assign policy id=${args.policyId} to device id=${args.deviceId} (${device.systemName || device.displayName || 'unknown'}).`);
          }
          return this.result(await this.api.assignDevicePolicy(args.deviceId, args.policyId));
        }

        // ── Phase 4: Device approval ──
        case 'get_pending_devices':
          return this.result(await this.api.getPendingDevices());

        case 'device_filter_help':
          return this.result(
`NinjaOne Device Filter (df) Syntax

The df parameter uses NinjaOne Device Filter expressions.
Do not use API property names such as:

- organizationId
- deviceId
- systemName

Instead use NinjaOne filter keywords.

Common mappings:

Organization -> organization
Device -> id
Online devices -> online
Offline devices -> offline
Status -> status

Examples:

organization = 123

organization = 123 and offline

organization in (123,456,789)

id = 4711

Agent behavior:

When the user specifies an organization name:

1. Call get_organizations
2. Resolve the organization name to an organization ID
3. Build a df filter using organization = <id>

Never use:

organizationId = 123
deviceId = 4711

Always use official NinjaOne Device Filter syntax.`
          );

        // ── Phase 5: High-level script execution & job tracking ──
        case 'execute_script': {
          const deviceId = args.device_id;
          const scriptName = args.script;
          const runAs = args.run_as || 'system';
          const parameters = args.parameters || '';

          // Step 1: Resolve script name → ID
          const resolution = await this.api.findScriptByName(scriptName);
          if (!resolution.found) {
            if (resolution.candidates && resolution.candidates.length > 0) {
              return this.result({
                resolved: false,
                note: resolution.note,
                candidates: resolution.candidates
              });
            }
            return this.result({ resolved: false, note: resolution.note });
          }
          const script = resolution.script;

          // Dry run
          if (!args.confirm) {
            const device = await this.api.getDevice(deviceId);
            return this.dryRun(
              `Would execute script "${script.name}" (id=${script.id}) on device id=${deviceId} (${device.systemName || device.displayName || 'unknown'}).\n` +
              `Run as: ${runAs}\n` +
              `Parameters: ${parameters || 'none'}\n` +
              `Language: ${script.language || 'unknown'}\n` +
              `OS: ${script.operatingSystem || 'unknown'}`
            );
          }

          // Step 2: Execute with tracking
          const device = await this.api.getDevice(deviceId);
          const jobSnapshot = await this.api.getDeviceJobs(deviceId).catch(() => null);
          const existingJobIds = new Set(
            (jobSnapshot?.jobs || jobSnapshot?.results || []).map((j: any) => j.id || j.jobId)
          );

          const runResult = await this.api.runDeviceScript(deviceId, {
            type: 'SCRIPT',
            id: script.id,
            runAs,
            parameters
          });

          // Step 3: Correlate new job (diff from before-execution snapshot)
          const afterJobs = await this.api.getDeviceJobs(deviceId).catch(() => null);
          const afterJobList = afterJobs?.jobs || afterJobs?.results || [];
          const newJobs = afterJobList.filter((j: any) => {
            const jid = j.id || j.jobId;
            return jid && !existingJobIds.has(jid);
          });

          // Step 4: Track if we have an activity ID
          const activityId = runResult?.activityId || runResult?.id || runResult?.activity?.id;
          let tracking: any = null;
          if (activityId) {
            const timeoutMs = parseInt(process.env.SCRIPT_POLL_TIMEOUT_MS || '120000', 10);
            tracking = await this.api.waitForScriptResult(deviceId, activityId, { timeoutMs, pollIntervalMs: 3000 });
          }

          return this.result({
            accepted: true,
            script: script.name,
            scriptId: script.id,
            deviceId,
            deviceName: device.systemName || device.displayName || 'unknown',
            runAs,
            parameters: parameters || undefined,
            activityId: activityId || undefined,
            jobCorrelation: {
              beforeCount: existingJobIds.size,
              afterCount: afterJobList.length,
              newJobsDetected: newJobs.length,
              newJobs: newJobs.slice(0, 5).map((j: any) => ({
                id: j.id || j.jobId,
                name: j.name || j.description,
                status: j.status
              }))
            },
            trackingResult: tracking || { note: 'No activity ID returned; tracking unavailable.' }
          });
        }
        case 'get_active_jobs':
          return this.result(await this.api.getDeviceJobs(args.deviceId));
        case 'get_device_scripting_options':
          return this.result(await this.api.getDeviceScriptingOptions(args.deviceId));

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error) {
      if (error instanceof McpError) throw error;
      throw new McpError(
        ErrorCode.InternalError,
        `API call failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async searchDevicesByName(searchName: string, limit: number) {
    const devices = await this.api.getDevices(undefined, 200);
    const filtered = devices
      .filter((device: any) =>
        device.systemName?.toLowerCase().includes(searchName.toLowerCase()) ||
        device.displayName?.toLowerCase().includes(searchName.toLowerCase())
      )
      .slice(0, limit)
      .map((d: any) => ({
        id: d.id,
        systemName: d.systemName,
        displayName: d.displayName,
        nodeClass: d.nodeClass,
        offline: d.offline,
        organizationId: d.organizationId,
        lastContact: d.lastContact
      }));

    return {
      searchTerm: searchName,
      totalFound: filtered.length,
      devices: filtered
    };
  }

  private async findWindows11Devices(limit: number) {
    // Use the OS query endpoint to find Windows 11 in one call instead of N+1 device lookups
    const osData = await this.api.queryOperatingSystems(undefined, undefined, 500);
    const results: any[] = osData?.results || [];
    const windows11Devices = results
      .filter((r: any) => r.name?.includes('Windows 11'))
      .slice(0, limit)
      .map((r: any) => ({
        deviceId: r.deviceId,
        name: r.name,
        buildNumber: r.buildNumber,
        releaseId: r.releaseId,
        architecture: r.architecture,
        lastReboot: r.lastReboot
      }));

    return {
      totalFound: windows11Devices.length,
      devices: windows11Devices
    };
  }

  async runStdio() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('NinjaONE MCP server running on STDIO transport');
  }

  async runHttp(port = 3000) {
    await createHttpServer(this.server, port);
    console.error(`NinjaONE MCP server running on HTTP transport at port ${port}`);
  }

  async runSse(port = 3001) {
    await createSseServer(this.server, port);
    console.error(`NinjaONE MCP server running on SSE transport at port ${port}`);
  }
}

/**
 * Main entry point with transport selection
 */
async function main() {
  const mode = process.env.MCP_MODE || 'stdio';
  const server = new NinjaOneMCPServer();

  try {
    switch (mode.toLowerCase()) {
      case 'http':
        const httpPort = parseInt(process.env.HTTP_PORT || '3000', 10);
        await server.runHttp(httpPort);
        break;
      case 'sse':
        const ssePort = parseInt(process.env.SSE_PORT || '3001', 10);
        await server.runSse(ssePort);
        break;
      case 'stdio':
      default:
        await server.runStdio();
        break;
    }
  } catch (error) {
    console.error('Server startup failed:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.error('Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

// Start the server
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
