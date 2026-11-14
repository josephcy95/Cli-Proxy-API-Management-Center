import { describe, expect, test } from 'bun:test';
import { parseDocument } from 'yaml';
import { runVisualConfig } from './helpers/visualConfig';

describe('Antigravity model discovery setting', () => {
  for (const nested of [false, true]) {
    for (const mode of ['canonical', 'variants', 'both'] as const) {
      test(`${nested ? 'v8' : 'legacy'} saves ${mode} and preserves siblings`, () => {
        const source = nested
          ? 'version: 8\noauth:\n  providers:\n    antigravity:\n      sensitive-words: [secret]\n      connection-pool:\n        enabled: true\n'
          : 'antigravity:\n  sensitive-words: [secret]\n  connection-pool:\n    enabled: true\n';
        const config = runVisualConfig(source, [{ antigravityModelListMode: mode }]);
        const output = config.applyVisualChangesToYaml(source);
        const parsed = parseDocument(output).toJS();
        const ag = nested ? parsed.oauth.providers.antigravity : parsed.antigravity;
        expect(ag['model-list-mode'] ?? 'canonical').toBe(mode);
        expect(ag['sensitive-words']).toEqual(['secret']);
        expect(ag['connection-pool'].enabled).toBe(true);
        expect(runVisualConfig(output).visualValues.antigravityModelListMode).toBe(mode);
      });
    }
  }
  test('untouched config keeps implicit default', () => {
    const source = 'antigravity:\n  sensitive-words: [secret]\n';
    const config = runVisualConfig(source);
    expect(parseDocument(config.applyVisualChangesToYaml(source)).toJS()).toEqual(
      parseDocument(source).toJS()
    );
  });
});
