import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export async function addAdapterCommand(adapter: 's3' | 'r2') {
  if (!['s3', 'r2'].includes(adapter)) {
    console.error('❌ Invalid adapter. Supported adapters: s3, r2');
    process.exit(1);
  }

  console.log(`🔌 Adding ${adapter.toUpperCase()} adapter...`);

  const cwd = process.cwd();
  updatePackageJson(cwd, adapter);
  updateEnvExample(cwd, adapter);
  updateConfig(cwd, adapter);

  console.log(`✅ ${adapter.toUpperCase()} adapter added successfully!`);
  console.log('\nNext steps:');
  console.log('1. Install dependencies: pnpm install');
  console.log('2. Update your .env file with the new variables');
  console.log('3. Update your octoload config to use the new adapter');
}

function updatePackageJson(cwd: string, adapter: string) {
  const packagePath = join(cwd, 'package.json');
  if (!existsSync(packagePath)) {
    console.log('⚠️  package.json not found, skipping dependency update');
    return;
  }

  const packageContent = JSON.parse(readFileSync(packagePath, 'utf8'));
  const deps = packageContent.dependencies || {};

  if (adapter === 's3' || adapter === 'r2') {
    deps['@aws-sdk/client-s3'] = '^3.700.0';
    deps['@aws-sdk/s3-request-presigner'] = '^3.700.0';
  }

  packageContent.dependencies = deps;
  writeFileSync(packagePath, JSON.stringify(packageContent, null, 2));
  console.log('✅ Updated package.json dependencies');
}

function updateEnvExample(cwd: string, adapter: string) {
  const envPath = join(cwd, '.env.example');
  const prefix = adapter.toUpperCase();

  const newVars = `
# Octoload ${prefix} Configuration
${prefix}_BUCKET=your-bucket-name
${prefix}_REGION=us-east-1
${prefix}_ACCESS_KEY_ID=your-access-key
${prefix}_SECRET_ACCESS_KEY=your-secret-key${adapter === 'r2' ? '\nR2_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com' : ''}
`;

  if (existsSync(envPath)) {
    writeFileSync(envPath, newVars, { flag: 'a' });
  } else {
    writeFileSync(envPath, newVars);
  }
  console.log('✅ Updated .env.example');
}

function updateConfig(cwd: string, adapter: string) {
  const configPath = join(cwd, 'src/lib/octoload/config.ts');
  if (!existsSync(configPath)) {
    console.log(
      '⚠️  Octoload config not found. Run "pnpm dlx octoload init" first.'
    );
    return;
  }

  console.log(
    `💡 Update your config at ${configPath} to use the ${adapter} adapter`
  );
}
