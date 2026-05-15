import fs from 'node:fs';
import path from 'node:path';
import pino, { type Logger } from 'pino';
import { getLogsDir } from '@cpm/shared';

let logger: Logger | null = null;

export function initLogger(): Logger {
  if (logger) return logger;
  const dir = getLogsDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const transport = pino.transport({
    target: 'pino-roll',
    options: {
      file: path.join(dir, 'app.log'),
      frequency: 'daily',
      mkdir: true,
      // pino-roll deletes files older than `limit.count` rotations; ~30 days at daily rotation.
      limit: { count: 30 },
    },
  });

  logger = pino(
    {
      level: process.env.LOG_LEVEL ?? 'info',
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    transport,
  );
  return logger;
}

export function getLogger(): Logger {
  return logger ?? initLogger();
}
