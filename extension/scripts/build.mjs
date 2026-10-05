// Builds dist/firefox and dist/chromium (Brave, Chrome, Edge…) from the shared sources.
// Usage: node scripts/build.mjs [firefox|chromium]...   (default: both)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const targets = process.argv.slice(2).length ? process.argv.slice(2) : ['firefox', 'chromium'];

for (const target of targets) {
  const manifest = path.join(root, 'manifests', `${target}.json`);
  if (!fs.existsSync(manifest)) throw new Error(`Unknown target ${target}`);
  const out = path.join(root, 'dist', target);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  fs.cpSync(path.join(root, 'src'), path.join(out, 'src'), { recursive: true });
  fs.cpSync(path.join(root, 'icons'), path.join(out, 'icons'), { recursive: true });
  const json = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  // Test builds only: pre-grant hosts (e.g. http://localhost/*) since automated browsers cannot
  // click the permission prompt. Release builds ask for the server's origin at setup.
  if (process.env.EXTRA_HOST_PERMISSIONS) {
    json.host_permissions.push(...process.env.EXTRA_HOST_PERMISSIONS.split(',').map(s => s.trim()).filter(Boolean));
  }
  fs.writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(json, null, 2)}\n`);
  console.log(`built ${path.relative(root, out)}`);
}
