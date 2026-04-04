import axios, { AxiosInstance, AxiosError } from 'axios';
import * as vscode from 'vscode';
import {
  ActionItem,
  ActionSnapshot,
  Phase,
  Client,
  Site,
  FeatureSpec,
  CreateClientRequest,
  UpdateActionStatusRequest,
  ApiError
} from './types';

export type Environment = 'production' | 'staging' | 'local';

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
      apiKeyPrefix: config.apiKey?.substring(0, 15),
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
        console.error('API Error:', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          url: error.config?.url,
          headers: error.config?.headers,
        });

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

  async getClients(): Promise<Client[]> {
    const response = await this.axios.get<{ clients: Client[] }>('/clients');
    return response.data.clients;
  }

  async getClient(clientId: string): Promise<Client> {
    const response = await this.axios.get<Client>(`/clients/${clientId}`);
    return response.data;
  }

  async createClient(data: CreateClientRequest): Promise<Client> {
    const response = await this.axios.post<{ client: Client }>('/clients', data);
    return response.data.client;
  }

  async getSite(clientId: string): Promise<Site | null> {
    try {
      const response = await this.axios.get<Site>(`/clients/${clientId}/site`);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  // ============================================================================
  // ACTION PLAN METHODS
  // ============================================================================

  async getLatestSnapshot(siteId: string): Promise<ActionSnapshot | null> {
    try {
      const response = await this.axios.get<ActionSnapshot>(
        `/sites/${siteId}/action-snapshots/latest`
      );
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async getActionItems(snapshotId: string): Promise<ActionItem[]> {
    const response = await this.axios.get<ActionItem[]>(
      `/action-snapshots/${snapshotId}/actions`
    );
    return response.data;
  }

  async getPhases(siteId: string): Promise<Phase[]> {
    const response = await this.axios.get<Phase[]>(`/sites/${siteId}/phases`);
    return response.data;
  }

  async updateActionStatus(
    actionId: string,
    data: UpdateActionStatusRequest
  ): Promise<ActionItem> {
    const response = await this.axios.patch<ActionItem>(
      `/action-items/${actionId}/status`,
      data
    );
    return response.data;
  }

  async generateSnapshot(siteId: string): Promise<ActionSnapshot> {
    const response = await this.axios.post<ActionSnapshot>(
      `/sites/${siteId}/action-snapshots/generate`
    );
    return response.data;
  }

  // ============================================================================
  // FEATURE SPEC METHODS
  // ============================================================================

  async getFeatureSpecs(siteId: string, status?: string): Promise<FeatureSpec[]> {
    const params = status ? `?status=${status}` : '';
    const response = await this.axios.get<{ specs: FeatureSpec[] }>(
      `/sites/${siteId}/feature-specs${params}`
    );
    return response.data.specs;
  }

  async updateFeatureSpecStatus(
    specId: string,
    siteId: string,
    status: FeatureSpec['status']
  ): Promise<void> {
    await this.axios.patch(`/sites/${siteId}/feature-specs/${specId}`, { status });
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  async testConnection(): Promise<boolean> {
    try {
      await this.axios.get('/health');
      return true;
    } catch {
      return false;
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
