import axios, { AxiosInstance, AxiosError } from 'axios';
import type { OnboardingState } from '../views/setup-steps';
import * as vscode from 'vscode';
import {
  Client,
  Site,
  FeatureSpec,
  CreateClientRequest,
  CreateClientResult,
  ProjectQuota,
  ApiError
} from './types';

export type Environment = 'production' | 'staging' | 'local';

declare module 'axios' {
  interface AxiosRequestConfig {
    /** Skip the interceptor's error toast; the caller reports the failure. */
    rampifySilent?: boolean;
  }
}

export type ApiKeyCheck = 'valid' | 'invalid' | 'unreachable';

/**
 * Why a request is being made, sent as X-Rampify-Trigger so Rampify can tell
 * a person acting in the editor ("user": a click or command) from the
 * extension refreshing on its own ("background": timers, window focus, the
 * panel opening). Spec dfa02633.
 */
export type RequestTrigger = 'user' | 'background';

/** "vscode-extension/<version>", sent as X-Rampify-Client on every request. */
function clientHeader(): string {
  const version = vscode.extensions.getExtension('rampify.rampify')?.packageJSON?.version ?? 'unknown';
  return `vscode-extension/${version}`;
}

export interface RampifyConfig {
  apiKey: string;
  environment: Environment;
  localApiUrl?: string;
}

export class RampifyApiClient {
  private axios: AxiosInstance;
  private config: RampifyConfig;
  private trigger: RequestTrigger;

  constructor(config: RampifyConfig, trigger: RequestTrigger = 'user') {
    this.config = config;
    this.trigger = trigger;
    const baseURL = this.getBaseUrl();

    console.log('API Client Config:', {
      baseURL,
      environment: config.environment,
      hasApiKey: !!config.apiKey,
    });

    this.axios = axios.create({
      baseURL,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
        'X-Rampify-Client': clientHeader(),
        'X-Rampify-Trigger': trigger,
      },
      timeout: 30000,
    });

