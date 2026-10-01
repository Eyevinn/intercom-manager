import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

// Regression coverage for issue #274: dotenv.config() must live only in the
// canonical loader src/config/load-env.ts. Redundant dotenv.config() calls in
// route/other modules are CWD-dependent, conflict with the canonical loader and
// silently fail in production Docker builds (no .env present).
const SRC_DIR = join(__dirname);
const CANONICAL_LOADER = join('config', 'load-env.ts');

function listTsFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...listTsFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      files.push(full);
    }
  }
  return files;
}

describe('env loading hygiene (issue #274)', () => {
  it('only the canonical loader calls dotenv.config()', () => {
    const offenders: string[] = [];
    for (const file of listTsFiles(SRC_DIR)) {
      if (file.endsWith(CANONICAL_LOADER)) {
        continue;
      }
      const contents = readFileSync(file, 'utf8');
      // Ignore comment lines so documentation mentioning dotenv.config() does
      // not trip the check.
      const codeCallsDotenv = contents
        .split('\n')
        .some(
          (line) =>
            /dotenv\.config\s*\(/.test(line) &&
            !line.trimStart().startsWith('//')
        );
      if (codeCallsDotenv) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('src/api_ingests.ts does not import dotenv', () => {
    const contents = readFileSync(join(SRC_DIR, 'api_ingests.ts'), 'utf8');
    expect(contents).not.toMatch(/from ['"]dotenv['"]/);
  });

  it('src/server.ts loads env centrally via the canonical loader', () => {
    const contents = readFileSync(join(SRC_DIR, 'server.ts'), 'utf8');
    expect(contents).toMatch(/import ['"]\.\/config\/load-env['"]/);
  });
});
