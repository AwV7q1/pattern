import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface LevelFile {
  id: string;
  title: string;
  brief: string;
  hint?: string;
  palette: string[];
  locked: string[];
  design: unknown;
  scenario: unknown;
  [key: string]: unknown;
}

/** Levels live in the repo's `levels/` folder, shared with the web app. */
@Injectable()
export class LevelsService implements OnModuleInit {
  private levels = new Map<string, { level: LevelFile; json: string }>();
  readonly dir = process.env.LEVELS_DIR ?? resolve(__dirname, '../../../../levels');

  onModuleInit() {
    for (const file of readdirSync(this.dir).filter((f) => f.endsWith('.json')).sort()) {
      const json = readFileSync(join(this.dir, file), 'utf8');
      const level = JSON.parse(json) as LevelFile;
      this.levels.set(level.id, { level, json });
    }
  }

  list() {
    return [...this.levels.values()].map(({ level }) => ({ id: level.id, title: level.title }));
  }

  get(id: string) {
    const entry = this.levels.get(id);
    if (!entry) throw new NotFoundException(`level '${id}' not found`);
    return entry;
  }
}
