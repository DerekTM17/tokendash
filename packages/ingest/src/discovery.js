import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function scanDir(dir, depth, results, seen) {
  if (depth <= 0 || !fs.existsSync(dir)) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(dir, entry.name);
    if (seen.has(fullPath)) continue;
    seen.add(fullPath);

    if (fs.existsSync(path.join(fullPath, '.git'))) {
      results.push({ name: entry.name, path: fullPath });
    }
    scanDir(fullPath, depth - 1, results, seen);
  }
}

export function discoverProjects() {
  const roots = [
    os.homedir(),
    path.join(os.homedir(), 'projects'),
    path.join(os.homedir(), 'opencode', 'projects'),
  ];
  const projects = [];
  const seen = new Set();
  for (const root of roots) {
    scanDir(root, 3, projects, seen);
  }
  return projects;
}

export function matchProject(sessionPath, projects) {
  if (!sessionPath) return 'other';
  const normalized = sessionPath.replace(/\\/g, '/');
  for (const project of projects) {
    const projPath = project.path.replace(/\\/g, '/');
    if (normalized === projPath || (normalized.startsWith(projPath) && normalized.charAt(projPath.length) === '/')) {
      return project.name;
    }
  }
  return 'other';
}
