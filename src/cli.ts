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
  .version(packageJson.version)
  .addHelpText(
    'before',
    `
🎯 Octoload CLI - Direct-to-storage image uploads with type safety

Common workflow:
  1. npx octoload init           # Initialize project configuration
  2. npx octoload generate       # Generate database schema
  3. npx octoload migrate        # Apply database migrations
  4. Configure environment variables
  5. Start using upload client in your app

Documentation: https://github.com/kahwee/octoload/tree/main/docs
`
  )
  .addHelpText(
    'after',
    `
Examples:
  npx octoload init --adapter=s3 --framework=nextjs
  npx octoload init --adapter=r2 --framework=react-router --database=sqlite
  npx octoload generate --output=src/db/schema.ts
  npx octoload migrate --generate-only

For detailed help on any command, use:
  npx octoload <command> --help
`
  );

program
  .command('init')
  .description(
    `Initialize octoload in your project

Generates configuration files, route handlers, and database schema templates.
Choose your storage adapter (S3/R2), framework (Next.js/React Router), and
database type to get framework-specific boilerplate code.`
  )
  .option(
    '--adapter <adapter>',
    'Storage adapter: "s3" (AWS S3) or "r2" (Cloudflare R2). Affects generated configuration and required environment variables.',
    's3'
  )
  .option(
    '--framework <framework>',
    'Framework integration: "nextjs" (Next.js App Router) or "react-router" (React Router v7). Determines route handler structure.',
    'nextjs'
  )
  .option(
    '--database <database>',
    'Database type: "postgres", "mysql", or "sqlite". Affects generated Drizzle schema syntax.',
    'postgres'
  )
  .addHelpText(
    'after',
    `
Examples:
  npx octoload init                                    # Use defaults (S3 + Next.js + PostgreSQL)
  npx octoload init --adapter=r2 --framework=react-router
  npx octoload init --database=sqlite                 # For local development
  npx octoload init --adapter=s3 --framework=nextjs --database=mysql

Generated Files:
  • Configuration: src/lib/octoload/config.ts
  • Environment: .env.example
  • Routes: Framework-specific API handlers
    - Next.js: app/api/uploads/*/route.ts
    - React Router: app/routes/api/uploads/*
  • Schema: Updates to drizzle.config.ts

Prerequisites:
  • Existing framework project (Next.js or React Router)
  • Drizzle ORM configured in your project
  • package.json present in current directory

Next Steps:
  1. Copy environment variables from .env.example to .env
  2. Configure your storage credentials
  3. Run 'npx octoload generate' to create database schema
  4. Run 'npx octoload migrate' to apply migrations
`
  )
  .action(initCommand);

program
  .command('generate')
  .description(
    `Generate Drizzle ORM schema files for image upload functionality

Creates database tables for images, upload sessions, variants, and tags.
The generated schema integrates with your existing Drizzle configuration
and can be imported into your application.`
  )
  .option(
    '--output <path>',
    "Output path for the generated schema file. Will create directories if they don't exist.",
    'src/db/upload-schema.ts'
  )
  .addHelpText(
    'after',
    `
Examples:
  npx octoload generate                               # Use default path
  npx octoload generate --output=src/db/schema.ts    # Custom output path
  npx octoload generate --output=lib/db/uploads.ts   # Different directory

Generated Tables:
  • images: Core image metadata and ownership
    - id, filename, contentType, byteSize, status, storageKey
    - ownership fields: ownerId, orgId, entityType, entityId
    - metadata: alt, title, isPublic, checksum
  • upload_sessions: Multipart upload tracking
    - id, imageId, uploadId, partCount, expiresAt
  • asset_variants: Thumbnails and processed versions
    - id, imageId, variant, storageKey, dimensions, byteSize
  • image_tags: Flexible tagging system
    - id, imageId, tag, createdAt

Prerequisites:
  • Drizzle configuration file (drizzle.config.ts)
  • Previous 'octoload init' execution
  • Database connection configured

Next Steps:
  1. Review generated schema file
  2. Import schema into your Drizzle configuration
  3. Run 'npx octoload migrate' to apply to database
`
  )
  .action(generateCommand);

program
  .command('migrate')
  .description(
    `Generate and apply Drizzle migrations for octoload schema

Generates migration files from schema differences and applies them to
your connected database. Requires active database connection and
Drizzle configuration with migration settings.`
  )
  .option(
    '--generate-only',
    'Generate migration files without applying them. Useful for review before deployment.'
  )
  .addHelpText(
    'after',
    `
Examples:
  npx octoload migrate                    # Generate and apply migrations
  npx octoload migrate --generate-only    # Generate only, don't apply

Process:
  1. Compares current schema with database state
  2. Generates migration files in your migrations directory
  3. Applies migrations to connected database (unless --generate-only)
  4. Updates migration tracking table

Prerequisites:
  • DATABASE_URL environment variable configured
  • Drizzle configuration with migration settings
  • Generated schema files from 'octoload generate'
  • Database server running and accessible

Generated Migration Files:
  • Location: Determined by drizzle.config.ts
  • Format: Timestamped SQL files
  • Content: CREATE TABLE statements and indexes

Troubleshooting:
  • "No migrations to apply": Schema already matches database
  • "Connection failed": Check DATABASE_URL and database server
  • "Schema not found": Run 'octoload generate' first
`
  )
  .action(migrateCommand);

program
  .command('add')
  .argument('<adapter>', 'Storage adapter to add')
  .description(
    `Add and configure additional storage adapters

Updates your existing octoload configuration to support multiple
storage adapters. Useful for multi-cloud setups or migration scenarios.`
  )
  .addHelpText(
    'after',
    `
Available Adapters:
  s3      AWS S3 (requires AWS credentials)
  r2      Cloudflare R2 (requires Cloudflare API tokens)

Examples:
  npx octoload add s3                    # Add AWS S3 adapter
  npx octoload add r2                    # Add Cloudflare R2 adapter

Configuration Updates:
  • Updates octoload.config.ts with new adapter configuration
  • Adds environment variables to .env.example
  • Installs required SDK packages (if not present)
  • Updates TypeScript types for new adapter

Environment Variables Added:
  S3 Adapter:
    - AWS_ACCESS_KEY_ID
    - AWS_SECRET_ACCESS_KEY
    - S3_BUCKET
    - S3_REGION

  R2 Adapter:
    - CLOUDFLARE_ACCOUNT_ID
    - CLOUDFLARE_ACCESS_KEY_ID
    - CLOUDFLARE_SECRET_ACCESS_KEY
    - R2_BUCKET

Prerequisites:
  • Existing octoload configuration from 'octoload init'
  • Valid package.json in current directory
  • Network access to install dependencies

Next Steps:
  1. Configure new environment variables
  2. Update your application code to use new adapter
  3. Test uploads with new storage backend
`
  )
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
