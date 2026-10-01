import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function addAdapterCommand(adapter: 's3' | 'r2') {
  if (!['s3', 'r2'].includes(adapter)) {
    throw new Error('Invalid adapter. Supported adapters: s3, r2');
  }

  console.log(`🔌 Adding ${adapter.toUpperCase()} adapter...`);

  const cwd = process.cwd();
  updatePackageJson(cwd);
  updateEnvExample(cwd, adapter);
  updateConfig(cwd, adapter);

  console.log(`✅ ${adapter.toUpperCase()} adapter added successfully!`);
  console.log('\nNext steps:');
  console.log('1. Install dependencies: pnpm install');
  console.log('2. Update your .env file with the new variables');
  console.log('3. Update your octoload config to use the new adapter');
}

function updatePackageJson(cwd: string) {
  const packagePath = join(cwd, 'package.json');
  if (!existsSync(packagePath)) {
    console.log('⚠️  package.json not found, skipping dependency update');
    return;
  }

  const packageContent = JSON.parse(readFileSync(packagePath, 'utf8'));
  const ownPackage = JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../package.json', import.meta.url)),
      'utf8'
    )
  );
  const deps = packageContent.dependencies || {};
  let changed = false;
  for (const dependency of [
    '@aws-sdk/client-s3',
    '@aws-sdk/s3-request-presigner',
  ]) {
    const configured = [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ].some((section) =>
      Object.hasOwn(packageContent[section] ?? {}, dependency)
    );
    if (!configured) {
      deps[dependency] = ownPackage.dependencies[dependency];
      changed = true;
    }
  }
  if (!changed) return;
  packageContent.dependencies = deps;
  writeFileSync(packagePath, `${JSON.stringify(packageContent, null, 2)}\n`);
  console.log('✅ Added missing package.json dependencies');
}

function updateEnvExample(cwd: string, adapter: 's3' | 'r2') {
  const envPath = join(cwd, '.env.example');
  const prefix = adapter.toUpperCase();
  const existing = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const defaults: Record<string, string> = {
    [`${prefix}_BUCKET`]: 'your-bucket-name',
    [`${prefix}_REGION`]: adapter === 'r2' ? 'auto' : 'us-east-1',
    [`${prefix}_ACCESS_KEY_ID`]: 'your-access-key',
    [`${prefix}_SECRET_ACCESS_KEY`]: 'your-secret-key',
    ...(adapter === 'r2'
      ? {
          R2_ENDPOINT: 'https://your-account-id.r2.cloudflarestorage.com',
          R2_PUBLIC_BASE_URL: '',
        }
      : {}),
  };
  const missing = Object.entries(defaults).filter(
    ([name]) =>
      !new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`, 'm').test(existing)
  );
  if (missing.length === 0) return;
  const separator = existing.endsWith('\n') || !existing ? '' : '\n';
  writeFileSync(
    envPath,
    `${existing}${separator}\n# Octoload ${prefix} configuration\n${missing.map(([name, value]) => `${name}=${value}`).join('\n')}\n`
  );
  console.log('✅ Added missing .env.example variables');
}

function updateConfig(cwd: string, adapter: string) {
  const configPath = [
    'src/lib/octoload/config.ts',
    'app/lib/octoload/config.ts',
  ]
    .map((path) => join(cwd, path))
    .find((path) => existsSync(path));
  if (!configPath) {
    console.log(
      '⚠️  Octoload config not found. Run "pnpm exec octoload init" first.'
    );
    return;
  }
  console.log(
    `💡 Update your config at ${configPath} to use the ${adapter} adapter`
  );
}
