import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

interface InitOptions {
  adapter: 's3' | 'r2';
  framework: 'nextjs' | 'react-router';
}

export async function initCommand(options: InitOptions) {
  console.log('🚀 Initializing octoload...');

  const cwd = process.cwd();

  // Create directories
  const dirs = ['src/db', 'src/lib/octoload'];
  dirs.forEach((dir) => {
    const fullPath = join(cwd, dir);
    if (!existsSync(fullPath)) {
      mkdirSync(fullPath, { recursive: true });
      console.log(`✅ Created directory: ${dir}`);
    }
  });

  // Generate drizzle config if it doesn't exist
  const drizzleConfigPath = join(cwd, 'drizzle.config.ts');
  if (!existsSync(drizzleConfigPath)) {
    const drizzleConfig = `import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: ['src/db/schema.ts', 'src/db/upload-schema.ts'],
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});`;
    writeFileSync(drizzleConfigPath, drizzleConfig);
    console.log('✅ Created drizzle.config.ts');
  }

  // Generate octoload config
  const configPath = join(cwd, 'src/lib/octoload/config.ts');
  const configContent = generateConfig(options);
  writeFileSync(configPath, configContent);
  console.log('✅ Created octoload config');

  // Generate environment template
  const envPath = join(cwd, '.env.example');
  const envContent = generateEnvTemplate(options);
  if (!existsSync(envPath)) {
    writeFileSync(envPath, envContent);
  } else {
    // Append to existing .env.example
    writeFileSync(envPath, envContent, { flag: 'a' });
  }
  console.log('✅ Updated .env.example with octoload variables');

  // Generate route handlers based on framework
  if (options.framework === 'nextjs') {
    generateNextJSRoutes(cwd);
  } else if (options.framework === 'react-router') {
    generateReactRouterRoutes(cwd);
  }

  console.log('\\n🎉 Octoload initialized successfully!');
  console.log('\\nNext steps:');
  console.log('1. Copy environment variables from .env.example to .env');
  console.log('2. Run: npx octoload generate');
  console.log('3. Run: npx octoload migrate');
}

function generateConfig(options: InitOptions): string {
  return `import type { OctoloadConfig } from 'octoload';

export const octoloadConfig: OctoloadConfig = {
  storage: {
    adapter: '${options.adapter}',
    bucket: process.env.${options.adapter.toUpperCase()}_BUCKET!,
    region: process.env.${options.adapter.toUpperCase()}_REGION!,
    ${
      options.adapter === 'r2'
        ? `
    endpoint: process.env.R2_ENDPOINT!,`
        : ''
    }
    credentials: {
      accessKeyId: process.env.${options.adapter.toUpperCase()}_ACCESS_KEY_ID!,
      secretAccessKey: process.env.${options.adapter.toUpperCase()}_SECRET_ACCESS_KEY!,
    },
  },
  limits: {
    maxFileSize: 10 * 1024 * 1024, // 10MB
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    maxVariants: 5,
  },
  hooks: {
    beforePresign: async (context) => {
      // Add your custom validation here
      return context;
    },
    afterFinalize: async (image) => {
      // Trigger variant processing if needed
      console.log('Image uploaded:', image.id);
    },
  },
};`;
}

function generateEnvTemplate(options: InitOptions): string {
  const prefix = options.adapter.toUpperCase();
  return `
# Octoload ${options.adapter.toUpperCase()} Configuration
${prefix}_BUCKET=your-bucket-name
${prefix}_REGION=us-east-1
${prefix}_ACCESS_KEY_ID=your-access-key
${prefix}_SECRET_ACCESS_KEY=your-secret-key${options.adapter === 'r2' ? '\\nR2_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com' : ''}
`;
}

function generateNextJSRoutes(cwd: string) {
  const routesDir = join(cwd, 'src/app/api/uploads');
  mkdirSync(routesDir, { recursive: true });

  // Presign route
  const presignRoute = `import { NextRequest, NextResponse } from 'next/server';
import { createPresignHandler } from 'octoload/nextjs';
import { octoloadConfig } from '@/lib/octoload/config';

const handler = createPresignHandler(octoloadConfig);

export async function POST(request: NextRequest) {
  return handler(request);
}`;

  writeFileSync(join(routesDir, 'presign/route.ts'), presignRoute);

  // Finalize route
  const finalizeRoute = `import { NextRequest, NextResponse } from 'next/server';
import { createFinalizeHandler } from 'octoload/nextjs';
import { octoloadConfig } from '@/lib/octoload/config';

const handler = createFinalizeHandler(octoloadConfig);

export async function POST(request: NextRequest) {
  return handler(request);
}`;

  writeFileSync(join(routesDir, 'finalize/route.ts'), finalizeRoute);

  console.log('✅ Created Next.js API routes');
}

function generateReactRouterRoutes(cwd: string) {
  const routesDir = join(cwd, 'app/routes');
  mkdirSync(routesDir, { recursive: true });

  // Presign route
  const presignRoute = `import type { ActionFunctionArgs } from 'react-router';
import { createPresignHandler } from 'octoload/react-router';
import { octoloadConfig } from '~/lib/octoload/config';

const handler = createPresignHandler(octoloadConfig);

export async function action({ request }: ActionFunctionArgs) {
  return handler(request);
}`;

  writeFileSync(join(routesDir, 'api.uploads.presign.ts'), presignRoute);

  // Finalize route
  const finalizeRoute = `import type { ActionFunctionArgs } from 'react-router';
import { createFinalizeHandler } from 'octoload/react-router';
import { octoloadConfig } from '~/lib/octoload/config';

const handler = createFinalizeHandler(octoloadConfig);

export async function action({ request }: ActionFunctionArgs) {
  return handler(request);
}`;

  writeFileSync(join(routesDir, 'api.uploads.finalize.ts'), finalizeRoute);

  // Get image route
  const getRoute = `import type { LoaderFunctionArgs } from 'react-router';
import { createGetImageHandler } from 'octoload/react-router';
import { octoloadConfig } from '~/lib/octoload/config';

const handler = createGetImageHandler(octoloadConfig);

export async function loader({ request, params }: LoaderFunctionArgs) {
  return handler(request, params.imageId!);
}`;

  writeFileSync(join(routesDir, 'api.images.$imageId.ts'), getRoute);

  console.log('✅ Created React Router upload routes');
}
