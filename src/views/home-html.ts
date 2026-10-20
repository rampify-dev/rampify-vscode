import type { SetupSnapshot } from './setup-state';
import { sidebarSteps, type SidebarStep } from './setup-steps';

/**
 * HTML for the Home panel. Pure (no vscode import) so it can be rendered and
 * screenshotted outside the editor. Colors come from the editor theme's CSS
 * variables; the accent matches rampify.dev's brand blue.
 */

export const STARTER_PROMPT =
  'Use Rampify to scan my site and create specs for the most important issues you find.';

/** First-spec prompt when there's no live site to scan (or nothing typed in the box). */
export const BUILD_PROMPT =
  'Use Rampify to write a spec for the next feature I\u2019m building in this project.';

/** "Use Rampify to write a spec for: <what they typed>". */
export function specPromptFor(what: string): string {
  return `Use Rampify to write a spec for: ${what.trim()}`;
}

/** Transient panel state the provider holds between renders. */
export type HomeNotice =
  | { kind: 'unreachable'; domain: string }
  | { kind: 'error'; step: SidebarStep; message: string };

export interface HomeHtmlOptions {
  nonce: string;
  /** The editor's name, e.g. "VS Code" or "Cursor". */
  editorName?: string;
  notice?: HomeNotice | null;
  /** The project step's form is open on a finished step ("Edit"). */
  editingProject?: boolean;
  /** A save or scan request is in flight for this step. */
  busy?: SidebarStep | null;
}

