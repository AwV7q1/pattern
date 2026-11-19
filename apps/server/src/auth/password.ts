import { hash, verify } from '@node-rs/argon2';

// argon2id with the OWASP baseline (19 MiB, 2 passes, 1 lane).
const OPTS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => hash(password, OPTS);

export async function verifyPassword(stored: string | null | undefined, password: string) {
  if (!stored) {
    // same cost as a real check, so response time does not reveal unknown emails
    await hash(password, OPTS);
    return false;
  }
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}
