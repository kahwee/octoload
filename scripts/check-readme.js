import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from '@typescript/typescript6';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
assert.ok(changelog.includes(`## ${manifest.version} —`));
if (changelog.includes(`## ${manifest.version} — Unreleased`)) {
  assert.ok(
    readme.includes(`This checkout is ${manifest.version}, unreleased.`)
  );
  assert.ok(readme.includes(`octoload-${manifest.version}.tgz`));
}
assert.ok(!manifest.keywords.includes('multipart'));

// README links must resolve both on GitHub and on the npm package page.
const repositoryPrefix = 'https://github.com/kahwee/octoload/blob/main/';
for (const [, target] of readme.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
  if (target.startsWith(repositoryPrefix)) {
    const path = target.slice(repositoryPrefix.length).split('#')[0];
    assert.ok(existsSync(join(root, path)), `Broken README link: ${target}`);
  } else {
    assert.ok(
      target.startsWith('https://') || target.startsWith('#'),
      `Use an absolute README link for npm: ${target}`
    );
  }
}
const blocks = [...readme.matchAll(/```(ts|tsx|json)\n([\s\S]*?)\n```/g)];

assert.ok(blocks.length >= 5, 'Expected several runnable README examples');

for (const [index, match] of blocks.entries()) {
  const [, language, source] = match;
  if (language === 'json') {
    JSON.parse(source);
    continue;
  }

  const file = ts.createSourceFile(
    `readme-example-${index}.${language}`,
    source,
    ts.ScriptTarget.Latest,
    true,
    language === 'tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const errors = file.parseDiagnostics.filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );
  assert.equal(
    errors.length,
    0,
    `README ${language} example ${index + 1} has syntax errors: ${errors
      .map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n'))
      .join('; ')}`
  );
}

const component = blocks.find(([, language]) => language === 'tsx');
assert.ok(component, 'Expected a browser component example');
const filename = join(root, 'readme-example.tsx');
const compilerOptions = {
  noEmit: true,
  strict: true,
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  jsx: ts.JsxEmit.ReactJSX,
  paths: { 'octoload/client': [join(root, 'src/client/index.ts')] },
};
const host = ts.createCompilerHost(compilerOptions);
const readFile = host.readFile.bind(host);
const fileExists = host.fileExists.bind(host);
host.readFile = (path) => (path === filename ? component[2] : readFile(path));
host.fileExists = (path) => path === filename || fileExists(path);
const program = ts.createProgram([filename], compilerOptions, host);
const diagnostics = ts.getPreEmitDiagnostics(program);
assert.equal(
  diagnostics.length,
  0,
  ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (path) => path,
    getCurrentDirectory: () => root,
    getNewLine: () => '\n',
  })
);

console.log(
  `README examples checked: ${blocks.length} TypeScript/JSON blocks; browser component typechecked.`
);