export function renderHomeHtml(s: SetupSnapshot, o: HomeHtmlOptions): string {
  const body = !s.signedIn
    ? signedOut()
    : !s.hasFolder
      ? noFolder()
      : !s.clientId
        ? noProject()
        : checklist(s, o);

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
<script nonce="${o.nonce}">${SCRIPT}</script>
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

function checklist(s: SetupSnapshot, o: HomeHtmlOptions): string {
  const name = escapeHtml(s.projectName ?? 'your project');
  if (s.error) {
    return `
<h2>${name}</h2>
<p class="error">${escapeHtml(s.error)}</p>
<button class="btn secondary" data-action="refresh">Try Again</button>
${s.viaSignIn ? '<p class="center"><button class="link" data-action="switchProject">Sign in again</button></p>' : ''}
${footer()}`;
  }

  const p = s.project;
  const ids = sidebarSteps(s.needsProjectSetup ? null : p?.type ?? null, s.needsProjectSetup ? null : p?.startingPoint ?? null);
  const steps = [
    step('connected', true, false, 'Connected', `This folder is linked to <b>${name}</b>.`, ''),
    ...ids.map((id) => buildStep(id, s, o)),
  ];
  const done = steps.filter((x) => x.done).length;
  // The first step that's neither done nor skipped is the one to act on.
  const firstOpen = steps.findIndex((x) => !x.done && !x.skipped);
  const allSettled = firstOpen === -1;

  return `
<h2>${allSettled ? 'You\u2019re set up' : 'Get set up'}</h2>
<p class="lead">${done} of ${steps.length} done for ${name}.</p>
<ol class="steps">
  ${steps.map((x, i) => x.render(i === firstOpen || (x.id === 'project' && !!o.editingProject))).join('\n')}
</ol>
<p class="small more">More setup in the dashboard (business profile, launch stage): <button class="link" data-action="openSetup">open it</button></p>
${footer(true)}`;
}

function buildStep(id: SidebarStep, s: SetupSnapshot, o: HomeHtmlOptions) {
  const skipped = s.skipped.includes(id);
  const domain = escapeHtml(s.project?.domain ?? 'your site');
  const busy = o.busy === id;
  const err = o.notice?.kind === 'error' && o.notice.step === id ? `<p class="error">${escapeHtml(o.notice.message)}</p>` : '';
  switch (id) {
    case 'project': {
      const done = !s.needsProjectSetup && !o.editingProject;
      return step(id, done, skipped && s.needsProjectSetup, 'Your project',
        done ? projectSummary(s) : '',
        `${projectForm(s, o)}${err}`,
        done ? '<button class="link inline" data-action="editProject">Edit</button>' : '');
    }
    case 'scan':
      return step(id, s.scan === 'done', skipped, 'Scan your site',
        s.scan === 'running'
          ? `Scanning ${domain}. This takes a few minutes; specs for what it finds show up here.`
          : s.scan === 'failed'
            ? `The last scan of ${domain} didn\u2019t finish.`
            : `Rampify crawls ${domain} and turns what it finds into specs.`,
        s.scan === 'running'
          ? '<p class="status">Scanning\u2026</p>'
          : `${button('startScan', busy ? 'Starting\u2026' : s.scan === 'failed' ? 'Scan Again' : 'Scan Site', busy)}${skipLink(id)}${err}`);
    case 'gsc_recommended':
    case 'gsc_optional': {
      const optional = id === 'gsc_optional';
      const done = s.gsc.connected && s.gsc.hasProperty;
      if (s.gsc.connected && !s.gsc.hasProperty) {
        return step(id, false, skipped, 'Connect Google Search Console',
          `Search Console is connected. Pick the property for ${domain} to start syncing.`,
          `${button('openGscPage', 'Pick Property')}${skipLink(id)}`);
      }
      return step(id, done, skipped, optional ? 'Connect Search Console (optional)' : 'Connect Google Search Console',
        optional
          ? 'Set it up now so search data starts collecting the day you launch.'
          : 'See what people search to find you. Without it, Rampify can\u2019t see your rankings or clicks.',
        `${button('connectGsc', 'Connect Search Console')}
      <p class="small"><button class="link" data-toggle="gsc-help">I don\u2019t have it set up yet</button></p>
      <div id="gsc-help" class="help" hidden>
        <span>Search Console is Google\u2019s free tool for your site\u2019s search data. Add ${domain} there and verify it (a few minutes), then come back and connect.</span>
        <button class="btn small secondary" data-action="openGscHelp">Open Search Console</button>
      </div>${skipLink(id)}`);
    }
    case 'ai_tool':
      return step(id, s.aiToolConnected ?? s.mcpConfigured, skipped, 'Connect your AI tool',
        s.mcpConfigured && s.aiToolConnected === false
          ? 'Rampify is in your MCP config. Open your AI tool and approve Rampify\u2019s sign-in; this step completes once it connects.'
          : 'Give Claude Code, Cursor, or Copilot access to Rampify over MCP.',
        `${button('setupMcp', 'Set Up MCP')}${skipLink(id)}`);
    case 'first_spec': {
      const canScan = s.project?.startingPoint === 'live_site' && s.project?.type === 'website';
      return step(id, s.specCount > 0, skipped, 'Your first spec',
        'Specs show up here as they\u2019re created.',
        `<label class="field">What are you building next?
        <textarea id="spec-what" rows="2" placeholder="e.g. a pricing page with three tiers"></textarea></label>
      ${button('copySpecPrompt', 'Copy Prompt for Your AI')}
      ${canScan ? `<p class="small">Or ask it to scan: <button class="link" data-action="copyPrompt">copy the scan prompt</button></p>` : ''}${skipLink(id)}`);
    }
  }
}

function projectSummary(s: SetupSnapshot): string {
  const p = s.project;
  if (!p) { return ''; }
  const name = escapeHtml(p.name ?? s.projectName ?? '');
  if (p.type === 'app') { return `${name} \u00b7 App`; }
  const where = p.startingPoint === 'live_site'
    ? `live at ${escapeHtml(p.domain ?? '')}`
    : p.startingPoint === 'domain_only' ? `${escapeHtml(p.domain ?? 'domain')}, not live yet` : 'not live yet';
  return `${name} \u00b7 Website, ${where}`;
}

function projectForm(s: SetupSnapshot, o: HomeHtmlOptions): string {
  const p = s.project;
  const name = escapeHtml(p?.name ?? s.folderName ?? '');
  const type = p?.type ?? 'website';
  const sp = p?.startingPoint ?? '';
  const domain = escapeHtml(p?.domain ?? '');
  const busy = o.busy === 'project';
  const radio = (group: string, value: string, label: string, checked: boolean) =>
    `<label class="choice"><input type="radio" name="${group}" value="${value}"${checked ? ' checked' : ''}> ${label}</label>`;
  const unreachable = o.notice?.kind === 'unreachable'
    ? `<div class="warn"><span>We couldn\u2019t reach ${escapeHtml(o.notice.domain)}. Is it live yet?</span>
      <button class="btn small secondary" data-action="saveNotLive">Save as Not Live Yet</button>
      <button class="link inline" data-action="saveAnyway">It\u2019s live, save anyway</button></div>`
    : '';
  return `<form id="project-form" data-client="${escapeHtml(s.clientId ?? '')}">
      <label class="field">Name<input name="name" value="${name}" maxlength="100" required></label>
      <fieldset><legend>What is it?</legend>${radio('type', 'website', 'Website', type === 'website')}${radio('type', 'app', 'App', type === 'app')}</fieldset>
      <fieldset class="site-q"><legend>Is your site live?</legend>
        ${radio('sp', 'idea', 'Not yet, just building', sp === 'idea')}
        ${radio('sp', 'domain_only', 'I have a domain, not live yet', sp === 'domain_only')}
        ${radio('sp', 'live_site', 'It\u2019s live', sp === 'live_site')}
      </fieldset>
      <label class="field url">Site<input name="domain" value="${domain}" placeholder="example.com" autocomplete="off"></label>
      <p class="error" id="form-error" hidden></p>
      ${unreachable}
      <button type="submit" class="btn small"${busy ? ' disabled' : ''}>${busy ? 'Saving\u2026' : 'Save'}</button>
      ${o.editingProject ? '<button type="button" class="link inline" data-action="cancelEdit">Cancel</button>' : skipLink('project', true)}
    </form>`;
}

function skipLink(id: SidebarStep, inline = false): string {
  return inline
    ? `<button type="button" class="link inline skip" data-action="skip" data-arg="${id}">Skip for now</button>`
    : `<p class="small skip"><button class="link" data-action="skip" data-arg="${id}">Skip for now</button></p>`;
}

function footer(showSpecs = false): string {
  return `
<div class="footer">
  ${showSpecs ? '<button class="link" data-action="showSpecs">Show specs</button><span>\u00b7</span>' : ''}
  <button class="link" data-action="openDashboard">Open dashboard</button>
  <span>\u00b7</span>
  <button class="link" data-action="switchProject">Switch project</button>
  <span>\u00b7</span>
  <button class="link" data-action="openDocs">Docs</button>
</div>`;
}

function prop(icon: string, title: string, text: string): string {
  return `<li class="prop">${icon}<div><b>${title}</b><span>${text}</span></div></li>`;
}

function step(id: SidebarStep | 'connected', done: boolean, skipped: boolean, title: string, text: string, action: string, titleExtra = '') {
  return {
    id,
    done,
    skipped: skipped && !done,
    render: (isNext: boolean) => {
      const state = done && !isNext ? 'done' : skipped && !done ? 'skipped' : isNext ? 'next' : '';
      return `
  <li class="step ${state}">
    <span class="mark">${done && !isNext ? ICON.tick : ''}</span>
    <div>
      <b>${title}${titleExtra ? ` ${titleExtra}` : ''}</b>
      ${state === 'skipped'
        ? `<span>Skipped \u00b7 <button class="link inline" data-action="unskip" data-arg="${id}">Undo</button></span>`
        : done && !isNext ? (text ? `<span>${text}</span>` : '') : text ? `<span>${text}</span>` : ''}
      ${isNext && action ? action : ''}
    </div>
  </li>`;
    },
  };
}

function button(action: string, label: string, disabled = false): string {
  return `<button class="btn small" data-action="${action}"${disabled ? ' disabled' : ''}>${label}</button>`;
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

/**
 * Webview script: actions post {action, arg}; the project form posts its
 * fields; "I don't have it set up yet" toggles help locally. Typed text is
 * kept in webview state so a background refresh doesn't wipe it.
 */
const SCRIPT = `
const vscode = acquireVsCodeApi();
const saved = vscode.getState() || {};
const form = document.getElementById('project-form');
const specWhat = document.getElementById('spec-what');

function syncForm() {
  if (!form) { return; }
  const type = form.querySelector('input[name=type]:checked')?.value;
  const sp = form.querySelector('input[name=sp]:checked')?.value;
  form.querySelector('.site-q').hidden = type !== 'website';
  form.querySelector('.url').hidden = type !== 'website' || !(sp === 'domain_only' || sp === 'live_site');
}
function formData() {
  const get = (n) => form.querySelector('[name=' + n + ']');
  return {
    name: get('name').value.trim(),
    type: form.querySelector('input[name=type]:checked')?.value,
    sp: form.querySelector('input[name=sp]:checked')?.value || null,
    domain: get('domain').value.trim(),
  };
}
function persist() {
  const state = { client: form?.dataset.client };
  if (form) { state.form = formData(); }
  if (specWhat) { state.specWhat = specWhat.value; }
  vscode.setState(state);
}

if (form && saved.form && saved.client === form.dataset.client) {
  const f = saved.form;
  form.querySelector('[name=name]').value = f.name || '';
  form.querySelector('[name=domain]').value = f.domain || '';
  for (const [group, value] of [['type', f.type], ['sp', f.sp]]) {
    const el = value && form.querySelector('input[name=' + group + '][value=' + value + ']');
    if (el) { el.checked = true; }
  }
}
if (specWhat && saved.specWhat) { specWhat.value = saved.specWhat; }
syncForm();

document.addEventListener('input', () => { syncForm(); persist(); });
document.addEventListener('change', () => { syncForm(); persist(); });

form?.addEventListener('submit', (e) => {
  e.preventDefault();
  const d = formData();
  const err = document.getElementById('form-error');
  const needsSite = d.type === 'website' && (d.sp === 'domain_only' || d.sp === 'live_site');
  const problem = !d.name ? 'Give the project a name.'
    : d.type === 'website' && !d.sp ? 'Choose whether your site is live.'
    : needsSite && !d.domain ? 'Add your site\\u2019s address, e.g. example.com.'
    : '';
  err.hidden = !problem;
  err.textContent = problem;
  if (!problem) { vscode.postMessage({ action: 'saveProject', data: d }); }
});

document.addEventListener('click', (e) => {
  const toggle = e.target.closest('[data-toggle]');
  if (toggle) {
    const el = document.getElementById(toggle.dataset.toggle);
    if (el) { el.hidden = !el.hidden; }
    return;
  }
  const el = e.target.closest('[data-action]');
  if (!el) { return; }
  const msg = { action: el.dataset.action, arg: el.dataset.arg };
  if (msg.action === 'copySpecPrompt') { msg.arg = specWhat ? specWhat.value : ''; }
  if (msg.action === 'saveNotLive' || msg.action === 'saveAnyway') { msg.data = formData(); }
  vscode.postMessage(msg);
});
`;

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
.prop b, .step > div > b { display: block; font-weight: 600; }
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
.step.done > div > b { color: var(--vscode-descriptionForeground); font-weight: 500; }
q { font-style: italic; quotes: '“' '”'; }
.error { color: var(--vscode-errorForeground); margin: 4px 0 12px; }
.field { display: grid; gap: 4px; margin: 8px 0 0; color: var(--vscode-descriptionForeground); }
.field input, .field textarea { width: 100%; padding: 4px 6px; border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); font: inherit; resize: vertical; }
.field input:focus, .field textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
fieldset { border: 0; padding: 0; margin: 10px 0 0; display: grid; gap: 2px; }
legend { padding: 0; margin-bottom: 2px; color: var(--vscode-descriptionForeground); }
.choice { display: flex; gap: 6px; align-items: center; cursor: pointer; }
.choice input { margin: 0; accent-color: var(--accent); }
form .btn.small { margin-top: 10px; }
.link.inline { margin-left: 10px; font-size: 12px; }
.step .link.inline { margin-left: 6px; }
.skip { margin: 6px 0 0; }
.help { display: grid; gap: 6px; margin: 6px 0 0; padding: 8px; border-radius: 4px; background: var(--vscode-textBlockQuote-background, rgba(128,128,128,.1)); }
.help[hidden], [hidden] { display: none !important; }
.warn { display: grid; gap: 6px; margin: 10px 0 0; padding: 8px; border-radius: 4px; border: 1px solid var(--vscode-inputValidation-warningBorder, #b89500); }
.status { margin: 6px 0 0; color: var(--accent); }
.step.skipped { opacity: .6; }
.more { margin: 0 0 12px; }
.btn[disabled] { opacity: .6; cursor: default; }
.footer { display: flex; flex-wrap: wrap; gap: 6px; font-size: 12px; color: var(--vscode-descriptionForeground); border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,.25)); padding-top: 12px; }
`;
