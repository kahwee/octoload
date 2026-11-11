import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Codecov secret is confined to trusted main pushes', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/ci.yml', import.meta.url),
    'utf8'
  );
  const steps = workflow.split(/\n      - name:/);
  const secretSteps = steps.filter((step) =>
    step.includes('secrets.CODECOV_TOKEN')
  );
  assert.equal(secretSteps.length, 1);
  assert.match(
    secretSteps[0],
    /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main' && matrix\.node-version == '24\.22\.1'/
  );
  assert.doesNotMatch(workflow, /pull_request_target|workflow_run/);
});
