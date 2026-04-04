import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface ProjectConfig {
  clientId: string;
  domain: string;
}

/**
 * Auto-detect domain from common project files
 */
export async function detectProjectDomain(): Promise<string | null> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return null;
  }

  const rootPath = workspaceFolders[0].uri.fsPath;

  // 1. Check package.json
  const packageJsonPath = path.join(rootPath, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

      // Check homepage field
      if (packageJson.homepage) {
        const domain = extractDomain(packageJson.homepage);
        if (domain) {return domain;}
      }

      // Check rampify-specific field
      if (packageJson.rampify?.domain) {
        return packageJson.rampify.domain;
      }
    } catch (error) {
      console.error('Error reading package.json:', error);
    }
  }

  // 2. Check .env files
  const envFiles = ['.env', '.env.local', '.env.production'];
  for (const envFile of envFiles) {
    const envPath = path.join(rootPath, envFile);
    if (fs.existsSync(envPath)) {
      try {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const domainMatch = envContent.match(/(?:NEXT_PUBLIC_)?DOMAIN=(.+)/);
        if (domainMatch) {
          const domain = extractDomain(domainMatch[1].trim());
          if (domain) {return domain;}
        }
      } catch (error) {
        console.error(`Error reading ${envFile}:`, error);
      }
    }
  }

  // 3. Check next.config.js
  const nextConfigPath = path.join(rootPath, 'next.config.js');
  if (fs.existsSync(nextConfigPath)) {
    try {
      const nextConfig = fs.readFileSync(nextConfigPath, 'utf8');
      const urlMatch = nextConfig.match(/url:\s*['"]([^'"]+)['"]/);
      if (urlMatch) {
        const domain = extractDomain(urlMatch[1]);
        if (domain) {return domain;}
      }
    } catch (error) {
      console.error('Error reading next.config.js:', error);
    }
  }

  // 4. Check vercel.json
  const vercelConfigPath = path.join(rootPath, 'vercel.json');
  if (fs.existsSync(vercelConfigPath)) {
    try {
      const vercelConfig = JSON.parse(fs.readFileSync(vercelConfigPath, 'utf8'));
      if (vercelConfig.alias) {
        const alias = Array.isArray(vercelConfig.alias)
          ? vercelConfig.alias[0]
          : vercelConfig.alias;
        const domain = extractDomain(alias);
        if (domain) {return domain;}
      }
    } catch (error) {
      console.error('Error reading vercel.json:', error);
    }
  }

  return null;
}

/**
 * Extract clean domain from URL or domain string
 */
function extractDomain(urlOrDomain: string): string | null {
  try {
    // Remove protocol if present
    let domain = urlOrDomain.replace(/^https?:\/\//, '');

    // Remove path if present
    domain = domain.split('/')[0];

    // Remove port if present
    domain = domain.split(':')[0];

    // Remove www. prefix
    domain = domain.replace(/^www\./, '');

    // Validate it looks like a domain
    if (domain && domain.includes('.') && !domain.includes(' ')) {
      return domain;
    }
  } catch (error) {
    console.error('Error extracting domain:', error);
  }

  return null;
}

/**
 * Get project configuration from workspace settings.
 * Only clientId is required — domain is optional.
 */
export function getProjectConfig(): ProjectConfig | null {
  const config = vscode.workspace.getConfiguration('rampify');
  const clientId = config.get<string>('clientId');
  const domain = config.get<string>('domain') || '';

  if (clientId) {
    return { clientId, domain };
  }

  return null;
}

/**
 * Save project configuration to workspace settings.
 * Requires a folder to be open — config is always project-scoped to prevent
 * cross-contamination between different codebases.
 */
export async function saveProjectConfig(config: ProjectConfig): Promise<void> {
  if ((vscode.workspace.workspaceFolders?.length ?? 0) === 0) {
    throw new Error('Open a folder in VS Code first, then link your Rampify project.');
  }

  const workspaceConfig = vscode.workspace.getConfiguration('rampify');
  await workspaceConfig.update('clientId', config.clientId, vscode.ConfigurationTarget.Workspace);
  await workspaceConfig.update('domain', config.domain || '', vscode.ConfigurationTarget.Workspace);
}

/**
 * Clear project configuration from workspace settings.
 */
export async function clearProjectConfig(): Promise<void> {
  const workspaceConfig = vscode.workspace.getConfiguration('rampify');
  await workspaceConfig.update('clientId', undefined, vscode.ConfigurationTarget.Workspace);
  await workspaceConfig.update('domain', undefined, vscode.ConfigurationTarget.Workspace);
}
