import type { SetupSnapshot } from './setup-state';

/**
 * HTML for the Home panel. Pure (no vscode import) so it can be rendered and
 * screenshotted outside the editor. Colors come from the editor theme's CSS
 * variables; the accent matches rampify.dev's brand blue.
 */

export const STARTER_PROMPT =
  'Use Rampify to scan my site and create specs for the most important issues you find.';

export interface HomeHtmlOptions {
  nonce: string;
}

export function renderHomeHtml(s: SetupSnapshot, o: HomeHtmlOptions): string {
  const body = !s.signedIn
    ? signedOut()
    : !s.hasFolder
      ? noFolder()
      : !s.clientId
        ? noProject()
        : checklist(s);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${o.nonce}'; script-src 'nonce-${o.nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${o.nonce}">${CSS}</style>
</head>
<body>
<div class="brand">${LOGO}Rampify</div>
${body}
<script nonce="${o.nonce}">
  const vscode = acquireVsCodeApi();
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (el) { vscode.postMessage({ action: el.dataset.action }); }
  });
</script>
</body>
</html>`;
}

function signedOut(): string {
  return `
<h1>Turn your coding agent into a <span class="accent">marketing agent</span></h1>
<p class="lead">Rampify gives the AI you already code with real search data, specs to build against, and a scan that checks the work.</p>
<ul class="props">
  ${prop(ICON.data, 'Real data, not guesses', 'Keyword volumes, Search Console, and how AI models describe your category.')}
  ${prop(ICON.spec, 'Specs your AI builds against', 'Rampify turns site scans and Discovery research into specs with the fix spelled out.')}
  ${prop(ICON.check, 'Every fix verified', 'The next scan confirms the change worked, so nothing ships on a guess.')}
</ul>
<button class="btn" data-action="signIn">Sign in with Rampify</button>
<p class="hint">New to Rampify? This creates a free account.</p>
<p class="center small"><button class="link" data-action="signInWithCode">Sign in with a code</button> · <button class="link" data-action="useApiKey">Use an API key</button></p>`;
}

function noFolder(): string {
  return `
<h2>Open your project</h2>
<p class="lead">Rampify links each folder to a project. Open the folder for your site or app to connect it.</p>
<button class="btn" data-action="openFolder">Open Folder</button>`;
}

function noProject(): string {
  return `
<h2>Link this folder</h2>
<p class="lead">You're signed in. Pick the Rampify project this folder belongs to, or create one.</p>
<button class="btn" data-action="linkProject">Link a Project</button>
${footer()}`;
}

function checklist(s: SetupSnapshot): string {
  const name = escapeHtml(s.projectName ?? 'your project');
  if (s.error) {
    return `
<h2>${name}</h2>
<p class="error">${escapeHtml(s.error)}</p>
<button class="btn secondary" data-action="refresh">Try Again</button>
${s.viaSignIn ? '<p class="center"><button class="link" data-action="switchProject">Sign in again</button></p>' : ''}
${footer()}`;
  }

  const steps = [
    step(true, 'Connected', `This folder is linked to <b>${name}</b>.`, ''),
    step(
      !s.needsProjectSetup,
      'Set up your project',
      'Add your site and a few project details so Rampify can scan and research it. Opens in your browser; there\u2019s a button to come back here.',
      button('openSetup', 'Set Up Project')
    ),
    step(
      s.aiToolConnected ?? s.mcpConfigured,
      'Connect your AI tool',
      s.mcpConfigured && s.aiToolConnected === false
        ? 'Rampify is in your MCP config. Open your AI tool and approve Rampify\u2019s sign-in; this step completes once it connects.'
        : 'Give Claude Code, Cursor, or Copilot access to Rampify over MCP.',
      button('setupMcp', 'Set Up MCP')
    ),
    step(
      s.specCount > 0,
      'Create your first spec',
      `Ask your AI: <q>${escapeHtml(STARTER_PROMPT)}</q> Specs show up here as they're created.`,
      button('copyPrompt', 'Copy Prompt')
    ),
  ];
  const done = steps.filter((x) => x.done).length;
  // The first unfinished step is the one to act on; later ones stay quiet.
  const firstOpen = steps.findIndex((x) => !x.done);

  return `
<h2>Get set up</h2>
<p class="lead">${done} of ${steps.length} done for ${name}.</p>
<ol class="steps">
  ${steps.map((x, i) => x.render(i === firstOpen)).join('\n')}
</ol>
${footer()}`;
}

function footer(): string {
  return `
<div class="footer">
  <button class="link" data-action="openDashboard">Open dashboard</button>
  <span>·</span>
  <button class="link" data-action="switchProject">Switch project</button>
  <span>·</span>
  <button class="link" data-action="openDocs">Docs</button>
</div>`;
}

function prop(icon: string, title: string, text: string): string {
  return `<li class="prop">${icon}<div><b>${title}</b><span>${text}</span></div></li>`;
}

function step(done: boolean, title: string, text: string, action: string) {
  return {
    done,
    render: (isNext: boolean) => `
  <li class="step ${done ? 'done' : isNext ? 'next' : ''}">
    <span class="mark">${done ? ICON.tick : ''}</span>
    <div>
      <b>${title}</b>
      ${done && !isNext ? '' : `<span>${text}</span>`}
      ${!done && isNext && action ? action : ''}
    </div>
  </li>`,
  };
}

