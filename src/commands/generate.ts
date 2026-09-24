import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { getUploadSchemaTemplate } from '../templates/schema-template.js';

interface GenerateOptions {
  output: string;
}

export async function generateCommand(options: GenerateOptions) {
  console.log('📝 Generating Drizzle schemas...');

  const cwd = process.cwd();
  const outputPath = resolve(cwd, options.output);

  // Ensure output directory exists
  mkdirSync(dirname(outputPath), { recursive: true });

  const schemaContent = getUploadSchemaTemplate();
  writeFileSync(outputPath, schemaContent);

  console.log(`✅ Generated schema at: ${options.output}`);
  console.log('\nNext step: Add the schema to Drizzle and apply migrations.');
}