    // Add response interceptor for error handling
    this.axios.interceptors.response.use(
      (response) => response,
      (error: AxiosError<ApiError>) => {
        // Never log request headers: they carry the API key.
        console.error('API Error:', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          method: error.config?.method,
          url: error.config?.url,
        });

        if (error.config?.rampifySilent) {
          return Promise.reject(error);
        }

        if (error.response?.status === 401) {
          const errorMsg = error.response?.data?.error || 'Invalid API key';
          vscode.window.showErrorMessage(`Rampify: ${errorMsg}. Please check your settings.`);
        } else if (error.response?.status === 403) {
          vscode.window.showErrorMessage('Rampify: Access denied. Please check your permissions.');
        } else if (error.response?.data?.error) {
          vscode.window.showErrorMessage(`Rampify: ${error.response.data.error}`);
        } else if (error.message) {
          vscode.window.showErrorMessage(`Rampify: ${error.message}`);
        }
        return Promise.reject(error);
      }
    );
  }

  private getBaseUrl(): string {
    switch (this.config.environment) {
      case 'production':
        return 'https://www.rampify.dev/api';
      case 'staging':
        return 'https://www.rampify.dev/api'; // No staging, fallback to production
      case 'local':
        return `${this.config.localApiUrl || 'http://localhost:3000'}/api`;
    }
  }

  // ============================================================================
  // CLIENT METHODS
  // ============================================================================

  /** `silent` skips the error toast (background refreshes report their own state). */
  /** The same client, for requests the extension makes on its own (see RequestTrigger). */
  withTrigger(trigger: RequestTrigger): RampifyApiClient {
    return trigger === this.trigger ? this : new RampifyApiClient(this.config, trigger);
  }

  async getClients(opts: { silent?: boolean } = {}): Promise<Client[]> {
    const response = await this.axios.get<{ clients: Client[] }>('/clients', { rampifySilent: opts.silent });
    return response.data.clients;
  }

  /**
   * Create a workspace + project. Failures come back as values (no toast) so
   * the caller can turn a plan limit into an upgrade prompt.
   */
  async createClient(data: CreateClientRequest): Promise<CreateClientResult> {
    try {
      const response = await this.axios.post<{ client: Client }>('/clients', data, { rampifySilent: true });
      return { ok: true, client: response.data.client };
    } catch (error) {
      if (!axios.isAxiosError(error)) { throw error; }
      const body = (error.response?.data ?? {}) as ApiError & {
        code?: string;
        quota?: ProjectQuota;
        upgrade?: ProjectQuota['upgrade'];
      };
      const message = body.error || error.message || 'Could not create the project.';
      if (error.response?.status === 403) {
        if (body.code === 'project_limit_reached' || body.quota) {
          return {
            ok: false,
            reason: 'limit',
            quota: { ...body.quota, upgrade: body.upgrade ?? body.quota?.upgrade },
            message,
          };
        }
        return { ok: false, reason: 'scoped_key', message };
      }
      return { ok: false, reason: 'error', message };
    }
  }

  /**
   * The account's project allowance, or null when the server doesn't report
   * it (older deployments) or can't be reached. Callers then just attempt the
   * create and handle a limit response.
   */
  async getProjectQuota(): Promise<ProjectQuota | null> {
    try {
      const response = await this.axios.get<{ project_quota?: ProjectQuota }>('/me/projects', { rampifySilent: true });
      return response.data.project_quota ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Whether an AI tool has connected to Rampify's MCP server with this
   * account (the server's one definition, not local config files). Null when
   * the server doesn't report it (older deployments) or can't be reached.
   */
  async getAiToolConnected(): Promise<boolean | null> {
    try {
      const response = await this.axios.get<{ ai_tool_connected?: boolean }>('/me/projects', { rampifySilent: true });
      return typeof response.data.ai_tool_connected === 'boolean' ? response.data.ai_tool_connected : null;
    } catch {
      return null;
    }
  }

  /**
   * The project's setup state: intake answers, crawl and Search Console
   * status, and the web wizard's progress (GET /sites/:id/setup-advance, the
   * same read the dashboard's wizard uses).
   */
  async getSetup(siteId: string): Promise<ProjectSetup | null> {
    try {
      const response = await this.axios.get<ProjectSetup>(`/sites/${siteId}/setup-advance`, { rampifySilent: true });
      return response.data;
    } catch {
      return null;
    }
  }

  /**
   * Save the sidebar's site and name (PATCH /sites/:id). Failures come back
   * as values.
   */
  async updateProject(siteId: string, body: ProjectUpdate): Promise<ProjectUpdateResult> {
    try {
      await this.axios.patch(`/sites/${siteId}`, body, { rampifySilent: true });
      return { ok: true };
    } catch (error) {
      const data = (axios.isAxiosError(error) ? error.response?.data : undefined) as ApiError & { code?: string } | undefined;
      const message = data?.error || (error instanceof Error ? error.message : 'Could not save the project.');
      return { ok: false, message };
    }
  }

  /** Skip (or un-skip) an optional onboarding step, on the server so every surface sees it. */
  async setOnboardingStepSkipped(siteId: string, step: string, skipped: boolean): Promise<boolean> {
    try {
      await this.axios.post(`/sites/${siteId}/setup-advance`, { action: 'skip_step', step, skipped }, { rampifySilent: true });
      return true;
    } catch {
      return false;
    }
  }

  /** Answer "how did you find us" (null: skip it). The same answer the web setup records. */
  async saveHowFound(value: string | null): Promise<boolean> {
    try {
      await this.axios.post('/me/onboarding', value ? { how_found_us: value } : {}, { rampifySilent: true });
      return true;
    } catch {
      return false;
    }
  }

  /** Onboarding progress: the getting-started spec, the spec the AI wrote from it, and spec counts by origin. */
  async getGettingStarted(siteId: string): Promise<GettingStartedState | null> {
    try {
      const response = await this.axios.get<GettingStartedState>(`/sites/${siteId}/getting-started`, { rampifySilent: true });
      return response.data;
    } catch {
      return null;
    }
  }

  /** Create (or fetch) the getting-started spec; returns the prompt for the AI tool. */
  async startGettingStarted(siteId: string, buildingFirst?: string): Promise<{ spec: { id: string; title: string }; prompt: string } | null> {
    try {
      const response = await this.axios.post<{ spec: { id: string; title: string }; prompt: string }>(
        `/sites/${siteId}/getting-started`,
        buildingFirst?.trim() ? { building_first: buildingFirst.trim() } : {},
        { rampifySilent: true }
      );
      return response.data;
    } catch {
      return null;
    }
  }

  /** Start a full scan of the project's site (crawl + findings → specs). */
  async startScan(siteId: string): Promise<{ ok: true } | { ok: false; message: string }> {
    try {
      await this.axios.post(`/sites/${siteId}/analyze/trigger`, { include_url_health: true }, { rampifySilent: true });
      return { ok: true };
    } catch (error) {
      // A scan already running counts as started (as on the web).
      if (axios.isAxiosError(error) && error.response?.status === 409) { return { ok: true }; }
      const data = (axios.isAxiosError(error) ? error.response?.data : undefined) as ApiError | undefined;
      return { ok: false, message: data?.error || 'Could not start the scan.' };
    }
  }

  async getSite(clientId: string, opts: { silent?: boolean } = {}): Promise<Site | null> {
    try {
      const response = await this.axios.get<Site>(`/clients/${clientId}/site`, { rampifySilent: opts.silent });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  // ============================================================================
  // FEATURE SPEC METHODS
  // ============================================================================

  /** Total specs for a project, without fetching them (limit=1, slim rows). */
  async countFeatureSpecs(siteId: string): Promise<number> {
    const response = await this.axios.get<{ page?: { total_count?: number }; count?: number }>(
      `/sites/${siteId}/feature-specs?limit=1&summary_only=true`,
      { rampifySilent: true }
    );
    return response.data.page?.total_count ?? response.data.count ?? 0;
  }

  async getFeatureSpecs(siteId: string, status?: string): Promise<FeatureSpec[]> {
    const params = status ? `?status=${status}` : '';
    const response = await this.axios.get<{ specs: FeatureSpec[] }>(
      `/sites/${siteId}/feature-specs${params}`
    );
    return response.data.specs;
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Check the API key against an authenticated endpoint. (/health is public,
   * so it reported every key as valid.) /me/projects accepts account and
   * project-scoped keys alike.
   */
  async validateApiKey(): Promise<ApiKeyCheck> {
    try {
      await this.axios.get('/me/projects', { rampifySilent: true });
      return 'valid';
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      return status === 401 || status === 403 ? 'invalid' : 'unreachable';
    }
  }

  updateConfig(config: Partial<RampifyConfig>): void {
    this.config = { ...this.config, ...config };

    // Update axios instance
    this.axios.defaults.baseURL = this.getBaseUrl();
    if (config.apiKey) {
      this.axios.defaults.headers['Authorization'] = `Bearer ${config.apiKey}`;
    }
  }
}

/** GET /sites/:id/setup-advance (the fields the sidebar reads). */
export interface ProjectSetup {
  wizard: { state: 'pending' | 'in_progress' | 'completed' | 'dismissed'; step: string | null } | null;
  bootstrap_phase: string | null;
  has_crawled_urls: boolean;
  gsc: { connected: boolean; has_property: boolean };
  /** The one onboarding state (spec 724f9f24); absent on older servers. */
  onboarding?: OnboardingState;
  /** "How did you find us" answers, the same as web setup's. */
  how_found_options?: { value: string; label: string; more?: boolean }[];
  /** Why the last scan failed, when it did (lib/scans/failure.ts on the server). */
  scan_failure?: { kind: string; summary: string; nextStep: string; helpUrl: string | null } | null;
  /** What to ask the AI tool first (lib/onboarding/first-prompt.ts). */
  first_prompt?: string;
  project: {
    domain: string | null;
    name: string | null;
    brand_name: string | null;
  };
}

export interface ProjectUpdate {
  name?: string;
  domain?: string;
  editor?: string;
}

export type ProjectUpdateResult = { ok: true } | { ok: false; message: string };

/** GET /sites/:id/getting-started. */
export interface GettingStartedState {
  getting_started: { id: string; title: string; status: string; tasks: { id: string; title: string; status: string }[] } | null;
  prompt: string | null;
  follow_up: { id: string; title: string; status: string } | null;
  user_spec_count: number;
  scan_spec_count: number;
}
