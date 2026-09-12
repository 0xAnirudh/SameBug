import '../helpers/env.js';
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprint } from '../../src/fingerprint/index.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/traces');
const LABELS = JSON.parse(readFileSync(join(DIR, 'expected-groups.json'), 'utf8'));

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.txt'))
  .sort();

const corpus = files.map((file) => ({
  file,
  group: LABELS[file],
  result: fingerprint(readFileSync(join(DIR, file), 'utf8')),
}));

describe('fingerprint grouping', () => {
  it('has a label for every fixture', () => {
    expect(files.length).toBeGreaterThanOrEqual(20);
    for (const { file, group } of corpus) {
      expect(group, `${file} has no group label`).toBeTruthy();
    }
  });

  it('parses every fixture — a trace that does not parse cannot group', () => {
    const unparsed = corpus.filter((c) => !c.result).map((c) => c.file);
    expect(unparsed).toEqual([]);
  });

  /**
   * The real measurement. Twenty traces make C(20,2) = 190 pairs, and each pair
   * is one prediction: do these two group or not?
   *
   * Reported as precision and recall rather than one accuracy number because
   * the two errors are not equally bad. A false positive merges two genuinely
   * different bugs and hides one of them forever. A false negative just shows a
   * duplicate. Precision is the number to protect.
   */
  it('groups the right pairs and separates the rest', () => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let tn = 0;

    const falsePositives = [];
    const falseNegatives = [];

    for (let i = 0; i < corpus.length; i++) {
      for (let j = i + 1; j < corpus.length; j++) {
        const a = corpus[i];
        const b = corpus[j];

        const actualSame = a.group === b.group;
        const predictedSame = a.result?.fingerprint === b.result?.fingerprint;

        if (actualSame && predictedSame) tp++;
        else if (!actualSame && predictedSame) {
          fp++;
          falsePositives.push(`${a.file} <-> ${b.file}`);
        } else if (actualSame && !predictedSame) {
          fn++;
          falseNegatives.push(`${a.file} <-> ${b.file}`);
        } else tn++;
      }
    }

    const pairs = tp + fp + fn + tn;
    const precision = tp / (tp + fp) || 0;
    const recall = tp / (tp + fn) || 0;

    // Printed so the number in the README is one that was actually produced.
    console.log(
      `\n  pairs ${pairs}  TP ${tp}  FP ${fp}  FN ${fn}  TN ${tn}` +
        `\n  precision ${(precision * 100).toFixed(1)}%  recall ${(recall * 100).toFixed(1)}%`
    );
    if (falsePositives.length) console.log('  merged wrongly:\n    ' + falsePositives.join('\n    '));
    if (falseNegatives.length) console.log('  missed:\n    ' + falseNegatives.join('\n    '));

    expect(pairs).toBe((corpus.length * (corpus.length - 1)) / 2);

    // Merging two different bugs is the expensive error. Nothing may merge wrongly.
    expect(falsePositives).toEqual([]);
    expect(recall).toBeGreaterThanOrEqual(0.85);
  });

  it('gives every group exactly one fingerprint', () => {
    const byGroup = new Map();
    for (const { group, result, file } of corpus) {
      if (!byGroup.has(group)) byGroup.set(group, new Map());
      byGroup.get(group).set(result?.fingerprint ?? `unparsed:${file}`, file);
    }

    const split = [...byGroup.entries()]
      .filter(([, prints]) => prints.size > 1)
      .map(([group, prints]) => `${group} split into ${prints.size}: ${[...prints.values()]}`);

    expect(split).toEqual([]);
  });

  it('produces a 16-character hex fingerprint', () => {
    for (const { file, result } of corpus) {
      expect(result.fingerprint, file).toMatch(/^[0-9a-f]{16}$/);
    }
  });
});
