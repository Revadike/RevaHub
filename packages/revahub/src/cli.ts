#!/usr/bin/env node
import { Command } from 'commander';

import { createPackage, cliInstallPackage, cliUninstallPackage } from './cli/commands.js';
import { PackageScanner } from './core/package-scanner.js';
import { start, getWorkingDir } from './index.js';

const program = new Command();

program
  .name('revahub')
  .description('RevaHub - A self-hosted, event-driven automation platform')
  .version('0.1.0');

program
  .command('start', { isDefault: true })
  .description('Start the RevaHub server')
  .action(async () => {
    await start();
  });

program
  .command('create')
  .description('Create a new module or task package')
  .argument('<type>', 'Package type: "module" or "task"')
  .argument('<name>', 'Short name for the package (e.g., "steam" becomes "revahub-module-steam")')
  .option('--path <dir>', 'Directory to create the package in', process.cwd())
  .action(async (type: string, name: string, options: { path: string }) => {
    if (type !== 'module' && type !== 'task') {
      console.error('Error: Type must be "module" or "task"');
      process.exit(1);
    }

    try {
      await createPackage(type, name, options.path);
      console.info(`✓ Created ${type} package: revahub-${type}-${name}`);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('install')
  .description('Install a module or task package')
  .argument('<type>', 'Package type: "module" or "task"')
  .argument('<name>', 'Package name (short name or full npm package name)')
  .action(async (type: string, name: string) => {
    if (type !== 'module' && type !== 'task') {
      console.error('Error: Type must be "module" or "task"');
      process.exit(1);
    }

    const workingDir = getWorkingDir();

    try {
      const scanner = await PackageScanner.create();
      await cliInstallPackage(type, name, scanner, workingDir);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command('uninstall')
  .description('Uninstall a module or task package')
  .argument('<type>', 'Package type: "module" or "task"')
  .argument('<name>', 'Package name (short name or full npm package name)')
  .action(async (type: string, name: string) => {
    if (type !== 'module' && type !== 'task') {
      console.error('Error: Type must be "module" or "task"');
      process.exit(1);
    }

    const workingDir = getWorkingDir();

    try {
      const scanner = await PackageScanner.create();
      await cliUninstallPackage(type, name, scanner, workingDir);
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program.parse();
