/**
 * Rampify's Claude rules file (.claude/rules/rampify.md) is Rampify's to keep
 * current (spec 949a2dd2). Every rules text Rampify has shipped is listed here
 * by hash, so an existing file can be told apart: the current text, an older
 * one nobody edited (Rampify replaces it), or one someone edited (Rampify asks
 * first). tests/unit/vscode-rules-template-sync.test.ts fails when the
 * template changes and its hash isn't added here, and keeps this file the same
 * in the extension and the CLI.
 */
import { createHash } from 'crypto';

/** sha256 of each shipped template, oldest first (line endings normalised to \n). */
export const RULES_VERSIONS = [
  '7a3402dac9a08c7326dac24f27e37c96b0b30455f924f8264516a71110caa7ee',
  '178b3bbb942096ec82733699f3610a06e9c09661f648c4a3c6e7f5a1a7b4a4b1',
  '393229f6aa12d46b78b3678377fdfca60908da304fc83aabcab4aafba0a4215b',
] as const;

export type RulesState = 'current' | 'outdated' | 'edited';

export function rulesHash(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
}

/** Where an existing rules file stands against the template this build ships. */
export function rulesState(existing: string, template: string): RulesState {
  const hash = rulesHash(existing);
  if (hash === rulesHash(template)) return 'current';
  return (RULES_VERSIONS as readonly string[]).includes(hash) ? 'outdated' : 'edited';
}
