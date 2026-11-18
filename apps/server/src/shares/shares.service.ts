import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface Share {
  id: string;
  name: string;
  description: string;
  notes: string;
  design: unknown;
  scenario: unknown;
  createdAt: string;
}

/** 12 url-safe chars ≈ 72 bits: unguessable enough for unlisted links. */
export const SHARE_ID = /^[A-Za-z0-9_-]{12}$/;

/**
 * Immutable snapshots of a Studio project, one JSON file each. A share is a
 * copy, not a live document: whoever opens the link gets their own project.
 */
@Injectable()
export class SharesService {
  readonly dir = process.env.SHARES_DIR ?? resolve(process.cwd(), 'data/shares');

  create(data: Omit<Share, 'id' | 'createdAt'>): Share {
    mkdirSync(this.dir, { recursive: true });
    let id: string;
    do id = randomBytes(9).toString('base64url');
    while (existsSync(this.file(id)));
    const share: Share = { id, ...data, createdAt: new Date().toISOString() };
    writeFileSync(this.file(id), JSON.stringify(share), { flag: 'wx' });
    return share;
  }

  get(id: string): Share {
    if (!SHARE_ID.test(id) || !existsSync(this.file(id))) throw new NotFoundException(`share ${id} not found`);
    return JSON.parse(readFileSync(this.file(id), 'utf8')) as Share;
  }

  private file(id: string) {
    return join(this.dir, `${id}.json`);
  }
}
