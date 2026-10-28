import type { AiTool, EditorKind, SetupSnapshot } from './setup-snapshot';
import { claudePromptCommand, GET_STARTED_PROMPT, vscodePromptCommand } from '../mcp/prompt-names';
import { setupSettled, sidebarSteps, stepDone, stepInputs, stepSkipped, tidyFolderName, type OnboardingStep, type SidebarStep, type StepInputs } from './setup-steps';

/**
 * HTML for the Home panel. Pure (no vscode import) so it can be rendered and
 * screenshotted outside the editor. Colors come from the editor theme's CSS
 * variables; the accent matches rampify.dev's brand blue.
 */

/** Transient panel state the provider holds between renders. */
export type HomeNotice =
  | { kind: 'error'; step: SidebarStep; message: string };

export interface HomeHtmlOptions {
  nonce: string;
  /** The editor's name, e.g. "VS Code" or "Cursor". */
  editorName?: string;
  notice?: HomeNotice | null;
  /** The site step's form is open on a finished step ("Change"). */
  editingProject?: boolean;
  /** A save or scan request is in flight for this step. */
  busy?: SidebarStep | null;
  /** Steps put off for now ("No site yet"): not offered as next until picked up again. */
  later?: readonly SidebarStep[];
}

export function renderHomeHtml(s: SetupSnapshot, o: HomeHtmlOptions): string {
  const body = s.signInPhase === 'finishing'
    ? signingIn()
    : !s.signedIn
    ? signedOut(s.hasFolder, s.signInPhase)
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

/** The browser handed back: linking the folder and loading its checklist. */
function signingIn(): string {
  return `
<h2>Signing you in\u2026</h2>
<p class="lead"><span class="spinner"></span>Linking this folder to your project and loading its setup. This takes a few seconds.</p>`;
}

function signedOut(hasFolder: boolean, phase: SetupSnapshot['signInPhase'] = 'idle'): string {
  // Each folder links to one Rampify project, so with no folder open the
  // first step is opening one; sign-in picks up after the window reloads.
  const waiting = phase === 'browser'
    ? `<button class="btn" disabled><span class="spinner"></span>Waiting for your browser\u2026</button>
<p class="hint">Finish signing in (or creating your account) in the browser. This panel updates as soon as you do.</p>
<p class="center small"><button class="link" data-action="signIn">Reopen the page</button> \u00b7 <button class="link" data-action="signInWithCode">Sign in with a code</button> \u00b7 <button class="link" data-action="cancelSignIn">Cancel</button></p>`
    : phase === 'code'
      ? `<button class="btn" disabled><span class="spinner"></span>Waiting for you to confirm the code\u2026</button>
<p class="hint">Confirm the code in your browser. This panel updates as soon as you do.</p>`
      : '';
  const actions = waiting || (hasFolder
    ? `<button class="btn" data-action="signIn">Sign in with Rampify</button>
<p class="hint">New to Rampify? This creates a free account.</p>
<p class="center small"><button class="link" data-action="signInWithCode">Sign in with a code</button> \u00b7 <button class="link" data-action="useApiKey">Use an API key</button></p>`
    : `<button class="btn" data-action="openFolderThenSignIn">Open Your Project Folder</button>
<p class="hint">Rampify links each project folder to a Rampify project. After it opens, you\u2019ll sign in (or create a free account).</p>
<p class="center small"><button class="link" data-action="newProjectThenSignIn">Start a new project</button> \u00b7 <button class="link" data-action="signInWithCode">Sign in with a code</button></p>`);
  return `
<h1>Turn your coding agent into a <span class="accent">marketing agent</span></h1>
<p class="lead">Rampify gives the AI you already code with real search data, specs to build against, and a scan that checks the work.</p>
<ul class="props">
  ${prop(ICON.data, 'Real data, not guesses', 'Keyword volumes, Search Console, and how AI models describe your category.')}
  ${prop(ICON.spec, 'Specs your AI builds against', 'Rampify turns site scans and Discovery research into specs with the fix spelled out.')}
  ${prop(ICON.check, 'Every fix verified', 'The next scan confirms the change worked, so nothing ships on a guess.')}
</ul>
${actions}`;
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
<button class="btn" data-action="linkProject">Link a Project</button>`;
}

function checklist(s: SetupSnapshot, o: HomeHtmlOptions): string {
  const name = escapeHtml(s.projectName ?? 'your project');
  if (s.error) {
    return `
<h2>${name}</h2>
<p class="error">${escapeHtml(s.error)}</p>
<button class="btn secondary" data-action="refresh">Try Again</button>
${s.viaSignIn ? '<p class="center"><button class="link" data-action="switchProject">Sign in again</button></p>' : ''}`;
  }

  // The steps are the server's onboarding (the same on the web and in the AI
  // tool), then "Your first spec".
  const inputs = stepInputs(s);
  const steps = [
    step('connected', true, false, 'Connected', `This folder is linked to <b>${name}</b>.`, ''),
    ...sidebarSteps(s.onboarding).map((id) => buildStep(id, s, o, inputs)),
  ];
  const done = steps.filter((x) => x.done).length;
  // One step in focus at a time: the first that's neither done, skipped nor
  // put off; when every step is settled, the first that needs a look (a scan
  // that failed or never ran, which also has its own "Scan again" link).
  const later = o.later ?? [];
  const firstOpen = steps.findIndex((x) => !x.done && !x.skipped && !later.includes(x.id as SidebarStep));
  const focus = firstOpen !== -1 ? firstOpen : steps.findIndex((x) => x.active);
  const allSettled = setupSettled(inputs);

  return `
<h2>${allSettled ? 'You\u2019re set up' : 'Get set up'}</h2>
<p class="lead">${done} of ${steps.length} done for ${name}.</p>
<ol class="steps"${stepDone('site', inputs) ? ' data-site-saved="1"' : ''}>
  ${steps.map((x, i) => x.render(i === focus || (x.id === 'site' && !!o.editingProject))).join('\n')}
</ol>`;
}

function buildStep(id: OnboardingStep, s: SetupSnapshot, o: HomeHtmlOptions, inputs: StepInputs) {
  const skipped = stepSkipped(id, inputs);
  const domain = escapeHtml(s.project?.domain ?? 'your site');
  const busy = o.busy === id;
  const err = o.notice?.kind === 'error' && o.notice.step === id ? `<p class="error">${escapeHtml(o.notice.message)}</p>` : '';
  switch (id) {
    case 'site': {
      const hasSite = stepDone('site', inputs) && !o.editingProject;
      if (!hasSite) {
        if (o.later?.includes('site') && !o.editingProject) {
          return step(id, false, false, 'Add your website', 'No site yet. Rampify can\u2019t look at your search presence until you add one.', '',
            '<button class="link inline" data-action="unlater" data-arg="site">Add it now</button>');
        }
        return step(id, false, false, 'Add your website', 'The website you want people to find: your product\u2019s or company\u2019s site. Rampify scans it in the background while you connect your AI tool.',
          `${siteForm(s, o)}${err}${o.editingProject ? '' : '<p class="small"><button class="link" data-action="later" data-arg="site">No site yet? Continue without one</button></p>'}`);
      }
      // The site is in: its scan's state, and what to do when it didn't finish.
      const found = s.scanSpecCount > 0
        ? ` Found ${s.scanSpecCount} ${s.scanSpecCount === 1 ? 'issue' : 'issues'}, filed as specs. <button class="link inline" data-action="showSpecs">View</button>`
        : '';
      // A site can be changed here until a scan has found its pages; replacing a
      // scanned site clears its scan, so that's done on purpose in the dashboard.
      const change = '<button class="link inline" data-action="editProject">Change</button>';
      if (s.scan === 'running') {
        return step(id, true, false, 'Add your website', `${domain} \u00b7 Scanning in the background. Specs for what it finds show up in your specs list.`, '');
      }
      if (s.scan === 'failed' || s.scan === 'none') {
        const why = s.scan === 'failed'
          ? s.scanFailure ? `${escapeHtml(s.scanFailure.summary)} ${escapeHtml(s.scanFailure.nextStep)}` : `The last scan of ${domain} didn\u2019t finish.`
          : `${domain} hasn\u2019t been scanned yet.`;
        const help = s.scanFailure?.helpUrl ? ' <button class="link inline" data-action="openCrawlerHelp">How to do it</button>' : '';
        return step(id, true, false, 'Add your website', `${why}${help}`,
          `${button('startScan', busy ? 'Starting\u2026' : s.scan === 'failed' ? 'Scan Again' : 'Scan Site', busy)}${err}`,
          // Reachable while another step has the focus.
          `${change} \u00b7 <button class="link inline" data-action="startScan">${s.scan === 'failed' ? 'Scan again' : 'Scan now'}</button>`, true);
      }
      return step(id, true, false, 'Add your website', `${domain} \u00b7 Scanned.${found}`, '');
    }
    case 'search_console': {
      const sc = s.onboarding?.facts.searchConsole ?? (s.gsc.connected ? (s.gsc.hasProperty ? 'connected' : 'needs_property') : 'none');
      if (sc === 'pending_verification') {
        // Not skippable here, as on the web: it's half done.
        return step(id, false, false, 'Connect Search Console (optional)',
          `${domain} isn\u2019t verified in Search Console yet. Finish verifying it there, then check the connection.`,
          `${button('openGscHelp', 'Open Search Console')} ${button('openGscPage', 'Check Connection')}${err}`);
      }
      if (sc === 'needs_property') {
        return step(id, false, skipped, 'Connect Search Console (optional)',
          `Search Console is connected. Pick the property for ${domain} to start syncing.`,
          `${button('openGscPage', 'Pick Property')}${err}${skipLink(id)}`);
      }
      return step(id, sc === 'connected', skipped, sc === 'needs_reauth' ? 'Reconnect Search Console' : 'Connect Search Console (optional)',
        sc === 'needs_reauth'
          ? 'The Search Console link expired, so search data stopped coming in.'
          : 'See what people search to find you. Without it, Rampify can\u2019t see your rankings or clicks.',
        `${button('connectGsc', sc === 'needs_reauth' ? 'Reconnect' : 'Connect Search Console')}
      <p class="small"><button class="link" data-toggle="gsc-help">I don\u2019t have it set up yet</button></p>
      <div id="gsc-help" class="help" hidden>
        <span>Search Console is Google\u2019s free tool for your site\u2019s search data. Add ${domain} there and verify it (a few minutes), then come back and connect.</span>
        <button class="btn small secondary" data-action="openGscHelp">Open Search Console</button>
      </div>${err}${skipLink(id)}`);
    }
    case 'ai_tool': {
      const done = stepDone('ai_tool', inputs);
      const later = '<p class="small"><button class="link" data-action="later" data-arg="ai_tool">I\u2019ll connect later</button></p>';
      if (!done && o.later?.includes('ai_tool')) {
        return step(id, false, false, 'Connect your AI tool', 'Not connected yet. Your AI tool is where you use Rampify day to day.', '',
          '<button class="link inline" data-action="unlater" data-arg="ai_tool">Connect it now</button>');
      }
      // A tool was connected from here: its next steps, open until it makes
      // its first request (the server's fact, however it got connected).
      if (!done && s.pickedAiTool) {
        return step(id, false, false, 'Connect your AI tool', `Finish connecting ${escapeHtml(TOOL_TILES[s.pickedAiTool].label)}:`,
          `${aiToolNextSteps(s, s.pickedAiTool)}${later}`, '', true);
      }
      return step(id, done, false, 'Connect your AI tool',
        'Pick the AI tool you code with. It reads and updates your specs through Rampify, for this folder\u2019s project only.',
        `${toolTiles(s)}
      <p class="small"><button class="link" data-action="setupMcp">Other tools</button></p>${later}`);
    }
    case 'first_playbook': {
      // The server's playbook and prompt (spec 73656715); an older server sends none, and then no such step either.
      const pb = s.firstPlaybook;
      const done = stepDone('first_playbook', inputs);
      const title = 'Run your first playbook';
      if (!pb) { return step(id, done, skipped, title, 'See whether AI assistants name you when buyers ask about your category.', `${skipLink(id)}`); }
      const intro = `${escapeHtml(pb.question)} Your AI tool runs Rampify\u2019s ${escapeHtml(pb.name)}: about ${pb.minutes} to 10 minutes, ending with a spec for the biggest gap.`;
      if (done) { return step(id, true, false, title, 'Done. See what AI said on Research in the Rampify dashboard.', ''); }
      if (s.onboarding?.steps.find((x) => x.step === 'first_playbook')?.detail === 'running') {
        return step(id, false, false, title, intro, '<p class="status"><span class="spinner"></span>Running in your AI tool. This step ticks when the run finishes.</p>', '', true);
      }
      return step(id, false, skipped, title, intro,
        `<div class="prompt">${escapeHtml(pb.prompt)}</div>
      ${button('runPlaybook', `Run in ${escapeHtml(s.aiToolLabel)}`)} <button class="btn small secondary" data-action="copyPlaybook">Copy</button>
      <p class="small">In Claude Code, type <code>${claudePromptCommand(pb.prompt_name)}</code>; in Copilot, <code>${vscodePromptCommand(pb.prompt_name)}</code>.</p>${err}${skipLink(id)}`);
    }
    case 'how_found': {
      const choice = (h: { value: string; label: string }) =>
        `<button class="btn small secondary" data-action="howFound" data-arg="${escapeHtml(h.value)}"${o.busy === 'how_found' ? ' disabled' : ''}>${escapeHtml(h.label)}</button>`;
      const first = s.howFoundOptions.filter((h) => !h.more).map(choice).join('');
      const more = s.howFoundOptions.filter((h) => h.more).map(choice).join('');
      return step(id, stepDone('how_found', inputs), skipped, 'How did you find Rampify?', 'One tap. It helps us know where people like you hear about us.',
        `<div class="choices">${first}</div>${more ? `
      <p class="small"><button class="link" data-toggle="how-found-more">More\u2026</button></p>
      <div id="how-found-more" class="choices" hidden>${more}</div>` : ''}${err}${skipLink(id)}`);
    }
  }
}

const TOOL_TILES: Record<AiTool, { label: string; hint: string }> = {
  copilot: { label: 'GitHub Copilot', hint: 'in VS Code' },
  cursor: { label: 'Cursor', hint: 'Cursor\u2019s agent' },
  claude: { label: 'Claude Code', hint: 'terminal or extension' },
};

/** The tools offered for each editor; the rest are under "Other tools". */
const TILES_BY_EDITOR: Record<EditorKind, readonly AiTool[]> = {
  vscode: ['copilot', 'claude'],
  cursor: ['cursor', 'claude'],
  other: ['claude'],
};

/** One click per tool this editor can use, its own first. Copilot only where it can connect. */
function toolTiles(s: SetupSnapshot): string {
  const tools = TILES_BY_EDITOR[s.editor].filter((t) => t !== 'copilot' || s.copilotReady);
  return `<div class="tiles">${tools.map((tool, i) => {
    const t = TOOL_TILES[tool];
    return `<button class="btn small tile${i === 0 ? '' : ' secondary'}" data-action="connectTool" data-arg="${tool}">${t.label}<span>${t.hint}</span></button>`;
  }).join('')}</div>`;
}

/**
 * After picking a tool, two stages (spec b312544f). First connect: start
 * Rampify in the tool and sign in. Only once the server says the tool reached
 * Rampify (onboarding's AI-tool fact) does the first prompt unlock, so it
 * never goes to an agent without Rampify's tools (that agent improvises: it
 * read the open folder's code instead, 2026-10-26).
 */
const NEXT_STEPS: Record<AiTool, {
  connect: readonly string[];
  connectAction: { action: string; label: string } | null;
  send: { action: string; label: string; where: string };
}> = {
  copilot: {
    connect: [
      'Click <b>Start Rampify</b>. Copilot asks you to authenticate once: click <b>Authenticate</b>.',
      'Sign in to Rampify in the browser, choosing this project. Close any older Rampify sign-in tabs first.',
    ],
    connectAction: { action: 'startCopilot', label: 'Start Rampify' },
    send: { action: 'sendPrompt', label: 'Send First Prompt', where: 'It opens in Copilot Chat (Agent mode). Make sure Rampify is on in the chat\u2019s tools, then send it.' },
  },
  cursor: {
    connect: [
      'Enable the Rampify server when Cursor asks (or in Cursor Settings, MCP).',
      'Sign in to Rampify when Cursor asks, choosing this project.',
    ],
    connectAction: null,
    send: { action: 'sendPrompt', label: 'Send First Prompt', where: 'It opens in Cursor\u2019s agent chat. Send it there.' },
  },
  claude: {
    connect: [
      'Click <b>Open Claude Code</b>. It starts in a terminal in this folder.',
      'Type <code>/mcp</code>, choose rampify, and sign in, choosing this project.',
    ],
    connectAction: { action: 'openClaudeCode', label: 'Open Claude Code' },
    send: { action: 'copyPrompt', label: 'Copy First Prompt', where: `In Claude Code, type <code>${claudePromptCommand(GET_STARTED_PROMPT)}</code> (Rampify\u2019s own get-started prompt), or paste this and send it.` },
  },
};

/**
 * The first prompt: the server's (lib/onboarding/first-prompt.ts). Older
 * servers don't send it; this mirrors firstPrompt() exactly (a unit test
 * keeps the two the same).
 */
export function firstPromptOf(s: SetupSnapshot): string {
  if (s.firstPrompt) { return s.firstPrompt; }
  const domain = s.project?.domain;
  const what = domain ? `Set up ${domain} with Rampify` : 'Set up my project with Rampify';
  return `${what}: call Rampify's suggest_next_action tool and follow what it returns, one step at a time, showing me anything before you save it. If you don't have Rampify's tools, stop and tell me to finish connecting Rampify.`;
}

function aiToolNextSteps(s: SetupSnapshot, tool: AiTool): string {
  const n = NEXT_STEPS[tool];
  const label = TOOL_TILES[tool].label;
  const other = '<p class="small"><button class="link" data-action="chooseOtherTool">Use a different tool</button></p>';
  // The fact isn't per tool: once any connection reaches this project, it
  // counts (and the step says "connected" without naming which).
  if (s.onboarding?.facts.aiTool !== 'connected') {
    return `<ol class="howto">${n.connect.map((x) => `<li>${x}</li>`).join('')}</ol>
      ${n.connectAction ? button(n.connectAction.action, n.connectAction.label) : ''}
      <p class="status"><span class="spinner"></span>Waiting for ${label} to connect to Rampify\u2026 The first prompt unlocks here once it does.</p>
      ${tool === 'copilot' ? '<p class="small">VS Code didn\u2019t ask you to sign in? <button class="link inline" data-action="openMcpServers">Open its MCP servers</button>, then start Rampify there.</p>' : ''}
      ${other}`;
  }
  return `<p class="status">\u2713 Connected to Rampify. Now send it this first prompt:</p>
      <div class="prompt">${escapeHtml(firstPromptOf(s))}</div>
      ${button(n.send.action, n.send.label)}${n.send.action === 'copyPrompt' ? '' : ' <button class="btn small secondary" data-action="copyPrompt">Copy</button>'}
      <p class="small">${n.send.where} This step ticks once it makes its first request.</p>
      <p class="status"><span class="spinner"></span>Waiting for its first request.</p>
      ${other}`;
}

function siteForm(s: SetupSnapshot, o: HomeHtmlOptions): string {
  const p = s.project;
  // No name yet: suggest a tidied folder name, selected so typing replaces it.
  const suggested = !p?.name;
  const name = escapeHtml(p?.name ?? tidyFolderName(s.folderName ?? ''));
  const domain = escapeHtml(p?.domain ?? '');
  const busy = o.busy === 'site';
  return `<form id="project-form" data-client="${escapeHtml(s.clientId ?? '')}">
      <label class="field url">Website address<input name="domain" value="${domain}" placeholder="yourcompany.com" autocomplete="off"></label>
      <label class="field">Project name<input name="name" value="${name}" maxlength="100"${suggested ? ' data-suggested="1"' : ''}></label>
      <p class="fine">You can rename it any time.</p>
      <p class="error" id="form-error" hidden></p>
      <button type="submit" class="btn small"${busy ? ' disabled' : ''}>${busy ? 'Saving\u2026' : 'Save and Scan'}</button>
      ${o.editingProject ? '<button type="button" class="link inline" data-action="cancelEdit">Cancel</button>' : ''}
    </form>`;
}

function skipLink(id: SidebarStep, inline = false): string {
  return inline
    ? `<button type="button" class="link inline skip" data-action="skip" data-arg="${id}">Skip for now</button>`
    : `<p class="small skip"><button class="link" data-action="skip" data-arg="${id}">Skip for now</button></p>`;
}

function prop(icon: string, title: string, text: string): string {
  return `<li class="prop">${icon}<div><b>${title}</b><span>${text}</span></div></li>`;
}

function step(
  id: SidebarStep | 'connected', done: boolean, skipped: boolean, title: string, text: string, action: string,
  titleExtra = '',
  /**
   * Something is happening here or needs a look (a scan running or failed, the
   * AI working a spec): keep it open even if it isn't next, or is done.
   */
  active = false
) {
  return {
    id,
    done,
    active,
    skipped: skipped && !done,
    render: (isNext: boolean) => {
      const state = done && !isNext ? 'done' : skipped && !done ? 'skipped' : isNext ? 'next' : '';
      return `
  <li class="step ${state}">
    <span class="mark">${done && !isNext ? ICON.tick : ''}</span>
    <div>
      <b>${title}${titleExtra ? ` ${titleExtra}` : ''}</b>
      ${state === 'skipped'
        // "How did you find us" can't be un-skipped: skipping records that they were asked.
        ? `<span>Skipped${id === 'how_found' ? '' : ` \u00b7 <button class="link inline" data-action="unskip" data-arg="${id}">Undo</button>`}</span>`
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

function formData() {
  const get = (n) => form.querySelector('[name=' + n + ']');
  return { name: get('name').value.trim(), domain: get('domain').value.trim() };
}
function persist() {
  const state = { client: form?.dataset.client };
  if (form) { state.form = formData(); }
  vscode.setState(state);
}

if (form && saved.form && saved.client === form.dataset.client) {
  const f = saved.form;
  form.querySelector('[name=name]').value = f.name || '';
  form.querySelector('[name=domain]').value = f.domain || '';
}
// The site is saved: forget what was typed, so "Change" opens on the saved site.
if (!form && saved.form && document.querySelector('[data-site-saved]')) { persist(); }
// An empty site field gets the focus.
const siteInput = form && form.querySelector('[name=domain]');
if (siteInput && !siteInput.value && !(saved.form && saved.client === form.dataset.client)) { siteInput.focus(); }

document.addEventListener('input', () => { persist(); });
document.addEventListener('change', () => { persist(); });

form?.addEventListener('submit', (e) => {
  e.preventDefault();
  const d = formData();
  const err = document.getElementById('form-error');
  const problem = !d.domain ? 'Add your site\\u2019s address, e.g. example.com.' : '';
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
.btn.small { display: inline-block; width: auto; margin-top: 8px; padding: 4px 12px; font-weight: 500; font-size: 13px; }
/* .small is also the grey fine-print helper: buttons keep the theme's button text. */
.btn.small:not(.secondary) { color: var(--vscode-button-foreground); }
.btn.small.secondary { color: var(--vscode-button-secondaryForeground); }
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
.fine { margin: 4px 0 0; font-size: 12px; color: var(--vscode-descriptionForeground); }
.tiles { display: grid; gap: 6px; margin-top: 8px; }
.spinner { display: inline-block; width: 12px; height: 12px; margin-right: 8px; vertical-align: -2px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.prompt { margin: 8px 0; padding: 8px; border-radius: 4px; background: var(--vscode-textCodeBlock-background); font-size: 12px; line-height: 1.4; white-space: pre-wrap; }
.status { display: flex; align-items: center; margin-top: 8px; font-size: 12px; color: var(--vscode-descriptionForeground); }
ol.howto { margin: 6px 0 0; padding-left: 18px; font-size: 12px; }
.choices { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.btn.tile { display: flex; justify-content: space-between; align-items: baseline; width: 100%; margin: 0; text-align: left; }
.btn.tile span { font-size: 11px; font-weight: 400; opacity: .8; }
.callout { display: grid; gap: 4px; margin: 10px 0 0; padding: 8px; border-radius: 4px; border: 1px solid var(--accent); }
.callout .btn.small { margin-top: 4px; }
.tasks { list-style: none; padding: 0; margin: 8px 0 0; display: grid; gap: 4px; }
.tasks li { display: grid; grid-template-columns: 14px 1fr; gap: 6px; align-items: center; color: var(--vscode-descriptionForeground); }
.tasks li.ok { color: var(--vscode-foreground); }
.tasks li i { font-style: normal; display: grid; place-items: center; }
.tasks li.ok svg { color: var(--accent); }
.tasks li.now { color: var(--vscode-foreground); font-weight: 600; }
code { font-family: var(--vscode-editor-font-family); font-size: 12px; }
.footer { display: flex; flex-wrap: wrap; gap: 6px; font-size: 12px; color: var(--vscode-descriptionForeground); border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,.25)); padding-top: 12px; }
`;
