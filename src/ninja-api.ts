import {
  buildAuthorizeUrl,
  createPkcePair,
  createState,
  exchangeCode,
  refresh as refreshAccessToken,
  parseRedirectUrl,
  type PkcePair,
  type TokenResponse,
} from './auth/authorization-code.js';
import { openBrowser, waitForCallback } from './auth/loopback.js';
import * as tokenStore from './auth/token-store.js';

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

export type AuthMode = 'client_credentials' | 'authorization_code';

interface PendingLogin {
  pkce: PkcePair;
  state: string;
  redirectUri: string;
  scope: string;
  baseUrl: string;
}

export interface AuthStatus {
  mode: AuthMode;
  configured: boolean;
  tenantBaseUrl: string | null;
  accessTokenValid: boolean;
  accessTokenExpiresAt: number | null;
  hasRefreshToken: boolean;
  pendingLogin: boolean;
  redirectUri: string | null;
  scope: string | null;
  tokenStorePath: string;
}

export interface LoginStartResult {
  authorizeUrl: string;
  redirectUri: string;
  mode: 'loopback' | 'manual';
  message: string;
}

export class NinjaOneAPI {
  private baseUrl: string | null = null;
  private clientId: string;
  private clientSecret: string;
  private accessToken: string | null = null;
  private tokenExpiry: number | null = null;
  private refreshToken: string | null = null;
  private isConfigured: boolean;
  private baseUrlExplicit: boolean = false;
  private authMode: AuthMode;
  private redirectUri: string;
  private oauthPort: number;
  private scope: string;
  private pendingLogin: PendingLogin | null = null;
  private tokenLoadPromise: Promise<void> | null = null;

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

  private static readonly DEFAULT_CC_SCOPE = 'monitoring management control';
  private static readonly DEFAULT_AC_SCOPE = 'monitoring management control offline_access';

  constructor() {
    const envBase = process.env.NINJA_BASE_URL;
    const envRegion = (process.env.NINJA_REGION || '').toLowerCase();

    if (envBase) {
      this.baseUrl = this.normalizeBaseUrl(envBase);
      this.baseUrlExplicit = true;
    } else if (envRegion && NinjaOneAPI.REGION_MAP[envRegion]) {
      this.baseUrl = NinjaOneAPI.REGION_MAP[envRegion]!;
      this.baseUrlExplicit = true;
    } else {
      this.baseUrl = null;
    }
    this.clientId = process.env.NINJA_CLIENT_ID || '';
    this.clientSecret = process.env.NINJA_CLIENT_SECRET || '';

    const modeEnv = (process.env.NINJA_AUTH_MODE || 'client_credentials').toLowerCase();
    this.authMode = modeEnv === 'authorization_code' ? 'authorization_code' : 'client_credentials';

    const portEnv = parseInt(process.env.NINJA_OAUTH_PORT || '', 10);
    this.oauthPort = Number.isFinite(portEnv) && portEnv > 0 ? portEnv : 8765;
    this.redirectUri = process.env.NINJA_OAUTH_REDIRECT_URI
      || `http://localhost:${this.oauthPort}/callback`;
    this.scope = process.env.NINJA_OAUTH_SCOPES
      || (this.authMode === 'authorization_code'
        ? NinjaOneAPI.DEFAULT_AC_SCOPE
        : NinjaOneAPI.DEFAULT_CC_SCOPE);

    if (this.authMode === 'authorization_code') {
      this.isConfigured = !!this.clientId;
      if (!this.isConfigured) {
        console.error('WARNING: NINJA_CLIENT_ID not set - authorization_code flow cannot start until configured');
      } else {
        console.error(`NinjaONE API initialized (authorization_code flow, redirect=${this.redirectUri})`);
      }
      this.tokenLoadPromise = this.loadStoredTokens().catch((err) => {
        console.error('[ninja-api] token load failed:', err);
      });
    } else {
      this.isConfigured = !!(this.clientId && this.clientSecret);
      if (!this.isConfigured) {
        console.error('WARNING: NINJA_CLIENT_ID and NINJA_CLIENT_SECRET not set - API calls will fail until configured');
      } else {
        console.error('NinjaONE API initialized successfully (client_credentials flow)');
      }
    }
  }

