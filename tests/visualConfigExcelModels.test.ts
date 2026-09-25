import { describe, expect, test } from 'bun:test';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse as parseYaml } from 'yaml';
import { useVisualConfig } from '../src/hooks/useVisualConfig';

/**
 * Renders the visual config hook, applies one change, and returns the YAML the
 * editor would save.
 */
function applyChange(
  yaml: string,
  change: Parameters<ReturnType<typeof useVisualConfig>['setVisualValues']>[0]
): Record<string, unknown> {
  function Harness() {
    const visualConfig = useVisualConfig();
    const [phase, setPhase] = useState(0);

    if (phase === 0) {
      // Mirror the real page: the YAML is loaded first, so the baseline is the
      // current configuration and only genuine edits are marked dirty.
      visualConfig.loadVisualValuesFromYaml(yaml);
      visualConfig.setVisualValues(change);
      setPhase(1);
    } else {
      return createElement('pre', null, visualConfig.applyVisualChangesToYaml(yaml));
    }

    return null;
  }

  const markup = renderToStaticMarkup(createElement(Harness));
  const result = markup.slice('<pre>'.length, -'</pre>'.length);
  return parseYaml(result) as Record<string, unknown>;
}

describe('visual config excel models switch', () => {
  test('enabling writes a provider entry', () => {
    const result = applyChange('debug: false\n', { excelModelsEnabled: true });

    // An empty entry is enough: the Codex credentials already loaded are used.
    expect(result['excel-api-key']).toEqual([{}]);
  });

  test('disabling removes the section entirely', () => {
    const result = applyChange(
      'debug: false\nexcel-api-key:\n  - {}\n',
      { excelModelsEnabled: false }
    );

    // Absent means off; the backend registers no Excel models.
    expect(result['excel-api-key']).toBeUndefined();
    // Unrelated configuration must survive the edit.
    expect(result.debug).toBe(false);
  });

  test('enabling preserves an operator-authored section', () => {
    // A hand-written entry (e.g. an explicit token) must not be replaced by the
    // switch, or the operator would silently lose their configuration.
    const existing = [{ 'base-url': 'https://example.invalid', headers: { 'X-Custom': 'value' } }];
    const result = applyChange(
      `debug: false\nexcel-api-key:\n  - base-url: https://example.invalid\n    headers:\n      X-Custom: value\n`,
      { excelModelsEnabled: true }
    );

    expect(result['excel-api-key']).toEqual(existing);
  });

  test('an entry marked disabled reads as off', () => {
    // A disabled entry registers nothing, so the switch must show off rather
    // than claiming the models are available.
    const result = applyChange('debug: false\nexcel-api-key:\n  - disabled: true\n', {});

    expect(result['excel-api-key']).toEqual([{ disabled: true }]);
  });
});
