import { repl } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * Interactive REPL for exploring the dependency graph:
 *   npm run repl
 * then e.g. `await get(RedisService)`.
 */
async function bootstrap(): Promise<void> {
  await repl(AppModule);
}

void bootstrap();
