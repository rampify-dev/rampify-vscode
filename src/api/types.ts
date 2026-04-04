/**
 * Rampify API Type Definitions
 */

export interface ActionItem {
  id: string;
  siteId: string;
  snapshotId: string;
  category: 'url_health' | 'indexing' | 'content' | 'performance' | 'structured_data';
  actionType: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'new' | 'in_progress' | 'completed' | 'dismissed';
  title: string;
  description: string;
  affectedCount: number;
  metadata: {
    impact_description?: string;
    fix_instructions?: string;
    effort_estimate?: 'quick' | 'medium' | 'complex';
    example_urls?: string[];
    [key: string]: any;
  };
  relevantPhases: Array<'pre_launch' | 'initial_submission' | 'indexing' | 'public_launch' | 'growth'>;
  requiredPhase: 'pre_launch' | 'initial_submission' | 'indexing' | 'public_launch' | 'growth' | null;
  blocksPhase: 'pre_launch' | 'initial_submission' | 'indexing' | 'public_launch' | 'growth' | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ActionSnapshot {
  id: string;
  siteId: string;
  phaseId: string;
  snapshotDate: string;
  totalActions: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  completedCount: number;
  newCount: number;
  inProgressCount: number;
  dismissedCount: number;
  isLatest: boolean;
  createdAt: string;
}

export interface Phase {
  id: string;
  siteId: string;
  phaseType: 'pre_launch' | 'initial_submission' | 'indexing' | 'public_launch' | 'growth';
  status: 'not_started' | 'in_progress' | 'completed' | 'blocked';
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Client {
  id: string;
  company_name: string;
  domain: string;
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

export interface CreateClientRequest {
  companyName: string;
  domain?: string;
  contactEmail?: string;
  contactName?: string;
}

export interface UpdateActionStatusRequest {
  status: 'new' | 'in_progress' | 'completed' | 'dismissed';
}

export interface FeatureSpec {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  feature_type: 'new_feature' | 'enhancement' | 'refactor' | 'bug_fix' | 'optimization';
  status: 'planned' | 'in_progress' | 'completed' | 'verified' | 'deprecated';
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
  criteria_count: number;
  tasks_count: number;
  completed_tasks_count: number;
  verified_criteria_count: number;
  created_at: string;
  updated_at: string;
}

export interface ApiError {
  error: string;
  details?: string;
}
