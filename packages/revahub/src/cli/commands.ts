import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { scanPackage, registerPackage, deregisterPackage } from '../core/package-scanner.js';
import { getNativePackages } from '../utils/native-packages.js';

/**
 * Runs an npm command with array arguments to prevent shell injection.
 *
 * @param args - npm command arguments
 * @param cwd - Working directory
 */
function npmRun(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', args, { cwd, shell: false, stdio: 'inherit' });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

/**
 * Resolves a short package name to its full revahub package name.
 *
 * @param type - Package type
 * @param name - Short package name
 * @returns Full package name with revahub prefix
 */
function resolvePackageName(type: 'module' | 'task', name: string): string {
  const prefix = `revahub-${type}-`;
  if (name.startsWith(prefix)) {
    return name;
  }
  // Also handle already-full names
  if (name.startsWith('revahub-module-') || name.startsWith('revahub-task-')) {
    return name;
  }

  return `${prefix}${name}`;
}

/**
 * Creates a new module or task package scaffolding.
 *
 * @param type - Package type to create
 * @param shortName - Short package name
 * @param targetDir - Directory where package will be created
 */
export async function createPackage(
  type: 'module' | 'task',
  shortName: string,
  targetDir: string
): Promise<void> {
  const packageName = `revahub-${type}-${shortName}`;
  const packageDir = join(targetDir, packageName);

  // Check if directory already exists
  try {
    await access(packageDir);
    throw new Error(`Directory "${packageDir}" already exists`);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }

  // Create directory structure
  await mkdir(join(packageDir, 'src'), { recursive: true });

  // Create package.json
  const packageJson = {
    name: packageName,
    version: '0.1.0',
    description: `RevaHub ${type}: ${shortName}`,
    type: 'module',
    main: 'dist/index.js',
    types: 'dist/index.d.ts',
    keywords: ['revahub', `revahub-${type}`],
    scripts: {
      build: 'tsc',
      prepare: 'npm run build'
    },
    revahub: type === 'module'
      ? {
        type: 'module',
        label: shortName.charAt(0).toUpperCase() + shortName.slice(1),
        description: `A RevaHub module for ${shortName}`,
        options: []
      }
      : {
        type: 'task',
        label: shortName.charAt(0).toUpperCase() + shortName.slice(1),
        description: `A RevaHub task for ${shortName}`,
        options: [],
        trigger: { default: { type: 'cron', cron: '0 * * * *' } },
        timeout: { default: 30000 }
      },
    devDependencies: {
      'revahub-types': '*',
      'typescript': '^5.8.0'
    }
  };

  await writeFile(
    join(packageDir, 'package.json'),
    JSON.stringify(packageJson, null, 2)
  );

  // Create tsconfig.json
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      declaration: true,
      declarationMap: true,
      outDir: 'dist',
      rootDir: 'src',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true
    },
    include: ['src']
  };

  await writeFile(
    join(packageDir, 'tsconfig.json'),
    JSON.stringify(tsconfig, null, 2)
  );

  // Create src/index.ts
  const indexTs = type === 'module'
    ? `import type { ModuleContext } from 'revahub-types';

/**
 * ${shortName.charAt(0).toUpperCase() + shortName.slice(1)} module for RevaHub.
 */
class ${toPascalCase(shortName)}Module {
  constructor(private ctx: ModuleContext) {
    // Initialize your module here
    
    ctx.onDestroy(async () => {
      // Cleanup when the module is stopped
    });
  }

  // Add public methods that can be called via RPC
  async exampleMethod(arg: string): Promise<string> {
    await this.ctx.instances.logger.info(\`exampleMethod called with: \${arg}\`);
    return \`Result: \${arg}\`;
  }
}

export default (ctx: ModuleContext) => {
  return new ${toPascalCase(shortName)}Module(ctx);
};
`
    : `import type { TaskContext } from 'revahub-types';

/**
 * ${shortName.charAt(0).toUpperCase() + shortName.slice(1)} task for RevaHub.
 */
export default async (ctx: TaskContext) => {
  await ctx.instances.logger.info('Task started');
  
  // Your task logic here
  
  await ctx.instances.logger.info('Task completed');
  
  return { success: true };
};
`;

  await writeFile(join(packageDir, 'src', 'index.ts'), indexTs);

  // Create README.md
  const readme = `# ${packageName}

A RevaHub ${type} for ${shortName}.

## Installation

\`\`\`bash
npx revahub install ${type} ${shortName}
\`\`\`

## Configuration

Configure this ${type} via the RevaHub UI.

## Development

\`\`\`bash
npm install
npm run build
\`\`\`

## License

MIT
`;

  await writeFile(join(packageDir, 'README.md'), readme);

  console.info(`Created package at: ${packageDir}`);
}

