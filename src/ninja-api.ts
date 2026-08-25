import { UserOAuth } from './oauth-user.js';

type CreateEndUserPayload = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  organizationId?: number;
  fullPortalAccess?: boolean;
};

export type MaintenanceUnit = 'MINUTES' | 'HOURS' | 'DAYS' | 'WEEKS';
export type MaintenanceWindowSelection =
  | { permanent: true }
  | { permanent: false; value: number; unit: MaintenanceUnit; seconds: number };

export class NinjaOneAPI {
  private baseUrl: string | null = null;
  private clientId: string;
  private clientSecret: string;
  private accessToken: string | null = null;
  private tokenExpiry: number | null = null;
  private isConfigured: boolean;
  private baseUrlExplicit: boolean = false;
  private userOAuth: UserOAuth | null = null;
  private userAuthChecked: boolean = false;

  private static readonly REGION_MAP: Record<string, string> = {
    us: 'https://app.ninjarmm.com',
    us2: 'https://us2.ninjarmm.com',
    eu: 'https://eu.ninjarmm.com',
    ca: 'https://ca.ninjarmm.com',
    oc: 'https://oc.ninjarmm.com',
  };

  private static readonly DEFAULT_CANDIDATES: string[] = [
    'https://app.ninjarmm.com',
    'https://us2.ninjarmm.com',
    'https://eu.ninjarmm.com',
    'https://ca.ninjarmm.com',
    'https://oc.ninjarmm.com',
  ];

  constructor() {
    const envBase = process.env.NINJA_BASE_URL;
    const envRegion = (process.env.NINJA_REGION || '').toLowerCase();

    if (envBase) {
      this.baseUrl = this.normalizeBaseUrl(envBase);
      this.baseUrlExplicit = true;
    } else if (envRegion && NinjaOneAPI.REGION_MAP[envRegion]) {
      this.baseUrl = NinjaOneAPI.REGION_MAP[envRegion];
      this.baseUrlExplicit = true;
    } else {
      this.baseUrl = null;
    }
    this.clientId = process.env.NINJA_CLIENT_ID || '';
    this.clientSecret = process.env.NINJA_CLIENT_SECRET || '';
    this.isConfigured = !!(this.clientId && this.clientSecret);

    if (!this.isConfigured) {
      console.error('WARNING: NINJA_CLIENT_ID and NINJA_CLIENT_SECRET not set - API calls will fail until configured');
    } else {
      console.error('NinjaONE API initialized successfully');
    }
  }

  private async getAccessToken(): Promise<string> {
    if (!this.isConfigured) {
      throw new Error('NinjaONE API not configured - NINJA_CLIENT_ID and NINJA_CLIENT_SECRET required');
    }

    if (this.accessToken && this.tokenExpiry && Date.now() < (this.tokenExpiry - 300000)) {
      return this.accessToken;
    }

    if (!this.baseUrl || !this.baseUrlExplicit) {
      const tried: string[] = [];
      const candidates = this.getCandidateBaseUrls();
      for (const candidate of candidates) {
        tried.push(candidate);
        try {
          const token = await this.requestToken(candidate);
          this.baseUrl = candidate;
          this.baseUrlExplicit = true;
          this.accessToken = token.access_token;
          this.tokenExpiry = Date.now() + (token.expires_in * 1000);
          console.error(`OAuth token acquired successfully (region: ${candidate})`);
          return this.accessToken!;
        } catch (e) {
          // try next
        }
      }
      throw new Error(`Failed to acquire OAuth token: no candidate base URL succeeded. Tried: ${tried.join(', ')}`);
    }

    const token = await this.requestToken(this.baseUrl);
    this.accessToken = token.access_token;
    this.tokenExpiry = Date.now() + (token.expires_in * 1000);
    console.error('OAuth token acquired successfully');
    return this.accessToken!;
  }

