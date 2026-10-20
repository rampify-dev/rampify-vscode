/**
 * Rampify API Type Definitions
 */

/** A project's display fields, joined onto each workspace by GET /clients. */
export interface ClientProject {
  id: string;
  name: string | null;
  brand_name: string | null;
  domain: string | null;
}

export interface Client {
  id: string;
  /** Null for projects created from the dashboard's name-first modal. */
  company_name: string | null;
  /** PostgREST returns the 1:1 join as an object or a one-element array. */
  projects?: ClientProject | ClientProject[] | null;
  contact_email: string | null;
  contact_name: string | null;
  status: 'prospect' | 'active' | 'paused' | 'churned';
  created_at: string;
  updated_at: string;
}

export interface Site {
  id: string;
  client_id: string;
  domain: string;
  sitemap_url: string | null;
  gsc_property_url: string | null;
  logo_url: string | null;
  logo_bg_color: string | null;
  last_crawled_at: string | null;
  crawl_frequency_hours: number;
  created_at: string;
  updated_at: string;
}

/**
 * Name only, like the dashboard's New Project modal. The setup wizard collects
 * the domain and project type afterwards.
 */
export interface CreateClientRequest {
  projectName: string;
}

/**
 * The account's project allowance (Free 1 / Starter 5 / Pro 10). Read from
 * GET /me/projects `project_quota` and from the 403 body when POST /clients
 * hits the limit. Older servers send only { current, limit } on the 403.
 */
export interface ProjectQuota {
  allowed?: boolean;
  current?: number;
  /** null = unlimited (admins). */
  limit?: number | null;
  tier?: string;
  /** Display name of the plan, e.g. "Free". */
  tier_label?: string;
  reason?: 'limit_reached' | 'viewer' | 'scoped_key' | null;
  message?: string | null;
  /** The next plan up; null at the top tier. url is a same-origin path. */
  upgrade?: { plan: string; url: string; label: string } | null;
}

export type CreateClientResult =
  | { ok: true; client: Client }
  | { ok: false; reason: 'limit'; quota: ProjectQuota; message: string }
  | { ok: false; reason: 'scoped_key' | 'error'; message: string };

export interface FeatureSpec {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  feature_type: 'new_feature' | 'enhancement' | 'refactor' | 'bug_fix' | 'optimization' | 'page' | 'positioning';
  status: 'idea' | 'planned' | 'in_progress' | 'completed' | 'verified' | 'deprecated';
  priority: 'critical' | 'high' | 'normal' | 'low';
  tech_stack: string[];
  affected_files: string[];
  tags: string[];
  source: string;
  module: string | null;
  severity: string | null;
  affected_urls: any[] | null;
  fix_instructions: string | null;
  ai_context_summary: string | null;
  next_action: string | null;
  opportunity_id: string | null;
  /** 'marketing' specs are the dashboard's Content tab, 'product' its Build tab. */
  work_domain: 'marketing' | 'product' | null;
  /** Dashboard link for this spec (production host), set by the API. */
  dashboard_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiError {
  error: string;
  details?: string;
}
