import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

interface InitOptions {
  adapter: 's3' | 'r2';
  framework: 'nextjs' | 'react-router';
  auth?: 'custom' | 'better-auth';
}

function writeNew(path: string, content: string): boolean {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) return false;
  writeFileSync(path, content, { flag: 'wx' });
  return true;
}

export async function initCommand(options: InitOptions) {
  if (!['s3', 'r2'].includes(options.adapter)) {
    throw new Error('Storage adapter must be s3 or r2');
  }
  if (!['nextjs', 'react-router'].includes(options.framework)) {
    throw new Error('Framework must be nextjs or react-router');
  }
  if (options.auth && !['custom', 'better-auth'].includes(options.auth)) {
    throw new Error('Auth provider must be custom or better-auth');
  }

  const cwd = process.cwd();
  const appRoot = options.framework === 'nextjs' ? 'src' : 'app';
  const octoloadDir = join(cwd, appRoot, 'lib/octoload');
  const schemaPath = `${appRoot}/db/upload-schema.ts`;
  const getUserCallback =
    options.framework === 'nextjs'
      ? '(request: Request) => getUploadUser(request)'
      : '({ request }: { request: Request }) => getUploadUser(request)';
  const created: string[] = [];
  const add = (path: string, content: string) => {
    if (writeNew(path, content)) created.push(path);
  };

  add(
    join(cwd, 'drizzle.config.ts'),
    `import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: '${schemaPath}',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
`
  );
  add(join(octoloadDir, 'config.ts'), generateConfig(options));
  add(join(octoloadDir, 'auth.ts'), generateAuth(options));
  add(
    join(octoloadDir, 'server.ts'),
    `import { db } from '../../db';
import * as schema from '../../db/upload-schema';
import { getUploadUser } from './auth';
import { octoloadConfig } from './config';

// Export db from ${appRoot}/db/index.ts, then connect getUploadUser to your auth provider.
export const uploadHandlerOptions = {
  config: octoloadConfig,
  db,
  schema,
  getUser: ${getUserCallback},
};
`
  );

  const envPath = join(cwd, '.env.example');
  const envContent = generateEnvTemplate(options);
  if (!existsSync(envPath)) {
    add(envPath, envContent);
  } else if (
    !readFileSync(envPath, 'utf8').includes(
      `${options.adapter.toUpperCase()}_BUCKET=`
    )
  ) {
    writeFileSync(envPath, envContent, { flag: 'a' });
  }

  if (options.framework === 'nextjs') {
    generateNextJSRoutes(cwd, add);
  } else {
    generateReactRouterRoutes(cwd, add);
  }

  console.log(`Created ${created.length} octoload scaffold files.`);
  console.log(`Next: pnpm exec octoload generate --output ${schemaPath}`);
  console.log(`Then export db from ${appRoot}/db/index.ts.`);
  if (options.auth === 'better-auth') {
    console.log(
      `Better Auth: export auth from ${appRoot}/lib/${options.framework === 'nextjs' ? 'auth.ts' : 'auth.server.ts'}.`
    );
  } else {
    console.log(
      `Connect ${appRoot}/lib/octoload/auth.ts to your session provider.`
    );
  }
  console.log(
    'Unauthenticated upload routes return 401 until auth is connected.'
  );
}

function generateAuth(options: InitOptions): string {
  if (options.auth === 'better-auth') {
    const module =
      options.framework === 'nextjs' ? '../auth' : '../auth.server';
    return `import { auth } from '${module}';

export async function getUploadUser(request: Request): Promise<{ id: string } | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user ? { id: session.user.id } : null;
}
`;
  }
  return `/**
 * Connect this function to your application's session provider.
 * Return null for guests. Private reads and all deletes require an owner.
 */
export async function getUploadUser(_request: Request): Promise<{ id: string } | null> {
  return null;
}
`;
}

