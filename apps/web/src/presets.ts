import type { Preset } from './types';
import noCache from '../../../examples/01-no-cache.json';
import cacheAside from '../../../examples/02-cache-aside.json';
import readReplicas from '../../../examples/03-read-replicas.json';
import queueLeveling from '../../../examples/04-queue-leveling.json';

// The same scenario files are used by the CLI (`pnpm sim examples/*.json`).
export const PRESETS: Record<string, Preset> = {
  'no-cache': noCache as Preset,
  'cache-aside': cacheAside as Preset,
  'read-replicas': readReplicas as Preset,
  'queue-leveling': queueLeveling as Preset,
};
