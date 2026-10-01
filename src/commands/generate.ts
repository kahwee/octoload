import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { getUploadSchemaTemplate } from '../templates/schema-template.js';
import { getUploadSQLiteSchemaTemplate } from '../templates/sqlite-schema-template.js';

interface GenerateOptions {
  output: string;
  dialect?: 'postgresql' | 'sqlite';
}

export async function generateCommand(options: GenerateOptions) {
  const dialect = options.dialect ?? 'postgresql';
  if (!['postgresql', 'sqlite'].includes(dialect)) {
    throw new Error('Database dialect must be postgresql or sqlite');
  }
  console.log(`📝 Generating ${dialect} Drizzle schemas...`);

  const cwd = process.cwd();
  const outputPath = resolve(cwd, options.output);

  // Ensure output directory exists
  mkdirSync(dirname(outputPath), { recursive: true });

  const schemaContent =
    dialect === 'sqlite'
      ? getUploadSQLiteSchemaTemplate()
      : getUploadSchemaTemplate();
  writeFileSync(outputPath, schemaContent);

  console.log(`✅ Generated schema at: ${options.output}`);
  console.log('\nNext step: Add the schema to Drizzle and apply migrations.');
}
