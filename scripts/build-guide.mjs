import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const docsSite = path.join(root, 'docs-site');
const docsDir = path.join(docsSite, 'docs');
const staticDir = path.join(docsSite, 'static');
const buildDir = path.join(docsSite, 'build');
const outDir = path.join(root, 'frontend', 'public', 'guide');
const appFile = path.join(root, 'frontend', 'src', 'App.tsx');
const routesFile = path.join(docsSite, 'routes.json');

const IMAGE_ALLOWLIST = ['00-gioi-thieu', '11-van-hanh-su-co', '12-phu-luc'];
const IMAGE_PATTERN = /!\[[^\]]*\]\((\/img\/[^)\s]+)|<img[^>]+src="(\/img\/[^"]+)"/g;

function fail(message) {
  console.error(`LỖI: ${message}`);
  process.exit(1);
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return [full];
  });
}

function collectDocs() {
  if (!fs.existsSync(docsDir)) fail(`Không thấy thư mục nội dung ${docsDir}`);
  return walk(docsDir).filter((file) => /\.mdx?$/.test(file));
}

const allowMissingImages = process.argv.includes('--allow-missing-images');

function checkImages(files) {
  const missing = [];
  const errors = [];

  for (const file of files) {
    const rel = path.relative(docsDir, file).split(path.sep).join('/');
    const name = path.basename(file).replace(/\.mdx?$/, '');
    const text = fs.readFileSync(file, 'utf8');
    const refs = [...text.matchAll(IMAGE_PATTERN)].map((match) =>
      decodeURIComponent(match[1] ?? match[2])
    );

    for (const ref of refs) {
      const asset = path.join(staticDir, ref.replace(/^\//, ''));
      if (!fs.existsSync(asset)) missing.push(`${rel} -> ${ref}`);
    }

    if (refs.length === 0 && !IMAGE_ALLOWLIST.includes(name)) {
      errors.push(`${rel}: chưa có ảnh minh họa`);
    }
  }

  for (const item of missing) console.error(`  ảnh thiếu: ${item}`);
  for (const item of errors) console.error(`  chương thiếu ảnh: ${item}`);

  if ((missing.length || errors.length) && !allowMissingImages) {
    fail(`kiểm tra ảnh thất bại (${missing.length} ảnh thiếu, ${errors.length} chương thiếu ảnh)`);
  }
  if (missing.length || errors.length) {
    console.warn(`Ảnh: ${missing.length} ảnh thiếu, ${errors.length} chương thiếu ảnh (bỏ qua vì --allow-missing-images).`);
    return;
  }
  console.log(`Ảnh: hợp lệ (${files.length} chương).`);
}

function checkRoutes() {
  if (!fs.existsSync(routesFile)) fail(`Không thấy ${routesFile}`);
  const app = fs.readFileSync(appFile, 'utf8');
  const routes = JSON.parse(fs.readFileSync(routesFile, 'utf8'));
  const unknown = routes.filter((route) =>
    route === '/' ? !/<Route\s+index\b/.test(app) : !app.includes(`path="${route}"`)
  );

  if (unknown.length) {
    for (const route of unknown) console.error(`  route không có trong App.tsx: ${route}`);
    fail(`có ${unknown.length} route tài liệu tham chiếu nhưng ứng dụng không khai báo`);
  }
  console.log(`Route: hợp lệ (${routes.length} route).`);
}

function runBuild() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['run', 'build'], {
    cwd: docsSite,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  if (result.status !== 0) fail('build Docusaurus thất bại');
}

function copyBuild() {
  if (!fs.existsSync(buildDir)) fail('không thấy docs-site/build sau khi build');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(outDir), { recursive: true });
  fs.cpSync(buildDir, outDir, { recursive: true });
  const size = walk(outDir).reduce((total, file) => total + fs.statSync(file).size, 0);
  console.log(`Đã copy tài liệu sang ${path.relative(root, outDir)} (${(size / 1024 / 1024).toFixed(1)} MB).`);
}

const checkOnly = process.argv.includes('--check');
const skipBuild = process.argv.includes('--skip-build');
const files = collectDocs();

checkImages(files);
checkRoutes();

if (!checkOnly) {
  if (!skipBuild) runBuild();
  copyBuild();
}

console.log(checkOnly ? 'Kiểm tra tài liệu: PASS.' : 'Build tài liệu: PASS.');
