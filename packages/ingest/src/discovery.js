import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function discoverProjects(scanDir = os.homedir()) {
  const projects = [];
  const entries = fs.readdirSync(scanDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(scanDir, entry.name);
    if (fs.existsSync(path.join(fullPath, '.git'))) {
      projects.push({ name: entry.name, path: fullPath });
    }
  }
  return projects;
}

export function matchProject(sessionPath, projects) {
  if (!sessionPath) return 'other';
  const normalized = sessionPath.replace(/\\/g, '/');
  for (const project of projects) {
    if (normalized.startsWith(project.path.replace(/\\/g, '/'))) {
      return project.name;
    }
  }
  return 'other';
}
