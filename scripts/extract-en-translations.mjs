/**
 * Copies `src/i18n/bundles/en.json` into the Go embed path so the API bundle matches the app.
 * Edit strings in `src/i18n/bundles/en.json` (source of truth for EN UI text).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const appPath = path.join(root, 'src/i18n/bundles/en.json');
const goPath = path.join(root, 'backend/go/internal/i18n/en.json');

const jsonOut = fs.readFileSync(appPath, 'utf8');
const obj = JSON.parse(jsonOut);
fs.mkdirSync(path.dirname(goPath), { recursive: true });
fs.writeFileSync(goPath, `${JSON.stringify(obj, null, 2)}\n`);
console.log('synced', appPath, '->', goPath, 'keys=', Object.keys(obj).length);