  public getAuthMode(): AuthMode {
    return this.authMode;
  }

  public async getAuthStatus(): Promise<AuthStatus> {
    await this.ensureTokensLoaded();
    return {
      mode: this.authMode,
      configured: this.isConfigured,
      tenantBaseUrl: this.baseUrl,
      accessTokenValid: !!(this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry),
      accessTokenExpiresAt: this.tokenExpiry,
      hasRefreshToken: !!this.refreshToken,
      pendingLogin: !!this.pendingLogin,
      redirectUri: this.authMode === 'authorization_code' ? this.redirectUri : null,
      scope: this.scope,
      tokenStorePath: tokenStore.location(),
    };
  }

  public async logout(): Promise<void> {
    this.accessToken = null;
    this.tokenExpiry = null;
    this.refreshToken = null;
    this.pendingLogin = null;
    await tokenStore.clear();
  }

  public async startLogin(preferLoopback: boolean = true): Promise<LoginStartResult> {
    if (this.authMode !== 'authorization_code') {
      throw new Error('Login is only available when NINJA_AUTH_MODE=authorization_code');
    }
    if (!this.clientId) {
      throw new Error('NINJA_CLIENT_ID is required to start login');
    }

    const base = await this.resolveBaseUrlForAuth();
    const pkce = createPkcePair();
    const state = createState();
    const authorizeUrl = buildAuthorizeUrl({
      baseUrl: base,
      clientId: this.clientId,
      redirectUri: this.redirectUri,
      scope: this.scope,
      state,
      codeChallenge: pkce.challenge,
    });

    this.pendingLogin = {
      pkce,
      state,
      redirectUri: this.redirectUri,
      scope: this.scope,
      baseUrl: base,
    };

    if (preferLoopback) {
      this.runLoopbackFlow(authorizeUrl).catch((err) => {
        console.error('[ninja-api] loopback login failed:', err);
      });
      return {
        authorizeUrl,
        redirectUri: this.redirectUri,
        mode: 'loopback',
        message: `Open the URL in your browser if it does not launch automatically. After you log in, the flow completes via ${this.redirectUri}. If the loopback cannot receive the callback, call ninja_auth_paste_redirect with the full redirect URL.`,
      };
    }

    return {
      authorizeUrl,
      redirectUri: this.redirectUri,
      mode: 'manual',
      message: `Open the URL in your browser, complete the login, and paste the FULL redirect URL (including ?code=...&state=...) into ninja_auth_paste_redirect.`,
    };
  }

  public async completeLoginFromRedirect(redirectUrl: string): Promise<void> {
    if (!this.pendingLogin) {
      throw new Error('No pending login — call ninja_auth_login first.');
    }
    const parsed = parseRedirectUrl(redirectUrl);
    if (parsed.error) {
      throw new Error(`OAuth error from provider: ${parsed.error}`);
    }
    if (!parsed.code || !parsed.state) {
      throw new Error('Redirect URL is missing code or state parameter.');
    }
    if (parsed.state !== this.pendingLogin.state) {
      throw new Error('State mismatch — possible CSRF. Restart the login.');
    }
    await this.completeLoginWithCode(parsed.code);
  }

  private async runLoopbackFlow(authorizeUrl: string): Promise<void> {
    if (!this.pendingLogin) return;
    openBrowser(authorizeUrl);
    try {
      const result = await waitForCallback({
        redirectUri: this.pendingLogin.redirectUri,
        expectedState: this.pendingLogin.state,
        timeoutMs: 180_000,
      });
      await this.completeLoginWithCode(result.code);
      console.error('[ninja-api] login completed via loopback callback');
    } catch (err) {
      console.error('[ninja-api] loopback callback error:', err);
    }
  }

