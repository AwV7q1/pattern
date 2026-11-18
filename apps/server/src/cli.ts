// Admin commands, run on the server machine:
//   pnpm --filter server cli create-user --email a@b.c [--name Alice] [--admin]
//     (password from --password or the PATTERN_PASSWORD environment variable)
//   pnpm --filter server cli set-password --email a@b.c
//   pnpm --filter server cli list-users
//   pnpm --filter server cli import-leaderboard data/leaderboard.json
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AuthService } from './auth/auth.service';
import { hashPassword } from './auth/password';
import { PrismaService } from './prisma/prisma.service';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);

async function main() {
  const [cmd] = args;
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const db = app.get(PrismaService);
  try {
    switch (cmd) {
      case 'create-user':
      case 'create-admin': {
        const email = flag('email');
        const password = flag('password') ?? process.env.PATTERN_PASSWORD;
        if (!email || !password) throw new Error('need --email and --password (or PATTERN_PASSWORD)');
        if (password.length < 8) throw new Error('password: at least 8 characters');
        const user = await app.get(AuthService).createUser({
          email,
          password,
          displayName: flag('name'),
          role: cmd === 'create-admin' || has('admin') ? 'admin' : 'user',
        });
        console.log(`created ${user.role} ${user.email} (${user.id})`);
        break;
      }
      case 'set-password': {
        const email = flag('email')?.trim().toLowerCase();
        const password = flag('password') ?? process.env.PATTERN_PASSWORD;
        if (!email || !password || password.length < 8) throw new Error('need --email and a password of 8+ characters');
        const n = await db.identity.updateMany({ where: { provider: 'local', subject: email }, data: { passwordHash: await hashPassword(password) } });
        if (!n.count) throw new Error(`no local account for ${email}`);
        const user = await db.user.findUniqueOrThrow({ where: { email } });
        await db.session.deleteMany({ where: { userId: user.id } });
        console.log(`password updated for ${email}; its sessions were signed out`);
        break;
      }
      case 'list-users': {
        for (const u of await db.user.findMany({ orderBy: { createdAt: 'asc' } }))
          console.log(`${u.role.padEnd(5)} ${u.email.padEnd(32)} ${u.displayName}`);
        break;
      }
      case 'import-leaderboard': {
        // the JSON file of the previous file-based leaderboard: { levelId: Entry[] }
        const file = args[1];
        if (!file) throw new Error('usage: import-leaderboard <file>');
        const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<
          string,
          { player: string; stars: number; costPerHour: number; p99Ms: number; errorRate: number; submittedAt: string; design: object }[]
        >;
        let n = 0;
        for (const [levelId, entries] of Object.entries(raw)) {
          for (const e of entries) {
            // one placeholder account per old player name (cannot sign in: no identity)
            const email = `${e.player.toLowerCase().replace(/[^a-z0-9]+/g, '-')}@imported.local`;
            const user = await db.user.upsert({ where: { email }, update: {}, create: { email, displayName: e.player } });
            await db.leaderboardEntry.upsert({
              where: { levelId_userId: { levelId, userId: user.id } },
              create: { levelId, userId: user.id, stars: e.stars, costPerHour: e.costPerHour, p99Ms: e.p99Ms, errorRate: e.errorRate, design: e.design, submittedAt: new Date(e.submittedAt) },
              update: {},
            });
            n++;
          }
        }
        console.log(`imported ${n} entries`);
        break;
      }
      default:
        console.log('commands: create-user, create-admin, set-password, list-users, import-leaderboard');
        process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
