import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Prisma, Project, ProjectVersion } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ProjectDto, VersionDto } from './dto';

const MAX_PROJECTS = 500;
const MAX_AUTO_VERSIONS = 50;
const json = (v: unknown) => v as Prisma.InputJsonValue;

/** Wire format, timestamps in ms like the browser store. */
export const toWire = (p: Project) => ({
  id: p.id,
  name: p.name,
  description: p.description,
  notes: p.notes,
  design: p.design,
  scenario: p.scenario,
  source: p.source ?? undefined,
  lastRun: p.lastRun ?? undefined,
  createdAt: p.createdAt.getTime(),
  updatedAt: p.updatedAt.getTime(),
  rev: p.rev,
  deleted: !!p.deletedAt,
});

const versionWire = (v: ProjectVersion) => ({
  id: v.id,
  projectId: v.projectId,
  at: v.at.getTime(),
  label: v.label ?? undefined,
  auto: v.auto,
  name: v.name,
  notes: v.notes,
  design: v.design,
  scenario: v.scenario,
});

function assertDesign(d: Record<string, unknown>) {
  if (!Array.isArray(d.nodes) || !Array.isArray(d.edges)) throw new BadRequestException('design: { nodes: [], edges: [] } required');
  if (d.nodes.length > 200 || d.edges.length > 400) throw new BadRequestException('design too large');
}

@Injectable()
export class ProjectsService {
  constructor(private readonly db: PrismaService) {}

  /** Projects changed after `since` (server clock), tombstones included. */
  async changes(ownerId: string, since?: Date) {
    const now = new Date();
    const rows = await this.db.project.findMany({
      where: { ownerId, ...(since ? { syncedAt: { gt: since } } : { deletedAt: null }) },
      orderBy: { syncedAt: 'asc' },
    });
    return { now: now.toISOString(), projects: rows.map(toWire) };
  }

  async get(ownerId: string, id: string) {
    const p = await this.db.project.findFirst({ where: { id, ownerId, deletedAt: null } });
    if (!p) throw new NotFoundException('project not found');
    return p;
  }

  /**
   * Create or update. A stale `baseRev` is a conflict (409 with the server
   * copy) unless `force`: the client keeps both and retries with force.
   */
  async put(ownerId: string, id: string, dto: ProjectDto) {
    assertDesign(dto.design);
    const data = {
      name: dto.name,
      description: dto.description ?? '',
      notes: dto.notes ?? '',
      design: json(dto.design),
      scenario: json(dto.scenario),
      source: dto.source ?? null,
      lastRun: dto.lastRun ? json(dto.lastRun) : undefined,
      updatedAt: new Date(dto.updatedAt),
      deletedAt: null,
    };
    const existing = await this.db.project.findUnique({ where: { id } });
    if (!existing) {
      const count = await this.db.project.count({ where: { ownerId, deletedAt: null } });
      if (count >= MAX_PROJECTS) throw new BadRequestException(`at most ${MAX_PROJECTS} projects`);
      return this.db.project.create({ data: { id, ownerId, ...data, createdAt: new Date(dto.createdAt) } });
    }
    if (existing.ownerId !== ownerId) throw new NotFoundException('project not found');
    if (!dto.force && dto.baseRev !== undefined && dto.baseRev !== existing.rev) {
      throw new ConflictException({ message: 'project changed on another device', project: toWire(existing) });
    }
    // conditional on the revision we read, so two writes cannot both win
    const { count } = await this.db.project.updateMany({
      where: { id, rev: existing.rev },
      data: { ...data, rev: { increment: 1 } },
    });
    if (!count) {
      const latest = await this.db.project.findUniqueOrThrow({ where: { id } });
      throw new ConflictException({ message: 'project changed on another device', project: toWire(latest) });
    }
    return this.db.project.findUniqueOrThrow({ where: { id } });
  }

