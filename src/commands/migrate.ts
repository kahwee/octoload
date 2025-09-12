import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

interface MigrateOptions {
  generateOnly?: boolean;
}

export async function migrateCommand(options: MigrateOptions) {
  const cwd = process.cwd();
  const drizzleConfigPath = join(cwd, 'drizzle.config.ts');

  if (!existsSync(drizzleConfigPath)) {
    console.error(
      '❌ drizzle.config.ts not found. Run "npx octoload init" first.'
    );
    process.exit(1);
  }

  console.log('🔄 Running Drizzle migrations...');

  try {
    // Generate migrations
    await runDrizzleCommand(['generate']);
    console.log('✅ Generated migration files');

    if (!options.generateOnly) {
      // Apply migrations
      await runDrizzleCommand(['push']);
      console.log('✅ Applied migrations to database');
    } else {
      console.log(
        '📝 Migration files generated. Run "drizzle-kit push" to apply.'
      );
    }
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

function runDrizzleCommand(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const drizzleKit = spawn('npx', ['drizzle-kit', ...args], {
      stdio: 'inherit',
      shell: true,
    });

    drizzleKit.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`drizzle-kit exited with code ${code}`));
      }
    });

    drizzleKit.on('error', (error) => {
      reject(error);
    });
  });
}