/**
 * @param str - Kebab-case string
 * @returns PascalCase string
 */
function toPascalCase(str: string): string {
  return str
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/** Options for install/uninstall commands. */
export interface PackageCommandOptions {
  version?: string;
  workingDir: string;
}

/**
 * Installs a package from npm.
 *
 * @param packageName - Full package name to install
 * @param options - Installation options
 * @param nativePackages - Set of native package names
 */
export async function installPackage(
  packageName: string,
  options: PackageCommandOptions,
  nativePackages: Set<string>
): Promise<void> {
  const { workingDir, version } = options;

  console.info(`Installing ${packageName}...`);

  // Ensure working directory has package.json
  try {
    await access(join(workingDir, 'package.json'));
  } catch {
    await writeFile(
      join(workingDir, 'package.json'),
      JSON.stringify({ name: 'revahub-workspace', private: true, type: 'module' }, null, 2)
    );
  }

  // Run npm install
  const installArg = version ? `${packageName}@${version}` : packageName;
  await npmRun(['install', installArg], workingDir);

  // Validate the installed package
  const packageDir = join(workingDir, 'node_modules', packageName);
  const scanned = await scanPackage(packageDir);

  if (!scanned) {
    // Rollback installation
    await npmRun(['uninstall', packageName], workingDir);
    throw new Error(`Package "${packageName}" does not contain valid revahub metadata`);
  }

  // Register in the in-memory registry
  await registerPackage(packageDir, 'npm', nativePackages);

  console.info(`✓ Installed ${packageName} v${scanned.version}`);
}

/**
 * Uninstalls a package.
 *
 * @param packageName - Full package name to uninstall
 * @param options - Uninstallation options
 * @param nativePackages - Set of native package names
 */
export async function uninstallPackage(
  packageName: string,
  options: PackageCommandOptions,
  nativePackages: Set<string>
): Promise<void> {
  const { workingDir } = options;

  // Check if it's a native package
  if (nativePackages.has(packageName)) {
    throw new Error(`Cannot uninstall native package "${packageName}"`);
  }

  console.info(`Uninstalling ${packageName}...`);

  // Run npm uninstall
  await npmRun(['uninstall', packageName], workingDir);

  // Remove from registry
  deregisterPackage(packageName);

  console.info(`✓ Uninstalled ${packageName}`);
}

/**
 * CLI wrapper for installPackage that takes type + name format.
 *
 * @param type - Package type
 * @param name - Short package name
 * @param workingDir - Working directory
 */
export async function cliInstallPackage(
  type: 'module' | 'task',
  name: string,
  workingDir: string
): Promise<void> {
  const packageName = resolvePackageName(type, name);
  const nativePackages = getNativePackages();

  await installPackage(packageName, { workingDir }, nativePackages);

  // Look up the installed package info
  const packageDir = join(workingDir, 'node_modules', packageName);
  const scanned = await scanPackage(packageDir);

  if (!scanned) {
    return;
  }

  console.info('');
  console.info('Next steps:');
  if (type === 'module') {
    console.info('  1. Open the RevaHub UI');
    console.info('  2. Go to Instances → New Instance');
    console.info(`  3. Select "${scanned.revahub.label}" and configure options`);
  } else {
    console.info('  1. Open the RevaHub UI');
    console.info('  2. Go to Tasks → New Task');
    console.info(`  3. Select "${scanned.revahub.label}" and configure options`);
  }
}

/**
 * CLI wrapper for uninstallPackage that takes type + name format.
 *
 * @param type - Package type
 * @param name - Short package name
 * @param workingDir - Working directory
 */
export async function cliUninstallPackage(
  type: 'module' | 'task',
  name: string,
  workingDir: string
): Promise<void> {
  const packageName = resolvePackageName(type, name);
  const nativePackages = getNativePackages();

  await uninstallPackage(packageName, { workingDir }, nativePackages);

  console.info('');
  console.info('Note: Associated module instances or task configurations');
  console.info('will be flagged as "missing" in the UI. Delete them via the UI');
  console.info('or reinstall the package to restore them.');
}
