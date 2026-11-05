import { mkdir, readFile, writeFile, rename, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const downloads = join(root, 'downloads');
const project = join(root, 'project');
await Promise.all([mkdir(downloads, { recursive: true }), mkdir(project, { recursive: true })]);

async function get(url) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await fetch(url, {
        headers: { 'User-Agent': 'PixelBrawl-Official-Downloads/1.0' },
        signal: AbortSignal.timeout(120000),
      });
      if (!result.ok) throw new Error(`HTTP ${result.status}: ${url}`);
      return result;
    } catch (error) { last = error; }
  }
  throw last;
}

const nodeVersion = '24.22.1';
const nodeFilename = `node-v${nodeVersion}-win-x64.zip`;
const nodeBase = `https://nodejs.org/dist/v${nodeVersion}/`;
const checksums = await (await get(`${nodeBase}SHASUMS256.txt`)).text();
const nodeChecksum = checksums.split(/\r?\n/).map(line => line.trim().split(/\s+/)).find(parts => parts[1] === nodeFilename)?.[0];
if (!nodeChecksum || !/^[0-9a-f]{64}$/.test(nodeChecksum)) throw new Error('Official Node checksum missing.');
await writeFile(join(downloads, 'Node-SHASUMS256.txt'), checksums);

const files = [
  { name: nodeFilename, url: `${nodeBase}${nodeFilename}`, sha256: nodeChecksum },
  {
    name: 'Tiled-1.12.2-Windows-x64.msi',
    url: 'https://github.com/mapeditor/tiled/releases/download/v1.12.2/Tiled-1.12.2_Windows-10%2B_x86_64.msi',
    sha256: '11a0e6c97cc105e07a57ea9995f2704617986722de4ab699d286dab0d2becc3f',
    checksumSource: 'https://github.com/mapeditor/tiled/releases/expanded_assets/v1.12.2',
  },
];

async function download(file) {
  const target = join(downloads, file.name);
  let data;
  try { data = await readFile(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (data && createHash('sha256').update(data).digest('hex') === file.sha256) {
    console.log(`Already verified: ${file.name}`);
    return { ...file, bytes: data.length, verified: true };
  }
  if (data) throw new Error(`Existing file differs; refusing to overwrite ${file.name}`);
  console.log(`Downloading: ${file.name}`);
  data = Buffer.from(await (await get(file.url)).arrayBuffer());
  const hash = createHash('sha256').update(data).digest('hex');
  if (hash !== file.sha256) throw new Error(`Checksum mismatch: ${file.name}`);
  await writeFile(`${target}.part`, data);
  await rename(`${target}.part`, target);
  console.log(`Verified: ${file.name} (${(data.length / 1048576).toFixed(1)} MB)`);
  return { ...file, bytes: data.length, verified: true };
}

const dependencyNames = [
  'phaser', 'phaser4-rex-plugins', '@colyseus/sdk', '@colyseus/core',
  '@colyseus/ws-transport', '@colyseus/schema',
  '@capacitor/core', '@capacitor/android', '@capacitor/ios',
];
const devDependencyNames = ['@capacitor/cli', 'typescript', 'vite', 'tsx', '@types/node'];
const metadataPromise = Promise.all([...dependencyNames, ...devDependencyNames].map(async name => {
  const info = await (await get(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`)).json();
  if (info.name !== name || !/^\d+\.\d+\.\d+$/.test(info.version)) throw new Error(`Unexpected registry metadata: ${name}`);
  return { name, version: info.version, integrity: info.dist?.integrity, tarball: info.dist?.tarball };
}));
const [fileResults, metadata] = await Promise.all([Promise.allSettled(files.map(download)), metadataPromise]);
const downloaded = fileResults.map((result, index) => {
  if (result.status === 'fulfilled') return result.value;
  console.error(`Download pending: ${files[index].name}: ${result.reason.message}`);
  return { ...files[index], verified: false, error: result.reason.message };
});

const versions = Object.fromEntries(metadata.map(item => [item.name, item.version]));
if (!versions.phaser.startsWith('4.') || !versions['phaser4-rex-plugins'].startsWith('4.')) throw new Error('Phaser major versions do not match.');
if (!versions['@colyseus/sdk'].startsWith('0.18.') || !versions['@colyseus/core'].startsWith('0.18.')) throw new Error('Colyseus SDK/server minor versions do not match.');
for (const name of ['@capacitor/android', '@capacitor/ios', '@capacitor/cli']) {
  if (versions[name] !== versions['@capacitor/core']) throw new Error(`Capacitor versions do not match: ${name}`);
}
const packageText = JSON.stringify({
  name: 'pixel-brawl', version: '0.1.0', private: true, type: 'module',
  description: 'Downloaded development dependencies for a mobile and web pixel fighting game.',
  engines: { node: '>=24.0.0' },
  scripts: { 'check:tools': 'node ../verify-tools.mjs' },
  dependencies: Object.fromEntries(dependencyNames.map(name => [name, versions[name]])),
  devDependencies: Object.fromEntries(devDependencyNames.map(name => [name, versions[name]])),
}, null, 2) + '\n';
try {
  const previous = await readFile(join(project, 'package.json'), 'utf8');
  if (previous !== packageText) throw new Error('Existing package.json differs; refusing to overwrite.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await writeFile(join(project, 'package.json'), packageText);
}
await writeFile(join(project, '.npmrc'), 'registry=https://registry.npmjs.org/\nsave-exact=true\n');
await writeFile(join(root, 'download-manifest.json'), JSON.stringify({
  preparedAt: new Date().toISOString(), platform: 'Windows x64',
  files: downloaded, packages: metadata,
  aseprite: { status: 'Not downloaded: paid license or existing purchase required.', officialUrl: 'https://www.aseprite.org/' },
}, null, 2) + '\n');
console.log('Official downloads and exact dependency versions are ready.');
if (!downloaded[0].verified) throw new Error('Node.js download is still pending.');
