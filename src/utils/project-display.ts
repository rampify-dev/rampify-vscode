import { Client, ClientProject } from '../api/types';

export function primaryProject(client: Client): ClientProject | null {
  const p = client.projects;
  return (Array.isArray(p) ? p[0] : p) ?? null;
}

/** Same fallback order as the dashboard (lib/db/project-display-name.ts). */
export function projectDisplayName(client: Client): string {
  const project = primaryProject(client);
  return (
    project?.name ||
    project?.brand_name ||
    project?.domain ||
    client.company_name ||
    'Untitled project'
  );
}
