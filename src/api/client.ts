import axios, { AxiosInstance, AxiosError } from 'axios';
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

export interface RampifyConfig {
  apiKey: string;
  environment: Environment;
  localApiUrl?: string;
}

export class RampifyApiClient {
  private axios: AxiosInstance;
  private config: RampifyConfig;

  constructor(config: RampifyConfig) {
    this.config = config;
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
