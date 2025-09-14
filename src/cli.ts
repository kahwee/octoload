#!/usr/bin/env node

import { Command } from 'commander';
import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { addAdapterCommand } from './commands/add-adapter.js';
import { generateCommand } from './commands/generate.js';
import { initCommand } from './commands/init.js';
import { migrateCommand } from './commands/migrate.js';

// Get version from package.json dynamically
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  await readFile(join(__dirname, '../package.json'), 'utf-8')
) as { version: string };

const program = new Command();

program
  .name('octoload')
  .description(
    'Minimal, composable image upload system with Drizzle integration'
  )
  .version(packageJson.version);

program
  .command('init')
  .description('Initialize octoload configuration and templates')
  .option('--adapter <adapter>', 'Storage adapter (s3, r2)', 's3')
  .option(
    '--framework <framework>',
    'Framework (nextjs, react-router)',
    'nextjs'
  )
  .option(
    '--database <database>',
    'Database type (postgres, mysql, sqlite)',
    'postgres'
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

// Global error handler
program.hook('preAction', (_thisCommand) => {
  // Set up global error handling
  process.on('unhandledRejection', (error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
});

// Type guard for Commander.js errors
function isCommanderError(error: unknown): error is { code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  );
}

try {
  await program.parseAsync();
} catch (error) {
  // Only handle real errors, not help/version display
  if (
    !isCommanderError(error) ||
    (error.code !== 'commander.helpDisplayed' &&
      error.code !== 'commander.version')
  ) {
    console.error('❌ CLI Error:', error);
    process.exit(1);
  }
}
