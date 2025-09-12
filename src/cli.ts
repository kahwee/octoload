#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { generateCommand } from './commands/generate.js';
import { migrateCommand } from './commands/migrate.js';
import { addAdapterCommand } from './commands/add-adapter.js';

const program = new Command();

program
  .name('octoload')
  .description(
    'Minimal, composable image upload system with Drizzle integration'
  )
  .version('0.1.0');

program
  .command('init')
  .description('Initialize octoload configuration and templates')
  .option('--adapter <adapter>', 'Storage adapter (s3, r2)', 's3')
  .option(
    '--framework <framework>',
    'Framework (nextjs, react-router)',
    'nextjs'
  )
  .action(initCommand);

program
  .command('generate')
  .description('Generate Drizzle schemas for image uploads')
  .option(
    '--output <path>',
    'Output path for schemas',
    'src/db/upload-schema.ts'
  )
  .action(generateCommand);

program
  .command('migrate')
  .description('Generate and apply Drizzle migrations')
  .option('--generate-only', 'Only generate migration files')
  .action(migrateCommand);

program
  .command('add')
  .argument('<adapter>', 'Adapter to add (s3, r2)')
  .description('Add and configure storage adapter')
  .action(addAdapterCommand);

program.parse();
