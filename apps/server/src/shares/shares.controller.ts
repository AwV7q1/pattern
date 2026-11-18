import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { EngineService, InvalidDesignError } from '../engine/engine.service';
import { SharesService } from './shares.service';

interface CreateBody {
  name?: unknown;
  description?: unknown;
  notes?: unknown;
  design?: { nodes?: unknown; edges?: unknown; groups?: unknown };
  scenario?: unknown;
}

const text = (v: unknown, max: number, field: string) => {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string' || v.length > max) throw new BadRequestException(`${field}: string ≤ ${max} chars`);
  return v;
};

@Controller('shares')
export class SharesController {
  constructor(
    private readonly shares: SharesService,
    private readonly engine: EngineService,
  ) {}

  /** Snapshot a project and return its id; the link is `/?share=<id>`. */
  @Post()
  create(@Body() body: CreateBody) {
    const name = text(body.name, 120, 'name').trim();
    if (!name) throw new BadRequestException('name required');
    const { design, scenario } = body;
    if (!design || !Array.isArray(design.nodes) || !Array.isArray(design.edges) || !scenario || typeof scenario !== 'object') {
      throw new BadRequestException('design: { nodes: [], edges: [] } and scenario required');
    }
    if (design.nodes.length > 500 || design.edges.length > 2000) throw new BadRequestException('design too large');
    if (design.groups !== undefined && (!Array.isArray(design.groups) || design.groups.length > 200)) {
      throw new BadRequestException('groups: array ≤ 200');
    }
    // only store what the engine accepts, so every link opens
    try {
      this.engine.validate({ nodes: design.nodes, edges: design.edges }, scenario);
    } catch (err) {
      if (err instanceof InvalidDesignError) throw new BadRequestException(err.message);
      throw err;
    }
    const share = this.shares.create({
      name,
      description: text(body.description, 4000, 'description'),
      notes: text(body.notes, 20000, 'notes'),
      design: { nodes: design.nodes, edges: design.edges, ...(design.groups ? { groups: design.groups } : {}) },
      scenario,
    });
    return { id: share.id, createdAt: share.createdAt };
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.shares.get(id);
  }
}
