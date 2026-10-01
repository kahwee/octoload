#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { addAdapterCommand } from './commands/add-adapter.js';
import { generateCommand } from './commands/generate.js';
import { initCommand } from './commands/init.js';
import { migrateCommand } from './commands/migrate.js';

const packageJson = JSON.parse(
  await readFile(
    join(dirname(fileURLToPath(import.meta.url)), '../package.json'),
    'utf-8'
  )
) as { version: string };

const program = new Command();

program
  .name('octoload')
  .description('Tools for S3/R2 image uploads with Drizzle metadata')
  .version(packageJson.version)
  .addHelpText(
    'after',
    '\nRead the current setup guide: https://github.com/kahwee/octoload#readme\n'
  );

program
  .command('init')
  .description(
    'Write an experimental framework scaffold; database wiring is manual'
  )
  .option('--adapter <adapter>', 'Storage adapter: s3 or r2', 's3')
  .option(
    '--framework <framework>',
    'Framework: nextjs or react-router',
    'nextjs'
  )
  .option('--auth <provider>', 'Auth: custom or better-auth', 'custom')
  .option('--dialect <dialect>', 'Database: postgresql or sqlite', 'postgresql')
  .action(initCommand);

program
  .command('generate')
  .description('Write a Drizzle upload schema (overwrites the output file)')
  .option('--output <path>', 'Schema output path', 'src/db/upload-schema.ts')
  .option('--dialect <dialect>', 'Database: postgresql or sqlite', 'postgresql')
  .action(generateCommand);

program
  .command('migrate')
  .description('Run drizzle-kit generate, then drizzle-kit push')
  .option('--generate-only', 'Run drizzle-kit generate without push')
  .action(migrateCommand);

program
  .command('add')
  .argument('<adapter>', 'Storage adapter: s3 or r2')
  .description('Add adapter dependencies and environment placeholders')
  .action(addAdapterCommand);

program.parse();
