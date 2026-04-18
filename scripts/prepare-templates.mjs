import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const destRoot = path.join(projectRoot, "public", "templates", "餐饮");
const indexPath = path.join(projectRoot, "public", "templates", "template-index.json");

const defaultSrc = path.resolve(projectRoot, "..", "..", "海报模板", "餐饮");
const srcRoot = process.env.TEMPLATES_SRC
  ? path.resolve(process.env.TEMPLATES_SRC)
  : defaultSrc;

const exts = new Set([".webp", ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff"]);

function rmrf(p) {
  if (!fs.existsSync(p)) return;
  fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src, { withFileTypes: true })) {
    if (name.name.startsWith(".")) continue;
    const from = path.join(src, name.name);
    const to = path.join(dest, name.name);
    if (name.isDirectory()) {
      copyDir(from, to);
    } else if (name.isFile()) {
      const ext = path.extname(name.name).toLowerCase();
      if (!exts.has(ext)) continue;
      fs.copyFileSync(from, to);
    }
  }
}

function walkCategories(root) {
  if (!fs.existsSync(root)) return { categories: [] };
  const categories = [];
  for (const name of fs.readdirSync(root, { withFileTypes: true })) {
    if (!name.isDirectory() || name.name.startsWith(".")) continue;
    const catDir = path.join(root, name.name);
    const files = fs
      .readdirSync(catDir)
      .filter((f) => exts.has(path.extname(f).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    const templates = files.map((file) => ({
      id: `${name.name}/${file}`,
      file,
      path: `/templates/餐饮/${encodeURIComponent(name.name)}/${encodeURIComponent(file)}`,
    }));
    categories.push({
      id: name.name,
      name: name.name,
      templates,
    });
  }
  categories.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
  return { categories };
}

function hasCommittedTemplates() {
  if (!fs.existsSync(destRoot)) return false;
  const entries = fs.readdirSync(destRoot, { withFileTypes: true });
  return entries.some((e) => e.isDirectory() && !e.name.startsWith("."));
}

if (!fs.existsSync(srcRoot)) {
  if (hasCommittedTemplates()) {
    const index = walkCategories(destRoot);
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
    console.log(
      `[prepare-templates] No external TEMPLATES_SRC; using templates already in repo (${index.categories.length} categories).`,
    );
    process.exit(0);
  }
  console.warn(
    `[prepare-templates] Source not found: ${srcRoot}\n` +
      `Set TEMPLATES_SRC, place templates at ../../海报模板/餐饮, or commit files under public/templates/餐饮/.`,
  );
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, JSON.stringify({ categories: [] }, null, 2));
  process.exit(0);
}

rmrf(destRoot);
copyDir(srcRoot, destRoot);
const index = walkCategories(destRoot);
fs.mkdirSync(path.dirname(indexPath), { recursive: true });
fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
console.log(
  `[prepare-templates] Copied templates to public/templates/餐饮 (${index.categories.length} categories).`,
);