  private async completeLoginWithCode(code: string): Promise<void> {
    if (!this.pendingLogin) {
      throw new Error('No pending login.');
    }
    const pending = this.pendingLogin;
    const response = await exchangeCode({
      baseUrl: pending.baseUrl,
      code,
      codeVerifier: pending.pkce.verifier,
      redirectUri: pending.redirectUri,
      clientId: this.clientId,
      ...(this.clientSecret ? { clientSecret: this.clientSecret } : {}),
    });
    this.baseUrl = pending.baseUrl;
    this.baseUrlExplicit = true;
    this.applyTokenResponse(response);
    await this.persistTokens();
    this.pendingLogin = null;
  }

  private async ensureTokensLoaded(): Promise<void> {
    if (this.tokenLoadPromise) {
      await this.tokenLoadPromise;
      this.tokenLoadPromise = null;
    }
  }

  private async loadStoredTokens(): Promise<void> {
    const stored = await tokenStore.load();
    if (!stored) return;
    if (stored.tenantBaseUrl && !this.baseUrlExplicit) {
      this.baseUrl = stored.tenantBaseUrl;
      this.baseUrlExplicit = true;
    }
    this.refreshToken = stored.refreshToken;
    this.accessToken = stored.accessToken;
    this.tokenExpiry = stored.expiresAt;
    if (stored.scope) this.scope = stored.scope;
  }

  private async persistTokens(): Promise<void> {
    if (this.authMode !== 'authorization_code') return;
    await tokenStore.save({
      refreshToken: this.refreshToken,
      accessToken: this.accessToken,
      expiresAt: this.tokenExpiry,
      tenantBaseUrl: this.baseUrl,
      scope: this.scope,
      clientId: this.clientId || null,
    });
  }

  private applyTokenResponse(token: TokenResponse): void {
    this.accessToken = token.access_token;
    this.tokenExpiry = Date.now() + (token.expires_in * 1000);
    if (token.refresh_token) {
      this.refreshToken = token.refresh_token;
    }
    if (token.scope) {
      this.scope = token.scope;
    }
  }

  private async resolveBaseUrlForAuth(): Promise<string> {
    if (this.baseUrl) return this.baseUrl;
    const candidates = this.getCandidateBaseUrls();
    const first = candidates[0];
    if (!first) throw new Error('No candidate base URL available');
    this.baseUrl = first;
    return first;
  }

  private async getAccessToken(): Promise<string> {
    await this.ensureTokensLoaded();

    if (this.authMode === 'authorization_code') {
      return this.getAccessTokenAuthorizationCode();
    }
    return this.getAccessTokenClientCredentials();
  }

  private async getAccessTokenAuthorizationCode(): Promise<string> {
    if (!this.clientId) {
      throw new Error('NinjaONE API not configured - NINJA_CLIENT_ID required');
    }

    if (this.accessToken && this.tokenExpiry && Date.now() < (this.tokenExpiry - 300_000)) {
      return this.accessToken;
    }

    if (!this.refreshToken) {
      throw new Error('Not logged in. Call ninja_auth_login to authorize via browser.');
    }

    const base = await this.resolveBaseUrlForAuth();
    const response = await refreshAccessToken({
      baseUrl: base,
      refreshToken: this.refreshToken,
      clientId: this.clientId,
      ...(this.clientSecret ? { clientSecret: this.clientSecret } : {}),
      scope: this.scope,
    });
    this.applyTokenResponse(response);
    await this.persistTokens();
    return this.accessToken!;
  }

