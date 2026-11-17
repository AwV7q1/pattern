import type { Level, Preset } from './types';

// The same files are used by the CLI (`pnpm sim examples/*.json`), the engine
// tests (levels) and the NestJS server (levels), so there is one source of truth.
const examples = import.meta.glob<Preset>('../../../examples/*.json', { eager: true, import: 'default' });
const levels = import.meta.glob<Level>('../../../levels/*.json', { eager: true, import: 'default' });

const byFile = <T,>(files: Record<string, T>) =>
  Object.keys(files)
    .sort()
    .map((path) => [path.split('/').pop()!.replace('.json', ''), files[path]] as const);

export const PRESETS: Record<string, Preset> = Object.fromEntries(byFile(examples));
export const LEVELS: Record<string, Level> = Object.fromEntries(byFile(levels));