  private async requestToken(baseUrl: string): Promise<{ access_token: string; expires_in: number }> {
    const tokenUrl = `${baseUrl}/ws/oauth/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: 'monitoring management control'
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new Error(`OAuth token request failed: ${response.status} ${response.statusText}`);
    }
    return await response.json();
  }

  private normalizeBaseUrl(url: string): string {
    if (!/^https?:\/\//i.test(url)) {
      return `https://${url}`;
    }
    return url;
  }

  private getCandidateBaseUrls(): string[] {
    const fromEnv = (process.env.NINJA_BASE_URLS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(u => this.normalizeBaseUrl(u));
    return (fromEnv.length > 0 ? fromEnv : NinjaOneAPI.DEFAULT_CANDIDATES);
  }

  private async getBearerToken(): Promise<string> {
    // Prefer user-context token (authorization_code) when the user has run the auth CLI.
    // Falls back to client_credentials for unauthenticated reads.
    if (!this.userAuthChecked) {
      this.userAuthChecked = true;
      if (this.isConfigured) {
        const candidate = new UserOAuth(this.clientId, this.clientSecret);
        if (await candidate.isAvailable()) {
          this.userOAuth = candidate;
        }
      }
    }
    if (this.userOAuth) {
      try {
        return await this.userOAuth.getAccessToken();
      } catch (e: any) {
        console.error('User-context token refresh failed, falling back to client_credentials:', e.message);
        this.userOAuth = null;
      }
    }
    return this.getAccessToken();
  }

  private async makeRequest(
    endpoint: string,
    method: string = 'GET',
    body?: any
  ): Promise<any> {
    const token = await this.getBearerToken();
    const base = this.baseUrl || NinjaOneAPI.DEFAULT_CANDIDATES[0];

    const options: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': '*/*'
      }
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      options.headers = {
        ...options.headers,
        'Content-Type': 'application/json'
      };
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${base}${endpoint}`, options);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    if (method === 'DELETE' && response.status === 204) {
      return { success: true };
    }

    const text = await response.text();
    if (!text || text.trim().length === 0) {
      return { success: true };
    }

    try {
      return JSON.parse(text);
    } catch (e) {
      return { success: true };
    }
  }

  // Region utilities
  public listRegions(): { region: string; baseUrl: string }[] {
    return Object.entries(NinjaOneAPI.REGION_MAP).map(([region, baseUrl]) => ({ region, baseUrl }));
  }

  public setRegion(region: string): void {
    const key = (region || '').toLowerCase();
    const mapped = NinjaOneAPI.REGION_MAP[key];
    if (!mapped) throw new Error(`Unknown region: ${region}`);
    this.setBaseUrl(mapped);
  }

  public setBaseUrl(url: string): void {
    this.baseUrl = this.normalizeBaseUrl(url);
    this.baseUrlExplicit = true;
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  private buildQuery(params: Record<string, any>): string {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v !== undefined && query.append(k, v.toString()));
    return query.toString() ? `?${query}` : '';
  }

  private pruneUndefined<T extends Record<string, unknown>>(payload: T): Partial<T> {
    const result: Partial<T> = {};
    (Object.keys(payload) as (keyof T)[]).forEach((key) => {
      const value = payload[key];
      if (value !== undefined) {
        result[key] = value;
      }
    });
    return result;
  }

  private buildUserCollectionPath(type: 'end-users' | 'technicians'): string {
    return `/v2/user/${type}`;
  }

  private buildUserEntityPath(type: 'end-user' | 'technician', id: number): string {
    return `/v2/user/${type}/${id}`;
  }

  // Device Management

  async getDevices(df?: string, pageSize?: number, after?: number): Promise<any> {
    return this.makeRequest(`/v2/devices${this.buildQuery({ df, pageSize, after })}`);
  }

  async getDevice(id: number): Promise<any> {
    // Owner information is available via the assignedOwnerUid field in this response.
    return this.makeRequest(`/v2/device/${id}`);
  }

  async getDeviceDashboardUrl(id: number): Promise<any> {
    return this.makeRequest(`/v2/device/${id}/dashboard-url`);
  }

  async setDeviceMaintenance(
    id: number,
    mode: string,
    duration?: MaintenanceWindowSelection
  ): Promise<any> {
    if (mode === 'OFF') {
      return this.makeRequest(`/v2/device/${id}/maintenance`, 'DELETE');
    }

    if (!duration) {
      throw new Error('Maintenance duration selection is required when enabling maintenance mode');
    }

    // The NinjaOne API expects Unix epoch timestamps expressed in seconds.
    // Schedule maintenance to begin five seconds from "now" to avoid
    // immediately-expired windows due to API processing delays.
    const start = Math.floor((Date.now() + 5000) / 1000);

    // `end` is required by the NinjaOne spec. For "permanent" windows, use a far-future
    // sentinel (2100-01-01) since the API has no notion of an open-ended window.
    const PERMANENT_END = 4102444800;
    const end = duration.permanent ? PERMANENT_END : start + duration.seconds;

    const body: Record<string, unknown> = {
      disabledFeatures: ['ALERTS', 'PATCHING', 'AVSCANS', 'TASKS'],
      start,
      end
    };

    return this.makeRequest(`/v2/device/${id}/maintenance`, 'PUT', body);
  }

  async rebootDevice(id: number, mode: string, reason?: string): Promise<any> {
    const body = {
      reason: reason || 'Reboot requested via API'
    };
    return this.makeRequest(`/v2/device/${id}/reboot/${mode}`, 'POST', body);
  }

  async approveDevices(mode: string, deviceIds: number[]): Promise<any> {
    const body = { devices: deviceIds };
    return this.makeRequest(`/v2/devices/approval/${mode}`, 'POST', body);
  }

  // Device Patches

  // Patch approval or rejection is only available via the NinjaOne dashboard or policies;
  // the public API does not provide endpoints for that workflow.
  async scanDeviceOSPatches(id: number): Promise<any> {
    return this.makeRequest(`/v2/device/${id}/patch/os/scan`, 'POST');
  }

  async applyDeviceOSPatches(id: number, patches: any[]): Promise<any> {
    return this.makeRequest(`/v2/device/${id}/patch/os/apply`, 'POST', { patches });
  }

  async scanDeviceSoftwarePatches(id: number): Promise<any> {
    return this.makeRequest(`/v2/device/${id}/patch/software/scan`, 'POST');
  }

  async applyDeviceSoftwarePatches(id: number, patches: any[]): Promise<any> {
    return this.makeRequest(`/v2/device/${id}/patch/software/apply`, 'POST', { patches });
  }

  // Device Services

  async controlWindowsService(id: number, serviceId: string, action: string): Promise<any> {
    return this.makeRequest(`/v2/device/${id}/windows-service/${serviceId}/control`, 'POST', { action });
  }

  async configureWindowsService(id: number, serviceId: string, startupType: string): Promise<any> {
    return this.makeRequest(`/v2/device/${id}/windows-service/${serviceId}/configure`, 'POST', { startupType });
  }

  // Policy Management

  async getPolicies(templateOnly?: boolean): Promise<any> {
    return this.makeRequest(`/v2/policies${this.buildQuery({ templateOnly })}`);
  }

  async getDevicePolicyOverrides(id: number): Promise<any> {
    return this.makeRequest(`/v2/device/${id}/policy/overrides`);
  }

  async resetDevicePolicyOverrides(id: number): Promise<any> {
    return this.makeRequest(`/v2/device/${id}/policy/overrides`, 'DELETE');
  }

  // Organization Management

  async getOrganizations(pageSize?: number, after?: number): Promise<any> {
    return this.makeRequest(`/v2/organizations${this.buildQuery({ pageSize, after })}`);
  }

  async getOrganization(id: number): Promise<any> {
    return this.makeRequest(`/v2/organization/${id}`);
  }

  async getOrganizationLocations(id: number): Promise<any> {
    return this.makeRequest(`/v2/organization/${id}/locations`);
  }

  async getOrganizationPolicies(id: number): Promise<any> {
    // NinjaOne has no GET /v2/organization/{id}/policies — only PUT exists.
    // Return all policies; the caller can cross-reference with org devices.
    const policies = await this.getPolicies();
    return {
      note: `NinjaOne does not expose per-organization policy assignments via GET. Returning all policies. Use get_device or get_policy to see which policy a specific device or org uses.`,
      organizationId: id,
      policies
    };
  }

  async generateOrganizationInstaller(installerType: string, locationId?: number, organizationId?: number): Promise<any> {
    const body: any = { installerType };
    if (locationId) body.locationId = locationId;
    if (organizationId) body.organizationId = organizationId;
    return this.makeRequest('/v2/organization/generate-installer', 'POST', body);
  }

  // Organization CRUD
  // Note: DELETE operations for organizations and locations are NOT available
  // in the Public API and can only be performed via the NinjaOne dashboard.

  async createOrganization(
    name: string,
    description?: string,
    nodeApprovalMode?: string,
    tags?: string[]
  ): Promise<any> {
    const body: any = { name };
    if (description) body.description = description;
    if (nodeApprovalMode) body.nodeApprovalMode = nodeApprovalMode.toUpperCase();
    if (tags) body.tags = tags;
    return this.makeRequest('/v2/organizations', 'POST', body);
  }

  async updateOrganization(
    id: number,
    name?: string,
    description?: string,
    nodeApprovalMode?: string,  // Note: This field is read-only after creation and cannot be updated
    tags?: string[]
  ): Promise<any> {
    const body: any = {};
    if (name !== undefined) body.name = name;
    if (description !== undefined) body.description = description;
    if (nodeApprovalMode !== undefined) body.nodeApprovalMode = nodeApprovalMode;
    if (tags !== undefined) body.tags = tags;
    return this.makeRequest(`/v2/organization/${id}`, 'PATCH', body);
  }

  // Location CRUD

  async createLocation(
    organizationId: number,
    name: string,
    address?: string,
    description?: string
  ): Promise<any> {
    const body: any = { name };
    if (address) body.address = address;
    if (description) body.description = description;
    return this.makeRequest(`/v2/organization/${organizationId}/locations`, 'POST', body);
  }

  async updateLocation(
    organizationId: number,
    locationId: number,
    name?: string,
    address?: string,
    description?: string
  ): Promise<any> {
    const body: any = {};
    if (name !== undefined) body.name = name;
    if (address !== undefined) body.address = address;
    if (description !== undefined) body.description = description;
    return this.makeRequest(`/v2/organization/${organizationId}/locations/${locationId}`, 'PATCH', body);
  }

  // Contact Management

  async getContacts(): Promise<any> {
    return this.makeRequest('/v2/contacts');
  }

  async getContact(id: number): Promise<any> {
    return this.makeRequest(`/v2/contact/${id}`);
  }

  async createContact(
    organizationId: number,
    firstName: string,
    lastName: string,
    email: string,
    phone?: string,
    jobTitle?: string
  ): Promise<any> {
    const body: any = { organizationId, firstName, lastName, email };
    if (phone) body.phone = phone;
    if (jobTitle) body.jobTitle = jobTitle;
    return this.makeRequest('/v2/contacts', 'POST', body);
  }

  async updateContact(
    id: number,
    firstName?: string,
    lastName?: string,
    email?: string,
    phone?: string,
    jobTitle?: string
  ): Promise<any> {
    const body: any = {};
    if (firstName !== undefined) body.firstName = firstName;
    if (lastName !== undefined) body.lastName = lastName;
    if (email !== undefined) body.email = email;
    if (phone !== undefined) body.phone = phone;
    if (jobTitle !== undefined) body.jobTitle = jobTitle;
    return this.makeRequest(`/v2/contact/${id}`, 'PATCH', body);
  }

  async deleteContact(id: number): Promise<any> {
    return this.makeRequest(`/v2/contact/${id}`, 'DELETE');
  }

  // Alert Management

  async getAlerts(deviceFilter?: string, sourceType?: string, since?: string): Promise<any> {
    return this.makeRequest(`/v2/alerts${this.buildQuery({ df: deviceFilter, sourceType, since })}`);
  }

  async getAlert(uid: string): Promise<any> {
    // GET /v2/alert/{uid} is not supported (returns 405).
    // Fetch the full alert list and find the matching UID client-side.
    const alerts = await this.getAlerts();
    if (Array.isArray(alerts)) {
      const match = alerts.find((a: any) => a.uid === uid);
      if (match) return match;
    }
    return { uid, note: 'Alert not found in active alerts list (may already be resolved).' };
  }

  async resetAlert(uid: string): Promise<any> {
    // DELETE /v2/alert/{uid} is the simpler "reset alert/condition" path — no body required.
    return this.makeRequest(`/v2/alert/${uid}`, 'DELETE');
  }

  async getDeviceAlerts(id: number, lang?: string): Promise<any> {
    return this.makeRequest(`/v2/device/${id}/alerts${this.buildQuery({ lang })}`);
  }

  // User Management

  async getEndUsers(): Promise<any> {
    return this.makeRequest(this.buildUserCollectionPath('end-users'));
  }

  async getEndUser(id: number): Promise<any> {
    return this.makeRequest(this.buildUserEntityPath('end-user', id));
  }

  async createEndUser(payload: CreateEndUserPayload, sendInvitation?: boolean): Promise<any> {
    const body = this.pruneUndefined(payload);
    const query = this.buildQuery({ sendInvitation });
    const endpoint = this.buildUserCollectionPath('end-users');
    return this.makeRequest(`${endpoint}${query}`, 'POST', body);
  }

  async updateEndUser(
    id: number,
    firstName?: string,
    lastName?: string,
    email?: string,
    phone?: string  // Note: Phone field is read-only after creation and cannot be updated
  ): Promise<any> {
    const body: any = {};
    if (firstName !== undefined) body.firstName = firstName;
    if (lastName !== undefined) body.lastName = lastName;
    if (email !== undefined) body.email = email;
    if (phone !== undefined) body.phone = phone;  // This will be ignored by the API
    return this.makeRequest(this.buildUserEntityPath('end-user', id), 'PATCH', body);
  }

  async deleteEndUser(id: number): Promise<any> {
    return this.makeRequest(this.buildUserEntityPath('end-user', id), 'DELETE');
  }

  async getTechnicians(): Promise<any> {
    return this.makeRequest(this.buildUserCollectionPath('technicians'));
  }

  async getTechnician(id: number): Promise<any> {
    return this.makeRequest(this.buildUserEntityPath('technician', id));
  }

  async addRoleMembers(roleId: number, userIds: number[]): Promise<any> {
    return this.makeRequest(`/v2/user/role/${roleId}/add-members`, 'PATCH', userIds);
  }

  async removeRoleMembers(roleId: number, userIds: number[]): Promise<any> {
    return this.makeRequest(`/v2/user/role/${roleId}/remove-members`, 'PATCH', userIds);
  }

  // Auto-paginating query helper.
  // Fetches all pages from a /v2/queries/* endpoint, optionally filtering results
  // client-side by a text match on one or more fields.
  async queryAllFiltered(
    queryPath: string,
    opts?: {
      df?: string;
      filter?: { text: string; fields: string[] };
      maxResults?: number;
    }
  ): Promise<any[]> {
    const maxResults = opts?.maxResults || 50;
    const filterText = opts?.filter?.text?.toLowerCase();
    const filterFields = opts?.filter?.fields || [];
    const collected: any[] = [];
    let cursor: string | undefined;
    const pageSize = 500;

    while (true) {
      const query = this.buildQuery({ df: opts?.df, cursor, pageSize });
      const resp = await this.makeRequest(`${queryPath}${query}`);
      const results: any[] = resp.results || [];

      if (filterText && filterFields.length > 0) {
        for (const item of results) {
          const match = filterFields.some(f => {
            const val = item[f];
            return typeof val === 'string' && val.toLowerCase().includes(filterText);
          });
          if (match) collected.push(item);
          if (collected.length >= maxResults) break;
        }
      } else {
        collected.push(...results);
      }

      if (collected.length >= maxResults) break;
      if (!resp.cursor?.name || results.length < pageSize) break;
      cursor = resp.cursor.name;
    }

    return collected.slice(0, maxResults);
  }

  // Queries - System Information

  async queryAntivirusStatus(df?: string, cursor?: string, pageSize?: number): Promise<any> {
    return this.makeRequest(`/v2/queries/antivirus-status${this.buildQuery({ df, cursor, pageSize })}`);
  }

  async queryAntivirusThreats(df?: string, cursor?: string, pageSize?: number): Promise<any> {
    return this.makeRequest(`/v2/queries/antivirus-threats${this.buildQuery({ df, cursor, pageSize })}`);
  }

  async queryComputerSystems(df?: string, cursor?: string, pageSize?: number): Promise<any> {
    return this.makeRequest(`/v2/queries/computer-systems${this.buildQuery({ df, cursor, pageSize })}`);
  }

  async queryDeviceHealth(df?: string, cursor?: string, pageSize?: number): Promise<any> {
    return this.makeRequest(`/v2/queries/device-health${this.buildQuery({ df, cursor, pageSize })}`);
  }

  async queryOperatingSystems(df?: string, cursor?: string, pageSize?: number): Promise<any> {
    return this.makeRequest(`/v2/queries/operating-systems${this.buildQuery({ df, cursor, pageSize })}`);
  }

  async queryLoggedOnUsers(df?: string, cursor?: string, pageSize?: number): Promise<any> {
    return this.makeRequest(`/v2/queries/logged-on-users${this.buildQuery({ df, cursor, pageSize })}`);
  }

  // Queries - Hardware

  async queryProcessors(df?: string, cursor?: string, pageSize?: number): Promise<any> {
    return this.makeRequest(`/v2/queries/processors${this.buildQuery({ df, cursor, pageSize })}`);
  }

  async queryDisks(df?: string, cursor?: string, pageSize?: number): Promise<any> {
    return this.makeRequest(`/v2/queries/disks${this.buildQuery({ df, cursor, pageSize })}`);
  }

  async queryVolumes(df?: string, cursor?: string, pageSize?: number): Promise<any> {
    return this.makeRequest(`/v2/queries/volumes${this.buildQuery({ df, cursor, pageSize })}`);
  }

  async queryNetworkInterfaces(df?: string, cursor?: string, pageSize?: number): Promise<any> {
    return this.makeRequest(`/v2/queries/network-interfaces${this.buildQuery({ df, cursor, pageSize })}`);
  }

  async queryRaidControllers(df?: string, cursor?: string, pageSize?: number): Promise<any> {
    return this.makeRequest(`/v2/queries/raid-controllers${this.buildQuery({ df, cursor, pageSize })}`);
  }

  async queryRaidDrives(df?: string, cursor?: string, pageSize?: number): Promise<any> {
    return this.makeRequest(`/v2/queries/raid-drives${this.buildQuery({ df, cursor, pageSize })}`);
  }

  // Queries - Software and Patches

  async querySoftware(df?: string, cursor?: string, pageSize?: number): Promise<any> {
    return this.makeRequest(`/v2/queries/software${this.buildQuery({ df, cursor, pageSize })}`);
  }

  async queryOSPatches(df?: string, cursor?: string, pageSize?: number): Promise<any> {
    return this.makeRequest(`/v2/queries/os-patches${this.buildQuery({ df, cursor, pageSize })}`);
  }

  async querySoftwarePatches(df?: string, cursor?: string, pageSize?: number): Promise<any> {
    return this.makeRequest(`/v2/queries/software-patches${this.buildQuery({ df, cursor, pageSize })}`);
  }

  async queryOSPatchInstalls(df?: string, cursor?: string, pageSize?: number): Promise<any> {
    return this.makeRequest(`/v2/queries/os-patch-installs${this.buildQuery({ df, cursor, pageSize })}`);
  }

  async querySoftwarePatchInstalls(df?: string, cursor?: string, pageSize?: number): Promise<any> {
    return this.makeRequest(`/v2/queries/software-patch-installs${this.buildQuery({ df, cursor, pageSize })}`);
  }

  async queryWindowsServices(df?: string, cursor?: string, pageSize?: number): Promise<any> {
    return this.makeRequest(`/v2/queries/windows-services${this.buildQuery({ df, cursor, pageSize })}`);
  }

  // Queries - Custom Fields and Policies

  async queryCustomFields(df?: string, cursor?: string, pageSize?: number): Promise<any> {
    return this.makeRequest(`/v2/queries/custom-fields${this.buildQuery({ df, cursor, pageSize })}`);
  }

  async queryCustomFieldsDetailed(df?: string, cursor?: string, pageSize?: number): Promise<any> {
    return this.makeRequest(`/v2/queries/custom-fields-detailed${this.buildQuery({ df, cursor, pageSize })}`);
  }

  async queryScopedCustomFields(df?: string, cursor?: string, pageSize?: number): Promise<any> {
    return this.makeRequest(`/v2/queries/scoped-custom-fields${this.buildQuery({ df, cursor, pageSize })}`);
  }

  async queryScopedCustomFieldsDetailed(df?: string, cursor?: string, pageSize?: number): Promise<any> {
    return this.makeRequest(`/v2/queries/scoped-custom-fields-detailed${this.buildQuery({ df, cursor, pageSize })}`);
  }

  async queryPolicyOverrides(df?: string, cursor?: string, pageSize?: number): Promise<any> {
    return this.makeRequest(`/v2/queries/policy-overrides${this.buildQuery({ df, cursor, pageSize })}`);
  }

  // Queries - Backup

  async queryBackupUsage(df?: string, cursor?: string, pageSize?: number): Promise<any> {
    try {
      return await this.makeRequest(`/v2/queries/backup/usage${this.buildQuery({ df, cursor, pageSize })}`);
    } catch (e: any) {
      // A server error here typically means the backup module isn't provisioned on the tenant.
      if (e.message?.includes('500')) {
        return { backupModuleAvailable: false, usage: [], note: 'Backup usage is unavailable on this NinjaOne tenant. The backup module may not be provisioned, or the API client may lack access to backup data.' };
      }
      throw e;
    }
  }

  // Activities and Software

  async getDeviceActivities(id: number, pageSize?: number, olderThan?: string, type?: string): Promise<any> {
    return this.makeRequest(`/v2/device/${id}/activities${this.buildQuery({ pageSize, olderThan, type })}`);
  }

  /**
   * Get installed software for a device.
   * @param id - Unique device identifier whose software inventory should be returned.
   * @returns Promise resolving to an array of software objects including name, version, publisher, installDate, and location.
   * @throws Error if the device cannot be found or if the caller is unauthorized to view the inventory.
   */
  async getDeviceSoftware(id: number): Promise<any> {
    return this.makeRequest(`/v2/device/${id}/software`);
  }

  // Phase 2 — Write operations

  async updateDevice(id: number, body: { displayName?: string; userData?: Record<string, string> }): Promise<any> {
    return this.makeRequest(`/v2/device/${id}`, 'PATCH', body);
  }

  async updateDeviceCustomFields(deviceId: number, fields: Record<string, unknown>): Promise<any> {
    return this.makeRequest(`/v2/device/${deviceId}/custom-fields`, 'PATCH', fields);
  }

  async updateOrganizationCustomFields(orgId: number, fields: Record<string, unknown>): Promise<any> {
    return this.makeRequest(`/v2/organization/${orgId}/custom-fields`, 'PATCH', fields);
  }

  // Ticketing

  async getTicketBoards(): Promise<any> {
    return this.makeRequest('/v2/ticketing/trigger/boards');
  }

  async getTicketStatuses(): Promise<any> {
    return this.makeRequest('/v2/ticketing/statuses');
  }

  async getTickets(boardId: number, pageSize?: number, lastCursorId?: number): Promise<any> {
    const body: any = {};
    if (pageSize !== undefined) body.pageSize = pageSize;
    if (lastCursorId !== undefined) body.lastCursorId = lastCursorId;
    return this.makeRequest(`/v2/ticketing/trigger/board/${boardId}/run`, 'POST', body);
  }

  async getTicket(ticketId: number): Promise<any> {
    return this.makeRequest(`/v2/ticketing/ticket/${ticketId}`);
  }

  async getTicketLog(ticketId: number): Promise<any> {
    return this.makeRequest(`/v2/ticketing/ticket/${ticketId}/log-entry`);
  }

  async createTicket(body: {
    clientId?: number;
    ticketFormId?: number;
    nodeId?: number;
    summary: string;
    description?: { public?: boolean; body?: string; htmlBody?: string };
    status?: string;
    priority?: string;
    severity?: string;
    type?: string;
    assignedAppUserId?: number;
    tags?: string[];
  }): Promise<any> {
    return this.makeRequest('/v2/ticketing/ticket', 'POST', body);
  }

  async updateTicket(ticketId: number, ticketFields: {
    version?: number;
    ticketFormId?: number;
    clientId?: number;
    subject?: string;
    summary?: string;
    status?: string;
    priority?: string;
    severity?: string;
    type?: string;
    assignedAppUserId?: number;
    nodeId?: number;
    tags?: string[];
  }, comment?: { public?: boolean; body?: string }): Promise<any> {
    // NinjaOne's PUT requires the full ticket object with a distinct schema from GET:
    //   - status is a string on PUT, an object on GET — use the status `name`
    //   - ccList (GET) → cc (PUT)
    //   - attributeValues (GET) → attributes (PUT)
    //   - id/createTime/deleted/source are GET-only
    const current = await this.getTicket(ticketId);
    const { summary, subject, status, ...rest } = ticketFields;

    const put: any = {
      subject: subject ?? summary ?? current.subject,
      version: current.version,
      status: status ?? (typeof current.status === 'object' ? current.status?.name : current.status),
      priority: current.priority,
      severity: current.severity,
      type: current.type,
      clientId: current.clientId,
      ticketFormId: current.ticketFormId,
      locationId: current.locationId,
      nodeId: current.nodeId,
      assignedAppUserId: current.assignedAppUserId,
      requesterUid: current.requesterUid,
      parentTicketId: current.parentTicketId,
      followupTime: current.followupTime,
      tags: current.tags,
      additionalAssignedTechnicianIds: current.additionalAssignedTechnicianIds,
      cc: current.ccList,
      attributes: current.attributeValues,
      ...rest
    };

    if (comment) put.comment = comment;
    return this.makeRequest(`/v2/ticketing/ticket/${ticketId}`, 'PUT', put);
  }

  async addTicketComment(ticketId: number, comment: string, isPublic: boolean = true): Promise<any> {
    // POST /v2/ticketing/ticket/{id}/comment expects multipart/form-data with a JSON part named "comment"
    // (matches the NinjaOne PowerShell module's implementation). Plain JSON returns a content-type error.
    const token = await this.getBearerToken();
    const base = this.baseUrl || NinjaOneAPI.DEFAULT_CANDIDATES[0];
    const boundary = `----NinjaMCPBoundary${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
    const commentJson = JSON.stringify({ public: isPublic, body: comment });
    const payload =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="comment"\r\n` +
      `Content-Type: application/json\r\n` +
      `\r\n` +
      `${commentJson}\r\n` +
      `--${boundary}--\r\n`;

    const response = await fetch(`${base}/v2/ticketing/ticket/${ticketId}/comment`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': '*/*',
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body: payload
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
    }
    if (response.status === 204) return { success: true };
    const text = await response.text();
    if (!text) return { success: true };
    try { return JSON.parse(text); } catch { return { success: true }; }
  }

  // Phase 3 — Webhooks & event-driven

  async getWebhookConfig(): Promise<any> {
    // NinjaOne API does not support GET for webhook config via client credentials.
    // Attempt the call; if it fails with 405, return an informative message.
    try {
      return await this.makeRequest('/v2/webhook');
    } catch (e: any) {
      if (e.message?.includes('405')) {
        return { note: 'GET /v2/webhook is not supported by the NinjaOne API. Use set_webhook_config to configure or delete_webhook_config to remove.' };
      }
      throw e;
    }
  }

  async setWebhookConfig(body: {
    url: string;
    activities?: Record<string, string[]>;
    expand?: string[];
    headers?: Array<{ name: string; value: string }>;
    organizationIds?: number[];
  }): Promise<any> {
    return this.makeRequest('/v2/webhook', 'PUT', body);
  }

  async deleteWebhookConfig(): Promise<any> {
    return this.makeRequest('/v2/webhook', 'DELETE');
  }

  async getStaleDevices(sinceHours: number): Promise<any> {
    const cutoff = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();
    // NinjaOne df doesn't support last_contact, so filter client-side but keep response lean
    let devices: any;
    try {
      devices = await this.getDevices(undefined, 200);
    } catch (e: any) {
      if (e.message?.includes('500')) {
        return { note: 'Unable to list devices for staleness check (HTTP 500 from /v2/devices). Retry, or narrow by organization via get_devices.' };
      }
      throw e;
    }
    if (!Array.isArray(devices)) return [];
    return devices
      .filter((d: any) => {
        if (!d.lastContact) return true;
        return new Date(d.lastContact).toISOString() < cutoff;
      })
      .map((d: any) => ({
        id: d.id,
        systemName: d.systemName,
        displayName: d.displayName,
        nodeClass: d.nodeClass,
        offline: d.offline,
        lastContact: d.lastContact,
        organizationId: d.organizationId
      }));
  }

  async getDevicesWithPendingPatches(status?: string): Promise<any> {
    const patchStatus = status || 'PENDING';
    return this.queryOSPatches(`status = ${patchStatus}`, undefined, 200);
  }

  async getActivities(params?: {
    pageSize?: number;
    after?: number;
    before?: number;
    olderThan?: number;
    newerThan?: number;
    type?: string;
    df?: string;
    user?: number;
    status?: string;
    seriesUid?: string;
  }): Promise<any> {
    const query = this.buildQuery(params || {});
    return this.makeRequest(`/v2/activities${query}`);
  }

  // Phase 4 — Script execution & policy management

  // 5-minute script list cache (Phase 5)
  private scriptCache: { data: any; ts: number } | null = null;
  private static readonly SCRIPT_CACHE_TTL = 300_000; // 5 minutes

  async listAutomationScripts(): Promise<any> {
    // Canonical endpoint: GET /v2/automation/scripts
    // Returns every Automation Script visible to the authenticated API user.
    if (this.scriptCache && Date.now() - this.scriptCache.ts < NinjaOneAPI.SCRIPT_CACHE_TTL) {
      return this.scriptCache.data;
    }
    const data = await this.makeRequest('/v2/automation/scripts');
    this.scriptCache = { data, ts: Date.now() };
    return data;
  }

  async getAutomations(): Promise<any> {
    // Try canonical endpoint first, then fall back to guessed paths for older tenants.
    try {
      return await this.listAutomationScripts();
    } catch (e: any) {
      if (!e.message?.includes('404') && !e.message?.includes('405')) throw e;
    }
    const paths = [
      '/v2/device-scripting/scripts',
      '/v2/automation/scripting',
      '/v2/scripting/automation'
    ];
    for (const path of paths) {
      try {
        return await this.makeRequest(path);
      } catch (e: any) {
        if (e.message?.includes('404') || e.message?.includes('405')) continue;
        throw e;
      }
    }
    return { note: 'Automation script listing is not available via client credentials flow. Scripts must be pre-configured in NinjaOne; use run_device_script with a known script ID.' };
  }

  async getDeviceScriptingOptions(deviceId: number): Promise<any> {
    // GET /v2/device/{deviceId}/scripting/options
    // Determine which scripting options are available for the target device.
    return this.makeRequest(`/v2/device/${deviceId}/scripting/options`);
  }

  async getDeviceJobs(deviceId: number): Promise<any> {
    // GET /v2/device/{deviceId}/jobs
    // Returns active jobs for the device — used for job correlation after script execution.
    return this.makeRequest(`/v2/device/${deviceId}/jobs`);
  }

  async findScriptByName(name: string): Promise<any> {
    // Internal: resolve a script name to its numeric ID.
    // Returns { found: true, script: {...} } or { found: false, candidates: [...] }.
    const scripts = await this.listAutomationScripts();
    const results: any[] = Array.isArray(scripts) ? scripts : (scripts?.results || []);
    const nameLower = name.toLowerCase().trim();

    // Exact match first
    const exact = results.filter((s: any) => (s.name || '').toLowerCase().trim() === nameLower);
    if (exact.length === 1) return { found: true, script: exact[0] };

    // Partial match
    const partial = results.filter((s: any) => (s.name || '').toLowerCase().includes(nameLower));
    if (partial.length === 1) return { found: true, script: partial[0] };

    if (partial.length === 0) {
      return { found: false, candidates: [], note: `No scripts matching "${name}" found.` };
    }

    return {
      found: false,
      candidates: partial.map((s: any) => ({
        id: s.id,
        name: s.name,
        uid: s.uid,
        language: s.language,
        operatingSystem: s.operatingSystem,
        category: s.category
      })),
      note: `Multiple scripts match "${name}". Please narrow the search.`
    };
  }

  async waitForScriptResult(
    deviceId: number,
    activityId: number,
    opts?: { timeoutMs?: number; pollIntervalMs?: number }
  ): Promise<any> {
    // Internal: poll getScriptResult until the activity completes or timeout.
    const timeout = opts?.timeoutMs || 120_000;
    const interval = opts?.pollIntervalMs || 3_000;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const result = await this.getScriptResult(deviceId, activityId);
      // Check if the activity has a terminal status
      const status = result?.status || result?.result?.status || '';
      const activityResult = result?.result || result?.activityResult || result;
      if (
        status === 'COMPLETED' ||
        status === 'FAILED' ||
        status === 'SUCCESS' ||
        status === 'ERROR' ||
        activityResult?.status === 'COMPLETED' ||
        activityResult?.status === 'FAILED'
      ) {
        return { ...result, polled: true, status: status || activityResult?.status };
      }
      // If the result contains actual output/error text, treat as terminal
      if (result?.stdout || result?.stderr || result?.output || result?.error) {
        return { ...result, polled: true };
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }

    return {
      note: `Script result polling timed out after ${timeout}ms. The script may still be running. Use get_script_result to check manually.`,
      deviceId,
      activityId,
      polled: true,
      timedOut: true
    };
  }

  async runDeviceScript(deviceId: number, body: {
    type?: string;
    id: number;
    uid?: string;
    runAs?: string;
    parameters?: string;
  }): Promise<any> {
    const payload = { type: body.type || 'SCRIPT', ...body };
    console.error(`[DEBUG] POST /v2/device/${deviceId}/script/run payload:`, JSON.stringify(payload));
    return this.makeRequest(`/v2/device/${deviceId}/script/run`, 'POST', payload);
  }

  async getScriptResult(deviceId: number, activityId: number): Promise<any> {
    // No dedicated script result endpoint. Poll device activities for the result.
    const activities = await this.getDeviceActivities(deviceId, 50);
    const results: any[] = activities?.activities || activities || [];
    const match = Array.isArray(results)
      ? results.find((a: any) => a.id === activityId || a.activityId === activityId)
      : null;
    if (match) return match;
    return { note: `Activity ${activityId} not found in recent device activities. The script may still be running.`, deviceId, activityId };
  }

  async getPolicy(policyId: number): Promise<any> {
    // No single-policy GET endpoint exists. Fetch all and filter.
    const policies = await this.getPolicies();
    if (!Array.isArray(policies)) return policies;
    const policy = policies.find((p: any) => p.id === policyId);
    if (!policy) throw new Error(`Policy ${policyId} not found`);
    return policy;
  }

  async assignDevicePolicy(deviceId: number, policyId: number): Promise<any> {
    // No dedicated policy assignment endpoint. Use device PATCH with policyId.
    try {
      return await this.makeRequest(`/v2/device/${deviceId}`, 'PATCH', { policyId });
    } catch (e: any) {
      if (e.message?.includes('404')) {
        throw new Error(`Device ${deviceId} not found — verify the device ID via get_devices. (PATCH /v2/device/${deviceId} returned 404.)`);
      }
      throw e;
    }
  }

  async getPendingDevices(): Promise<any> {
    return this.getDevices('status = PENDING', 200);
  }
}