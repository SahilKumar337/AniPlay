import fs from 'fs';
import { join } from 'path';

function findJavac(dir) {
  try {
    const files = fs.readdirSync(dir);
    for (const f of files) {
      const fullPath = join(dir, f);
      // Skip folders that definitely don't have JDK/JRE
      if (
        f.startsWith('.') ||
        f === 'Windows' ||
        f === ' HoYoPlay' ||
        f === 'hoYoPlay' ||
        f === 'HoYoPlay' ||
        f === 'Games' ||
        f === 'CEF' ||
        f === 'node_modules' ||
        f === 'System32' ||
        f === 'SysWOW64' ||
        f === 'Cheat Engine' ||
        f === 'HoYoPlay' ||
        f === 'WildLifeC' ||
        f === 'Microsoft'
      ) continue;
      
      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }
      
      if (stat.isDirectory()) {
        const found = findJavac(fullPath);
        if (found) return found;
      } else if (f.toLowerCase() === 'javac.exe') {
        return fullPath;
      }
    }
  } catch {
    // Ignore read errors
  }
  return null;
}

const searchRoots = [
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\Users\\sahil\\AppData\\Local',
  'C:\\Users\\sahil\\AppData\\Roaming'
];

let javacPath = null;
for (const root of searchRoots) {
  console.log(`Searching root: ${root}`);
  javacPath = findJavac(root);
  if (javacPath) break;
}

if (javacPath) {
  console.log(`FOUND JAVAC: ${javacPath}`);
} else {
  console.log('Javac not found anywhere.');
}
