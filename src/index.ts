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
    description: 'Reboot a device with normal or forced mode',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Device ID' },
        mode: { type: 'string', enum: ['NORMAL', 'FORCED'], description: 'Reboot mode' }
      },
      required: ['id', 'mode']
    }
  },
  {
    name: 'set_device_maintenance',
    description: 'Set maintenance mode for a device, including temporary or permanent windows',
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
        }
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
        since: { type: 'string', description: 'ISO timestamp for alerts since' }
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
        pageSize: { type: 'number', description: 'Number of results per page' }
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
    description: 'Apply OS patches on a device',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Device ID' },
        patches: { type: 'array', items: { type: 'object' }, description: 'List of OS patches to apply' }
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
    description: 'Apply software patches on a device',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Device ID' },
        patches: { type: 'array', items: { type: 'object' }, description: 'List of software patches to apply' }
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
        installerType: { type: 'string', description: 'Installer type (e.g., WINDOWS, MAC, LINUX)' },
        organizationId: { type: 'number', description: 'Organization ID (optional if implied by auth)' },
        locationId: { type: 'number', description: 'Location ID (optional)' }
      },
      required: ['installerType']
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
    description: 'Reset/acknowledge an alert by UID',
    inputSchema: {
      type: 'object',
      properties: { uid: { type: 'string', description: 'Alert UID' } },
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
    description: 'Approve or deny multiple devices',
    inputSchema: { type: 'object', properties: { mode: { type: 'string', description: 'e.g., APPROVE or DENY' }, deviceIds: { type: 'array', items: { type: 'number' } } }, required: ['mode', 'deviceIds'] }
  },
  {
    name: 'get_device_policy_overrides',
    description: 'Get policy overrides for a device',
    inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] }
  },
  {
    name: 'reset_device_policy_overrides',
    description: 'Reset/remove all policy overrides for a device',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Device ID' }
      },
      required: ['id']
    }
  },
  {
    name: 'get_policies',
    description: 'List policies (optionally templates only)',
    inputSchema: { type: 'object', properties: { templateOnly: { type: 'boolean' } } }
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
  {
    name: 'query_backup_jobs',
    description: 'Query backup jobs with optional status/plan filters',
    inputSchema: {
      type: 'object',
      properties: {
        df: { type: 'string' },
        cursor: { type: 'string' },
        pageSize: { type: 'number' },
        status: { type: 'string', description: 'Optional job status filter (e.g. SUCCESS, FAILED)' },
        planType: { type: 'string', description: 'Optional backup plan type filter' }
      }
    }
  },
  {
    name: 'query_backup_integrity',
    description: 'Query backup integrity check results',
    inputSchema: {
      type: 'object',
      properties: {
        df: { type: 'string' },
        cursor: { type: 'string' },
        pageSize: { type: 'number' }
      }
    }
  },

  // Auth tools (authorization_code flow)
  {
    name: 'ninja_auth_status',
    description: 'Show active auth mode, token status, tenant base URL, and refresh-token availability',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'ninja_auth_login',
    description: 'Start an authorization_code OAuth login (opens browser via loopback; falls back to manual paste).',
    inputSchema: {
      type: 'object',
      properties: {
        manual: {
          type: 'boolean',
          description: 'If true, skip loopback and only return the authorize URL for manual paste.'
        }
      }
    }
  },
  {
    name: 'ninja_auth_paste_redirect',
    description: 'Complete an in-progress authorization_code login by pasting the full redirect URL (with ?code=&state=).',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full redirect URL returned by the NinjaOne authorize endpoint' }
      },
      required: ['url']
    }
  },
  {
    name: 'ninja_auth_logout',
    description: 'Clear stored access and refresh tokens for the authorization_code flow.',
    inputSchema: { type: 'object', properties: {} }
  },

  // Ticketing
  {
    name: 'get_tickets',
    description: 'List tickets using the NinjaOne ticket filter API',
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Ticket filter expression' },
        pageSize: { type: 'number' },
        cursor: { type: 'string' },
        sortBy: { type: 'string' }
      }
    }
  },
  {
    name: 'get_ticket',
    description: 'Get a single ticket by ID',
    inputSchema: { type: 'object', properties: { ticketId: { type: 'number' } }, required: ['ticketId'] }
  },
  {
    name: 'create_ticket',
    description: 'Create a new ticket. Payload fields depend on tenant ticket form (subject, description, priority, clientId, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        payload: { type: 'object', description: 'Ticket creation payload as per NinjaOne Ticketing API', additionalProperties: true }
      },
      required: ['payload']
    }
  },
  {
    name: 'update_ticket',
    description: 'Update an existing ticket',
    inputSchema: {
      type: 'object',
      properties: {
        ticketId: { type: 'number' },
        payload: { type: 'object', additionalProperties: true }
      },
      required: ['ticketId', 'payload']
    }
  },
  {
    name: 'get_ticket_log_entries',
    description: 'Retrieve log entries (comments/activity) for a ticket',
    inputSchema: { type: 'object', properties: { ticketId: { type: 'number' } }, required: ['ticketId'] }
  },
  {
    name: 'add_ticket_log_entry',
    description: 'Add a log entry (comment/public or internal) to a ticket',
    inputSchema: {
      type: 'object',
      properties: {
        ticketId: { type: 'number' },
        payload: { type: 'object', additionalProperties: true, description: 'Log entry payload (body, type, publicEntry, etc.)' }
      },
      required: ['ticketId', 'payload']
    }
  },
  {
    name: 'get_ticketing_attributes',
    description: 'Get ticket attribute metadata (statuses, priorities, custom fields)',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_ticketing_contacts',
    description: 'List ticketing contacts',
    inputSchema: {
      type: 'object',
      properties: {
        pageSize: { type: 'number' },
        cursor: { type: 'string' },
        searchCriteria: { type: 'string' }
      }
    }
  },

  // Scripts (authorization_code required)
  {
    name: 'get_device_scripting_options',
    description: 'List scripts/actions available to run on a device (requires authorization_code flow)',
    inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] }
  },
  {
    name: 'run_device_script',
    description: 'Run a script on a device (requires authorization_code flow). Payload: { type, uid|id, parameters?, runAs? }.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        payload: { type: 'object', additionalProperties: true }
      },
      required: ['id', 'payload']
    }
  },
  {
    name: 'get_job_status',
    description: 'Get status of a script/job by UID',
    inputSchema: { type: 'object', properties: { jobUid: { type: 'string' } }, required: ['jobUid'] }
  },

  // Documentation
  {
    name: 'get_document_templates',
    description: 'List NinjaOne Documentation templates',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_document_template',
    description: 'Get a specific documentation template',
    inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] }
  },
  {
    name: 'create_document_template',
    description: 'Create a documentation template',
    inputSchema: {
      type: 'object',
      properties: { payload: { type: 'object', additionalProperties: true } },
      required: ['payload']
    }
  },
  {
    name: 'update_document_template',
    description: 'Update a documentation template',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        payload: { type: 'object', additionalProperties: true }
      },
      required: ['id', 'payload']
    }
  },
  {
    name: 'get_organization_documents',
    description: 'List NinjaOne Documentation documents scoped to an organization',
    inputSchema: { type: 'object', properties: { organizationId: { type: 'number' } }, required: ['organizationId'] }
  },
  {
    name: 'create_organization_document',
    description: 'Create a documentation document under an organization',
    inputSchema: {
      type: 'object',
      properties: {
        organizationId: { type: 'number' },
        payload: { type: 'object', additionalProperties: true }
      },
      required: ['organizationId', 'payload']
    }
  },
  {
    name: 'update_organization_document',
    description: 'Update a documentation document under an organization',
    inputSchema: {
      type: 'object',
      properties: {
        organizationId: { type: 'number' },
        documentId: { type: 'number' },
        payload: { type: 'object', additionalProperties: true }
      },
      required: ['organizationId', 'documentId', 'payload']
    }
  },

  // Device custom fields
  {
    name: 'get_device_custom_fields',
    description: 'Retrieve custom field values for a device',
    inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] }
  },
  {
    name: 'update_device_custom_fields',
    description: 'Update custom field values for a device (object of { fieldName: value })',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        fields: { type: 'object', additionalProperties: true }
      },
      required: ['id', 'fields']
    }
  },

  // Webhooks
  {
    name: 'set_webhook',
    description: 'Create or update the tenant webhook configuration',
    inputSchema: {
      type: 'object',
      properties: { payload: { type: 'object', additionalProperties: true } },
      required: ['payload']
    }
  },
  {
    name: 'delete_webhook',
    description: 'Remove the tenant webhook configuration',
    inputSchema: { type: 'object', properties: {} }
  },

  // Attachments
  {
    name: 'get_attachment',
    description: 'Fetch an attachment by ID. Returns base64-encoded bytes plus content-type and size.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
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
          version: '1.3.0',
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

  private async routeToolCall(name: string, args: any) {
    try {
      let data: any;
      switch (name) {
        // Organization CRUD
        // Delete operations are intentionally omitted because the public API
        // does not expose endpoints for removing organizations or locations.
        case 'create_organization':
          data = await this.api.createOrganization(
            args.name,
            args.description,
            args.nodeApprovalMode,
            args.tags
          );
          break;
        case 'update_organization':
          data = await this.api.updateOrganization(
            args.id,
            args.name,
            args.description,
            undefined,
            args.tags
          );
          break;
        // Location CRUD
        case 'create_location':
          data = await this.api.createLocation(
            args.organizationId,
            args.name,
            args.address,
            args.description
          );
          break;
        case 'update_location':
          data = await this.api.updateLocation(
            args.organizationId,
            args.locationId,
            args.name,
            args.address,
            args.description
          );
          break;
        case 'get_device_software':
          // Returns installed software inventory for the target device using the REST API helper.
          data = await this.api.getDeviceSoftware(args.id);
          break;
        default:
          data = await this.callAPIMethod(name, args);
          break;
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(data, null, 2)
        }]
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError, 
        `API call failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async callAPIMethod(name: string, args: any) {
    switch (name) {
      // Device Management
      case 'get_devices':
        return this.api.getDevices(args.df, args.pageSize || 50, args.after);
      case 'get_device':
        return this.api.getDevice(args.id);
      case 'get_device_dashboard_url':
        return this.api.getDeviceDashboardUrl(args.id);
      case 'reboot_device':
        return this.api.rebootDevice(args.id, args.mode);
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
            throw new McpError(
              ErrorCode.InvalidParams,
              'Duration details are required when enabling maintenance mode'
            );
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
            durationSelection = {
              permanent: false,
              value,
              unit: unit as MaintenanceUnit,
              seconds
            };
          }
        }

        return this.api.setDeviceMaintenance(args.id, args.mode, durationSelection);
      }
      case 'get_organizations':
        return this.api.getOrganizations(args.pageSize, args.after);
      case 'get_organization':
        return this.api.getOrganization(args.id);
      case 'get_organization_locations':
        return this.api.getOrganizationLocations(args.id);
      case 'get_organization_policies':
        return this.api.getOrganizationPolicies(args.id);
      case 'generate_organization_installer':
        return this.api.generateOrganizationInstaller(args.installerType, args.locationId, args.organizationId);
      case 'get_alerts':
        return this.api.getAlerts(undefined, args.since);
      case 'get_alert':
        return this.api.getAlert(args.uid);
      case 'reset_alert':
        return this.api.resetAlert(args.uid);
      case 'get_device_alerts':
        return this.api.getDeviceAlerts(args.id, args.lang);
      case 'get_device_activities':
        return this.api.getDeviceActivities(args.id, args.pageSize);
      case 'get_device_software':
        if (typeof args.id !== 'number') {
          throw new McpError(ErrorCode.InvalidParams, 'Device ID must be a number');
        }
        return this.api.getDeviceSoftware(args.id);
      case 'search_devices_by_name':
        return this.searchDevicesByName(args.name, args.limit || 10);
      case 'find_windows11_devices':
        return this.findWindows11Devices(args.limit || 20);

      // Region utilities
      case 'list_regions':
        return this.api.listRegions();
      case 'set_region':
        if (args.baseUrl) this.api.setBaseUrl(args.baseUrl);
        else if (args.region) this.api.setRegion(args.region);
        else throw new McpError(ErrorCode.InvalidParams, 'Provide either region or baseUrl');
        return { ok: true, baseUrl: (this as any).api['baseUrl'] };

      // Device Control
      case 'control_windows_service':
        return this.api.controlWindowsService(args.id, args.serviceId, args.action);
      case 'configure_windows_service':
        return this.api.configureWindowsService(args.id, args.serviceId, args.startupType);

      // Device Patching
      case 'scan_device_os_patches':
        return this.api.scanDeviceOSPatches(args.id);
      case 'apply_device_os_patches':
        return this.api.applyDeviceOSPatches(args.id, args.patches);
      case 'scan_device_software_patches':
        return this.api.scanDeviceSoftwarePatches(args.id);
      case 'apply_device_software_patches':
        return this.api.applyDeviceSoftwarePatches(args.id, args.patches);

      // System Information Queries
      case 'query_antivirus_status':
        return this.api.queryAntivirusStatus(args.df, args.cursor, args.pageSize || 50);
      case 'query_antivirus_threats':
        return this.api.queryAntivirusThreats(args.df, args.cursor, args.pageSize || 50);
      case 'query_computer_systems':
        return this.api.queryComputerSystems(args.df, args.cursor, args.pageSize || 50);
      case 'query_device_health':
        return this.api.queryDeviceHealth(args.df, args.cursor, args.pageSize || 50);
      case 'query_operating_systems':
        return this.api.queryOperatingSystems(args.df, args.cursor, args.pageSize || 50);
      case 'query_logged_on_users':
        return this.api.queryLoggedOnUsers(args.df, args.cursor, args.pageSize || 50);
      
      // Hardware Queries
      case 'query_processors':
        return this.api.queryProcessors(args.df, args.cursor, args.pageSize || 50);
      case 'query_disks':
        return this.api.queryDisks(args.df, args.cursor, args.pageSize || 50);
      case 'query_volumes':
        return this.api.queryVolumes(args.df, args.cursor, args.pageSize || 50);
      case 'query_network_interfaces':
        return this.api.queryNetworkInterfaces(args.df, args.cursor, args.pageSize || 50);
      case 'query_raid_controllers':
        return this.api.queryRaidControllers(args.df, args.cursor, args.pageSize || 50);
      case 'query_raid_drives':
        return this.api.queryRaidDrives(args.df, args.cursor, args.pageSize || 50);
      
      // Software and Patches
      case 'query_software':
        return this.api.querySoftware(args.df, args.cursor, args.pageSize || 50);
      case 'query_os_patches':
        return this.api.queryOSPatches(args.df, args.cursor, args.pageSize || 50);
      case 'query_software_patches':
        return this.api.querySoftwarePatches(args.df, args.cursor, args.pageSize || 50);
      case 'query_os_patch_installs':
        return this.api.queryOSPatchInstalls(args.df, args.cursor, args.pageSize || 50);
      case 'query_software_patch_installs':
        return this.api.querySoftwarePatchInstalls(args.df, args.cursor, args.pageSize || 50);
      case 'query_windows_services':
        return this.api.queryWindowsServices(args.df, args.cursor, args.pageSize || 50);
      
      // Custom Fields and Policies
      case 'query_custom_fields':
        return this.api.queryCustomFields(args.df, args.cursor, args.pageSize || 50);
      case 'query_custom_fields_detailed':
        return this.api.queryCustomFieldsDetailed(args.df, args.cursor, args.pageSize || 50);
      case 'query_scoped_custom_fields':
        return this.api.queryScopedCustomFields(args.df, args.cursor, args.pageSize || 50);
      case 'query_scoped_custom_fields_detailed':
        return this.api.queryScopedCustomFieldsDetailed(args.df, args.cursor, args.pageSize || 50);
      case 'query_policy_overrides':
        return this.api.queryPolicyOverrides(args.df, args.cursor, args.pageSize || 50);

      // Backup
      case 'query_backup_usage':
        return this.api.queryBackupUsage(args.df, args.cursor, args.pageSize || 50);

      // Users & Roles
      case 'get_end_users':
        return this.api.getEndUsers();
      case 'get_end_user':
        return this.api.getEndUser(args.id);
      case 'create_end_user':
        return this.api.createEndUser(
          {
            firstName: args.firstName,
            lastName: args.lastName,
            email: args.email,
            phone: args.phone,
            organizationId: args.organizationId,
            fullPortalAccess: args.fullPortalAccess
          },
          args.sendInvitation
        );
      case 'update_end_user':
        return this.api.updateEndUser(
          args.id,
          args.firstName,
          args.lastName,
          args.email,
          args.phone
        );
      case 'delete_end_user':
        return this.api.deleteEndUser(args.id);
      case 'get_technicians':
        return this.api.getTechnicians();
      case 'get_technician':
        return this.api.getTechnician(args.id);
      case 'add_role_members':
        return this.api.addRoleMembers(args.roleId, args.userIds);
      case 'remove_role_members':
        return this.api.removeRoleMembers(args.roleId, args.userIds);

      // Contacts
      case 'get_contacts':
        return this.api.getContacts();
      case 'get_contact':
        return this.api.getContact(args.id);
      case 'create_contact':
        return this.api.createContact(args.organizationId, args.firstName, args.lastName, args.email, args.phone, args.jobTitle);
      case 'update_contact':
        return this.api.updateContact(args.id, args.firstName, args.lastName, args.email, args.phone, args.jobTitle);
      case 'delete_contact':
        return this.api.deleteContact(args.id);

      // Device approvals and policy
      case 'approve_devices':
        return this.api.approveDevices(args.mode, args.deviceIds);
      case 'get_device_policy_overrides':
        return this.api.getDevicePolicyOverrides(args.id);
      case 'reset_device_policy_overrides':
        return this.api.resetDevicePolicyOverrides(args.id);
      case 'get_policies':
        return this.api.getPolicies(args.templateOnly);

      // Backup (new)
      case 'query_backup_jobs':
        return this.api.queryBackupJobs(args.df, args.cursor, args.pageSize, args.status, args.planType);
      case 'query_backup_integrity':
        return this.api.queryBackupIntegrityChecks(args.df, args.cursor, args.pageSize);

      // Auth
      case 'ninja_auth_status':
        return this.api.getAuthStatus();
      case 'ninja_auth_login':
        return this.api.startLogin(args.manual !== true);
      case 'ninja_auth_paste_redirect': {
        if (typeof args.url !== 'string' || !args.url) {
          throw new McpError(ErrorCode.InvalidParams, 'url is required');
        }
        await this.api.completeLoginFromRedirect(args.url);
        return { success: true, message: 'Login completed and tokens stored.' };
      }
      case 'ninja_auth_logout':
        await this.api.logout();
        return { success: true, message: 'Tokens cleared.' };

      // Ticketing
      case 'get_tickets':
        return this.api.getTickets(args.filter, args.pageSize, args.cursor, args.sortBy);
      case 'get_ticket':
        return this.api.getTicket(args.ticketId);
      case 'create_ticket':
        return this.api.createTicket(args.payload);
      case 'update_ticket':
        return this.api.updateTicket(args.ticketId, args.payload);
      case 'get_ticket_log_entries':
        return this.api.getTicketLogEntries(args.ticketId);
      case 'add_ticket_log_entry':
        return this.api.addTicketLogEntry(args.ticketId, args.payload);
      case 'get_ticketing_attributes':
        return this.api.getTicketingAttributes();
      case 'get_ticketing_contacts':
        return this.api.getTicketingContacts(args.pageSize, args.cursor, args.searchCriteria);

      // Scripts
      case 'get_device_scripting_options':
        return this.api.getDeviceScriptingOptions(args.id);
      case 'run_device_script':
        return this.api.runDeviceScript(args.id, args.payload);
      case 'get_job_status':
        return this.api.getJobStatus(args.jobUid);

      // Documentation
      case 'get_document_templates':
        return this.api.getDocumentTemplates();
      case 'get_document_template':
        return this.api.getDocumentTemplate(args.id);
      case 'create_document_template':
        return this.api.createDocumentTemplate(args.payload);
      case 'update_document_template':
        return this.api.updateDocumentTemplate(args.id, args.payload);
      case 'get_organization_documents':
        return this.api.getOrganizationDocuments(args.organizationId);
      case 'create_organization_document':
        return this.api.createOrganizationDocument(args.organizationId, args.payload);
      case 'update_organization_document':
        return this.api.updateOrganizationDocument(args.organizationId, args.documentId, args.payload);

      // Device custom fields
      case 'get_device_custom_fields':
        return this.api.getDeviceCustomFields(args.id);
      case 'update_device_custom_fields':
        return this.api.updateDeviceCustomFields(args.id, args.fields);

      // Webhooks
      case 'set_webhook':
        return this.api.setWebhook(args.payload);
      case 'delete_webhook':
        return this.api.deleteWebhook();

      // Attachments
      case 'get_attachment':
        return this.api.getAttachment(args.id);

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  }

  private async searchDevicesByName(searchName: string, limit: number) {
    const devices = await this.api.getDevices(undefined, 200);
    const filtered = devices
      .filter((device: any) => 
        device.systemName?.toLowerCase().includes(searchName.toLowerCase()) ||
        device.displayName?.toLowerCase().includes(searchName.toLowerCase())
      )
      .slice(0, limit);
    
    return {
      searchTerm: searchName,
      totalFound: filtered.length,
      devices: filtered
    };
  }

  private async findWindows11Devices(limit: number) {
    const devices = await this.api.getDevices(undefined, 200);
    const windowsDevices = devices.filter((device: any) => 
      device.nodeClass === 'WINDOWS_WORKSTATION' || device.nodeClass === 'WINDOWS_SERVER'
    );

    const windows11Devices = [];
    for (const device of windowsDevices.slice(0, 50)) {
      try {
        const details = await this.api.getDevice(device.id);
        if (details.os?.name?.includes('Windows 11')) {
          windows11Devices.push({
            id: device.id,
            systemName: device.systemName,
            displayName: device.displayName,
            offline: device.offline,
            osName: details.os.name,
            buildNumber: details.os.buildNumber,
            releaseId: details.os.releaseId,
            manufacturer: details.system?.manufacturer,
            model: details.system?.model
          });
          
          if (windows11Devices.length >= limit) break;
        }
      } catch (error) {
        continue;
      }
    }

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