function generateConfig(options: InitOptions): string {
  const prefix = options.adapter.toUpperCase();
  return `import type { OctoloadConfig } from 'octoload';

export const octoloadConfig: OctoloadConfig = {
  storage: {
    adapter: '${options.adapter}',
    bucket: process.env.${prefix}_BUCKET!,
    region: process.env.${prefix}_REGION!,
    ${options.adapter === 'r2' ? 'endpoint: process.env.R2_ENDPOINT!,\n    publicBaseUrl: process.env.R2_PUBLIC_BASE_URL || undefined,\n    ' : ''}credentials: {
      accessKeyId: process.env.${prefix}_ACCESS_KEY_ID!,
      secretAccessKey: process.env.${prefix}_SECRET_ACCESS_KEY!,
    },
  },
  limits: {
    maxFileSize: 10 * 1024 * 1024,
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    maxVariants: 0,
  },
};
`;
}

function generateEnvTemplate(options: InitOptions): string {
  const prefix = options.adapter.toUpperCase();
  return `
# Octoload ${prefix} configuration
${prefix}_BUCKET=your-bucket-name
${prefix}_REGION=${options.adapter === 'r2' ? 'auto' : 'us-east-1'}
${prefix}_ACCESS_KEY_ID=your-access-key
${prefix}_SECRET_ACCESS_KEY=your-secret-key
${options.adapter === 'r2' ? 'R2_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com\n# Set for public R2 uploads (custom domain or enabled r2.dev URL)\nR2_PUBLIC_BASE_URL=\n' : ''}`;
}

type AddFile = (path: string, content: string) => void;

function generateNextJSRoutes(cwd: string, add: AddFile) {
  const uploads = join(cwd, 'src/app/api/uploads');
  add(
    join(uploads, 'presign/route.ts'),
    `import { createPresignHandler } from 'octoload/nextjs';
import { uploadHandlerOptions } from '../../../../lib/octoload/server';

export const POST = createPresignHandler({ ...uploadHandlerOptions, requireAuth: true });
`
  );
  add(
    join(uploads, 'finalize/route.ts'),
    `import { createFinalizeHandler } from 'octoload/nextjs';
import { uploadHandlerOptions } from '../../../../lib/octoload/server';

export const POST = createFinalizeHandler({ ...uploadHandlerOptions, requireAuth: true });
`
  );
  add(
    join(cwd, 'src/app/api/images/[imageId]/route.ts'),
    `import { createGetImageHandler, createDeleteImageHandler } from 'octoload/nextjs';
import { uploadHandlerOptions } from '../../../../lib/octoload/server';

export const GET = createGetImageHandler(uploadHandlerOptions);
export const DELETE = createDeleteImageHandler(uploadHandlerOptions);
`
  );
}

function generateReactRouterRoutes(cwd: string, add: AddFile) {
  const routes = join(cwd, 'app/routes');
  add(
    join(routes, 'api.uploads.presign.ts'),
    `import { createPresignHandler } from 'octoload/react-router';
import { uploadHandlerOptions } from '../lib/octoload/server';

export const action = createPresignHandler({ ...uploadHandlerOptions, requireAuth: true });
`
  );
  add(
    join(routes, 'api.uploads.finalize.ts'),
    `import { createFinalizeHandler } from 'octoload/react-router';
import { uploadHandlerOptions } from '../lib/octoload/server';

export const action = createFinalizeHandler({ ...uploadHandlerOptions, requireAuth: true });
`
  );
  add(
    join(routes, 'api.images.$imageId.ts'),
    `import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { createGetImageHandler, createDeleteImageHandler } from 'octoload/react-router';
import { uploadHandlerOptions } from '../lib/octoload/server';

const getImage = createGetImageHandler(uploadHandlerOptions);
const deleteImage = createDeleteImageHandler(uploadHandlerOptions);

export const loader = (args: LoaderFunctionArgs) => getImage(args);
export const action = (args: ActionFunctionArgs) => deleteImage(args);
`
  );
}