  private async getAccessTokenClientCredentials(): Promise<string> {
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

  public requireAuthorizationCodeMode(operation: string): void {
    if (this.authMode !== 'authorization_code') {
      throw new Error(
        `${operation} requires authorization_code auth flow. ` +
        `Set NINJA_AUTH_MODE=authorization_code and run ninja_auth_login.`
      );
    }
  }

  private async requestToken(baseUrl: string): Promise<{ access_token: string; expires_in: number }> {
    const tokenUrl = `${baseUrl}/ws/oauth/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: this.scope || NinjaOneAPI.DEFAULT_CC_SCOPE,
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

  private async makeRequest(
    endpoint: string, 
    method: string = 'GET',
    body?: any
  ): Promise<any> {
    const token = await this.getAccessToken();
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
    if (this.authMode === 'authorization_code') {
      // Refresh tokens are tenant-bound; re-login required after switching tenant.
      this.refreshToken = null;
      this.pendingLogin = null;
      void this.persistTokens();
    }
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
    const reasonMessage = duration.permanent
      ? 'Maintenance mode enabled via API (permanent)'
      : `Maintenance mode enabled via API for ${duration.value} ${duration.unit.toLowerCase()}`;

    const body: Record<string, unknown> = {
      disabledFeatures: ['ALERTS', 'PATCHING', 'AVSCANS', 'TASKS'],
      start,
      reasonMessage
    };

    if (duration && !duration.permanent) {
      body.end = start + duration.seconds;
    }

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
    return this.makeRequest(`/v2/organization/${id}/policies`); 
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
    // nodeApprovalMode is intentionally ignored because the public API treats it as read-only after creation.
    if (tags !== undefined) body.tags = tags;
    try {
      return await this.makeRequest(`/v2/organizations/${id}`, 'PATCH', body);
    } catch (error: any) {
      if (typeof error?.message === 'string' && error.message.includes('404')) {
        return this.makeRequest(`/v2/organization/${id}`, 'PATCH', body);
      }
      throw error;
    }
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
  
  async getAlerts(deviceFilter?: string, since?: string): Promise<any> {
    return this.makeRequest(`/v2/alerts${this.buildQuery({ df: deviceFilter, since })}`);
  }

  async getAlert(uid: string): Promise<any> { 
    return this.makeRequest(`/v2/alert/${uid}`); 
  }

  async resetAlert(uid: string): Promise<any> { 
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
    return this.makeRequest(`/v2/queries/backup/usage${this.buildQuery({ df, cursor, pageSize })}`);
  }

  // Activities and Software
  
  async getDeviceActivities(id: number, pageSize?: number, olderThan?: string): Promise<any> {
    return this.makeRequest(`/v2/device/${id}/activities${this.buildQuery({ pageSize, olderThan })}`);
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

  // Ticketing

  async getTickets(filter?: string, pageSize?: number, cursor?: string, sortBy?: string): Promise<any> {
    return this.makeRequest(`/v2/ticketing/trigger/tickets${this.buildQuery({ filter, pageSize, cursor, sortBy })}`);
  }

  async getTicket(ticketId: number): Promise<any> {
    return this.makeRequest(`/v2/ticketing/ticket/${ticketId}`);
  }

  async createTicket(payload: Record<string, unknown>): Promise<any> {
    return this.makeRequest('/v2/ticketing/ticket', 'POST', payload);
  }

  async updateTicket(ticketId: number, payload: Record<string, unknown>): Promise<any> {
    return this.makeRequest(`/v2/ticketing/ticket/${ticketId}`, 'PUT', payload);
  }

  async getTicketLogEntries(ticketId: number): Promise<any> {
    return this.makeRequest(`/v2/ticketing/ticket/${ticketId}/log-entry`);
  }

  async addTicketLogEntry(ticketId: number, payload: Record<string, unknown>): Promise<any> {
    return this.makeRequest(`/v2/ticketing/ticket/${ticketId}/log-entry`, 'POST', payload);
  }

  async getTicketingAttributes(): Promise<any> {
    return this.makeRequest('/v2/ticketing/attributes');
  }

  async getTicketingContacts(pageSize?: number, cursor?: string, searchCriteria?: string): Promise<any> {
    return this.makeRequest(`/v2/ticketing/contact/contacts${this.buildQuery({ pageSize, cursor, searchCriteria })}`);
  }

  // Scripts (authorization_code required)

  async getDeviceScriptingOptions(id: number): Promise<any> {
    this.requireAuthorizationCodeMode('run_device_script / get_device_scripting_options');
    return this.makeRequest(`/v2/device/${id}/scripting/options`);
  }

  async runDeviceScript(id: number, payload: Record<string, unknown>): Promise<any> {
    this.requireAuthorizationCodeMode('run_device_script');
    return this.makeRequest(`/v2/device/${id}/script/run`, 'POST', payload);
  }

  async getJobStatus(jobUid: string): Promise<any> {
    return this.makeRequest(`/v2/job/${encodeURIComponent(jobUid)}`);
  }

  // NinjaOne Documentation

  async getDocumentTemplates(): Promise<any> {
    return this.makeRequest('/v2/document-templates');
  }

  async getDocumentTemplate(id: number): Promise<any> {
    return this.makeRequest(`/v2/document-template/${id}`);
  }

  async createDocumentTemplate(payload: Record<string, unknown>): Promise<any> {
    return this.makeRequest('/v2/document-templates', 'POST', payload);
  }

  async updateDocumentTemplate(id: number, payload: Record<string, unknown>): Promise<any> {
    return this.makeRequest(`/v2/document-template/${id}`, 'PATCH', payload);
  }

  async getOrganizationDocuments(organizationId: number): Promise<any> {
    return this.makeRequest(`/v2/organization/${organizationId}/documents`);
  }

  async createOrganizationDocument(organizationId: number, payload: Record<string, unknown>): Promise<any> {
    return this.makeRequest(`/v2/organization/${organizationId}/documents`, 'POST', payload);
  }

  async updateOrganizationDocument(
    organizationId: number,
    documentId: number,
    payload: Record<string, unknown>
  ): Promise<any> {
    return this.makeRequest(`/v2/organization/${organizationId}/document/${documentId}`, 'PATCH', payload);
  }

  // Custom fields per device

  async getDeviceCustomFields(id: number): Promise<any> {
    return this.makeRequest(`/v2/device/${id}/custom-fields`);
  }

  async updateDeviceCustomFields(id: number, fields: Record<string, unknown>): Promise<any> {
    return this.makeRequest(`/v2/device/${id}/custom-fields`, 'PATCH', fields);
  }

  // Webhooks

  async setWebhook(payload: Record<string, unknown>): Promise<any> {
    return this.makeRequest('/v2/webhook', 'PUT', payload);
  }

  async deleteWebhook(): Promise<any> {
    return this.makeRequest('/v2/webhook', 'DELETE');
  }

  // Attachments (binary)

  async getAttachment(id: string): Promise<{ contentType: string; base64: string; size: number }> {
    const token = await this.getAccessToken();
    const base = this.baseUrl || NinjaOneAPI.DEFAULT_CANDIDATES[0]!;
    const response = await fetch(`${base}/v2/attachment/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': '*/*',
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`API request failed: ${response.status} ${response.statusText} - ${text}`);
    }
    const buf = Buffer.from(await response.arrayBuffer());
    return {
      contentType: response.headers.get('content-type') || 'application/octet-stream',
      base64: buf.toString('base64'),
      size: buf.byteLength,
    };
  }

  // Backup

  async queryBackupJobs(df?: string, cursor?: string, pageSize?: number, status?: string, planType?: string): Promise<any> {
    return this.makeRequest(`/v2/queries/backup/jobs${this.buildQuery({ df, cursor, pageSize, status, planType })}`);
  }

  async queryBackupIntegrityChecks(df?: string, cursor?: string, pageSize?: number): Promise<any> {
    return this.makeRequest(`/v2/queries/backup/integrity${this.buildQuery({ df, cursor, pageSize })}`);
  }
}