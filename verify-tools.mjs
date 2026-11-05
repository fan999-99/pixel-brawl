import { readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));
const project = join(root, 'project');
const require = createRequire(join(project, 'package.json'));
const expected = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));
const installed = [];
for (const [name, version] of Object.entries({ ...expected.dependencies, ...expected.devDependencies })) {
  const file = join(project, 'node_modules', ...name.split('/'), 'package.json');
  const actual = JSON.parse(await readFile(file, 'utf8'));
  if (actual.version !== version) throw new Error(`${name}: expected ${version}, got ${actual.version}`);
  installed.push({ name, version, status: 'installed' });
}
await access(join(project, 'node_modules', 'phaser4-rex-plugins', 'plugins', 'virtualjoystick-plugin.js'));
const core = await import(pathToFileURL(require.resolve('@colyseus/core')));
const sdk = await import(pathToFileURL(require.resolve('@colyseus/sdk')));
const transport = await import(pathToFileURL(require.resolve('@colyseus/ws-transport')));
const capacitor = await import(pathToFileURL(require.resolve('@capacitor/core')));
if (typeof core.Room !== 'function' || typeof sdk.Client !== 'function' || typeof transport.WebSocketTransport !== 'function' || !capacitor.Capacitor) throw new Error('A required runtime export is missing.');
const viteVersion = execFileSync(process.execPath, [join(project, 'node_modules', 'vite', 'bin', 'vite.js'), '--version'], { encoding: 'utf8', cwd: project }).trim();
const capacitorVersion = execFileSync(process.execPath, [join(project, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor'), '--version'], { encoding: 'utf8', cwd: project }).trim();
const report = { verifiedAt: new Date().toISOString(), node: process.version, packages: installed, runtimeImports: 'passed', joystickFile: 'present', vite: viteVersion, capacitor: capacitorVersion };
await writeFile(join(root, 'verification-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