function button(action: string, label: string): string {
  return `<button class="btn small" data-action="${action}">${label}</button>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** resources/icon.svg inline, so the "R" takes the theme's text color. */
const LOGO = `<svg class="logo" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><g transform="matrix(1.2092783,0,0,1.2092783,-119.55247,-159.47149)"><g transform="translate(-38.575944,-17.089951)"><path fill="currentColor" d="m 142.9,149.93821 h 7.08174 c 0.82682,0 1.58336,0.12402 2.26963,0.37207 0.68626,0.24805 1.27744,0.59945 1.77353,1.0542 0.49609,0.44648 0.88057,0.97978 1.15342,1.5999 0.27285,0.62012 0.40928,1.30225 0.40928,2.04639 0,0.66145 -0.10335,1.29811 -0.31006,1.90996 -0.20671,0.61185 -0.50023,1.17822 -0.88057,1.69912 -0.38034,0.51263 -0.84749,0.96738 -1.40146,1.36426 -0.54571,0.39687 -1.15756,0.70693 -1.83555,0.93017 l 2.45566,6.92051 h -4.03076 l -2.1332,-6.48643 h -3.1998 l -1.38907,6.48643 h -3.77031 z m 1.93477,8.53281 h 3.27421 c 0.54571,0 1.0418,-0.0744 1.48828,-0.22324 0.45475,-0.1571 0.84336,-0.37207 1.16582,-0.64492 0.32247,-0.28112 0.57051,-0.61185 0.74414,-0.99219 0.17363,-0.38034 0.26045,-0.80202 0.26045,-1.26504 0,-0.76068 -0.23151,-1.34772 -0.69453,-1.76113 -0.46302,-0.41341 -1.11208,-0.62012 -1.94717,-0.62012 h -3.07577 z"/><path fill="var(--accent)" d="m 155.63127,164.91051 -0.0434,2.92428 h -16.49539 z"/></g></g></svg>`;

const svg = (d: string) =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const ICON = {
  data: svg('<path d="M3 3v18h18"/><path d="M7 16l4-4 3 3 5-6"/>'),
  spec: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>'),
  check: svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>'),
  tick: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>`,
};

const CSS = `
:root { --accent: #38bdf8; }
body.vscode-light { --accent: #0369a1; }
body.vscode-high-contrast { --accent: var(--vscode-textLink-foreground); }
* { box-sizing: border-box; }
body { margin: 0; padding: 14px 16px 20px; font-family: var(--vscode-font-family); font-size: 13px; line-height: 1.5; color: var(--vscode-foreground); }
.brand { display: flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--vscode-descriptionForeground); }
h1 { font-size: 21px; line-height: 1.2; font-weight: 700; letter-spacing: -.015em; margin: 16px 0 8px; }
h2 { font-size: 15px; font-weight: 600; margin: 16px 0 4px; }
.accent { color: var(--accent); }
.lead { margin: 0 0 16px; color: var(--vscode-descriptionForeground); }
.props { list-style: none; padding: 0; margin: 0 0 20px; display: grid; gap: 12px; }
.prop { display: grid; grid-template-columns: 16px 1fr; gap: 10px; }
.prop svg { color: var(--accent); margin-top: 2px; }
.prop b, .step b { display: block; font-weight: 600; }
.prop span, .step span { display: block; color: var(--vscode-descriptionForeground); }
.btn { display: block; width: 100%; padding: 7px 12px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 4px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); font: inherit; font-weight: 600; text-align: center; cursor: pointer; }
.btn:hover { background: var(--vscode-button-hoverBackground); }
.btn:focus-visible, .link:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
.btn.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
.btn.small { display: inline-block; width: auto; margin-top: 8px; padding: 4px 12px; font-weight: 500; }
.hint { margin: 8px 0 0; font-size: 12px; text-align: center; color: var(--vscode-descriptionForeground); }
.center { text-align: center; margin: 10px 0 0; }
.small { font-size: 12px; color: var(--vscode-descriptionForeground); }
.link { padding: 0; border: 0; background: none; font: inherit; color: var(--vscode-textLink-foreground); cursor: pointer; }
.link:hover { text-decoration: underline; color: var(--vscode-textLink-activeForeground); }
.steps { list-style: none; padding: 0; margin: 0 0 18px; display: grid; gap: 4px; }
.step { display: grid; grid-template-columns: 20px 1fr; gap: 10px; padding: 8px 8px 8px 6px; border-radius: 6px; }
.step.next { background: var(--vscode-list-hoverBackground); }
.step:not(.done):not(.next) { opacity: .7; }
.mark { width: 18px; height: 18px; margin-top: 1px; border-radius: 50%; border: 1.5px solid var(--vscode-descriptionForeground); display: grid; place-items: center; }
.step.next .mark { border-color: var(--accent); }
.step.done .mark { border-color: var(--accent); background: var(--accent); color: var(--vscode-sideBar-background, #1e1e1e); }
.step.done b { color: var(--vscode-descriptionForeground); font-weight: 500; }
q { font-style: italic; quotes: '“' '”'; }
.error { color: var(--vscode-errorForeground); margin: 4px 0 12px; }
.footer { display: flex; flex-wrap: wrap; gap: 6px; font-size: 12px; color: var(--vscode-descriptionForeground); border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,.25)); padding-top: 12px; }
`;