  async remove(ownerId: string, id: string) {
    const { count } = await this.db.project.updateMany({
      where: { id, ownerId, deletedAt: null },
      data: { deletedAt: new Date(), rev: { increment: 1 } },
    });
    if (count) await this.db.share.updateMany({ where: { projectId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async versions(ownerId: string, projectId: string) {
    await this.get(ownerId, projectId);
    const rows = await this.db.projectVersion.findMany({ where: { projectId }, orderBy: { at: 'desc' } });
    return rows.map(versionWire);
  }

  /** Idempotent by id (the browser creates versions offline and replays them). */
  async putVersion(ownerId: string, projectId: string, dto: VersionDto) {
    await this.get(ownerId, projectId);
    assertDesign(dto.design);
    const data = {
      at: new Date(dto.at),
      label: dto.label ?? null,
      auto: dto.auto,
      name: dto.name,
      notes: dto.notes ?? '',
      design: json(dto.design),
      scenario: json(dto.scenario),
    };
    const other = await this.db.projectVersion.findUnique({ where: { id: dto.id } });
    if (other && other.projectId !== projectId) throw new NotFoundException('version not found');
    await this.db.projectVersion.upsert({ where: { id: dto.id }, create: { id: dto.id, projectId, ...data }, update: data });
    // keep named versions, prune the oldest automatic ones
    const autos = await this.db.projectVersion.findMany({
      where: { projectId, auto: true },
      orderBy: { at: 'desc' },
      skip: MAX_AUTO_VERSIONS,
      select: { id: true },
    });
    if (autos.length) await this.db.projectVersion.deleteMany({ where: { id: { in: autos.map((a) => a.id) } } });
  }

  // ------------------------------------------------------------ share links

  async share(ownerId: string, projectId: string, mode: 'live' | 'snapshot') {
    const p = await this.get(ownerId, projectId);
    const slug = randomBytes(8).toString('base64url'); // 64 bits: not guessable
    const snapshot = mode === 'snapshot' ? json({ name: p.name, description: p.description, design: p.design, scenario: p.scenario, at: Date.now() }) : undefined;
    const s = await this.db.share.create({ data: { slug, projectId, snapshot } });
    return { slug: s.slug, mode, createdAt: s.createdAt, views: 0 };
  }

  async shares(ownerId: string, projectId: string) {
    await this.get(ownerId, projectId);
    const rows = await this.db.share.findMany({ where: { projectId, revokedAt: null }, orderBy: { createdAt: 'desc' } });
    return rows.map((s) => ({ slug: s.slug, mode: s.snapshot ? 'snapshot' : 'live', createdAt: s.createdAt, views: s.views }));
  }

  async revoke(ownerId: string, slug: string) {
    const s = await this.db.share.findUnique({ where: { slug }, include: { project: { select: { ownerId: true } } } });
    if (!s || s.project.ownerId !== ownerId) throw new NotFoundException('link not found');
    await this.db.share.update({ where: { slug }, data: { revokedAt: new Date() } });
  }

  /** Public read of a shared project; counts the view. */
  async open(slug: string) {
    const s = await this.db.share.findUnique({
      where: { slug },
      include: { project: { include: { owner: { select: { displayName: true } } } } },
    });
    if (!s || s.revokedAt || s.project.deletedAt) throw new NotFoundException('link not found or revoked');
    await this.db.share.update({ where: { slug }, data: { views: { increment: 1 } } });
    const snap = s.snapshot as { name: string; description: string; design: unknown; scenario: unknown; at: number } | null;
    const p = s.project;
    return {
      slug,
      mode: snap ? 'snapshot' : 'live',
      author: p.owner.displayName,
      name: snap?.name ?? p.name,
      description: snap?.description ?? p.description,
      design: snap?.design ?? p.design,
      scenario: snap?.scenario ?? p.scenario,
      updatedAt: snap?.at ?? p.updatedAt.getTime(),
    };
  }
}
