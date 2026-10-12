import { describe, expect, test } from 'bun:test';
import { parseDocument } from 'yaml';
import {
  readVisualConfigRecord,
  visualConfigDocument,
} from '../src/components/config/visualConfigLayout';
import { runVisualConfig } from './helpers/visualConfig';

const yaml = `server:
  port: 8317
  tls: {enable: false}
observability:
  logs: {debug: false} # fork log comment
access:
  api-keys:
    - client-key # Joseph
api-keys:
  codex:
    - name: paid
      keys: [{api-key: upstream-key}]
  future-provider:
    - name: retained
      keys: [{api-key: future-key}]
requests:
  payload:
    default: [] # preserve payload
upstream:
  xai: {auto-disable-permission-denied: true, future-policy: retained}
oauth:
  providers:
    codex: {private-instructions: {content: private}}
future: retained
`;

describe('fork visual editor canonical YAML compatibility', () => {
  test('reads canonical fields and named client keys, preserves untouched YAML values/comments', () => {
    const config = runVisualConfig(yaml);
    expect(config.visualParseError).toBeNull();
    expect(config.visualValues.port).toBe('8317');
    expect(config.visualValues.debug).toBe(false);
    expect(config.visualValues.apiKeysText).toBe('client-key\tJoseph');
    expect(parseDocument(config.applyVisualChangesToYaml(yaml)).toJS()).toEqual(
      parseDocument(yaml).toJS()
    );
  });
  test('writes dirty canonical values without legacy collisions or removing providers', () => {
    const config = runVisualConfig(yaml, [
      { debug: true, port: '9000', apiKeysText: 'new-key\tNamed' },
    ]);
    const output = config.applyVisualChangesToYaml(yaml);
    const doc = parseDocument(output);
    expect(doc.getIn(['observability', 'logs', 'debug'])).toBe(true);
    expect(doc.getIn(['server', 'port'])).toBe(9000);
    expect(doc.hasIn(['debug'])).toBe(false);
    expect(doc.hasIn(['port'])).toBe(false);
    expect(doc.toJS()['api-keys'].codex[0].keys[0]['api-key']).toBe('upstream-key');
    expect(runVisualConfig(output).visualValues.apiKeysText).toBe('new-key\tNamed');
    expect(output).toContain('preserve payload');
    expect(output).toContain('future-policy: retained');
    expect(output).toContain('content: private');
  });
  test('empty client keys delete access keys only and preserve provider groups', () => {
    const output = runVisualConfig(yaml, [
      { apiKeysText: '' },
    ]).applyVisualChangesToYaml(yaml);
    const doc = parseDocument(output);
    expect(doc.hasIn(['access', 'api-keys'])).toBe(false);
    expect(doc.hasIn(['api-keys', 'codex'])).toBe(true);
    expect(doc.toJS()['api-keys']['future-provider']).toEqual(
      parseDocument(yaml).toJS()['api-keys']['future-provider']
    );
  });
  test('canonical false/null/empty wins while missing leaves fall back to legacy', () => {
    const doc = parseDocument(
      `debug: true\nremote-management: {allow-remote: true, secret-key: legacy}\nmanagement: {allow-remote: false}\nobservability: {logs: {debug: null}}\naccess: {api-keys: []}\napi-keys: [legacy-key]\n`
    );
    const view = readVisualConfigRecord(doc);
    expect(view.debug).toBeNull();
    expect(view['remote-management']).toEqual({ 'allow-remote': false, 'secret-key': 'legacy' });
    expect(view['api-keys']).toEqual([]);
    const adapter = visualConfigDocument(doc);
    adapter.deleteIn(['remote-management', 'secret-key']);
    expect(doc.hasIn(['remote-management', 'secret-key'])).toBe(false);
  });
  test('retired sections are pruned on save without changing unrelated configuration', () => {
    for (const retired of [
      'excel-api-key: [{base-url: https://retired.invalid, disabled: false}]\n',
      'api-keys:\n  excel: [{name: old, keys: [{}]}]\n',
      'excel-api-key: [{}]\napi-keys:\n  excel: [{name: old, keys: [{}]}]\n',
    ]) {
      const source = retired +
        'access: {api-keys: [client-key]}\n' +
        'oauth: {providers: {codex: {private-instructions: {content: private}}}}\n' +
        'future: {retained: true}\n';
      const config = runVisualConfig(source);
      expect(config.visualParseError).toBeNull();
      const saved = parseDocument(config.applyVisualChangesToYaml(source));
      expect(saved.hasIn(['excel-api-key'])).toBe(false);
      expect(saved.hasIn(['api-keys', 'excel'])).toBe(false);
      expect(saved.toJS().access).toEqual(parseDocument(source).toJS().access);
      expect(saved.toJS().oauth).toEqual(parseDocument(source).toJS().oauth);
      expect(saved.toJS().future).toEqual({ retained: true });
    }
    const source = yaml.replace('api-keys:\n  codex:', 'api-keys:\n  excel: [{keys: [{}]}]\n  codex:') + 'excel-api-key: [{}]\n';
    const saved = parseDocument(runVisualConfig(source).applyVisualChangesToYaml(source));
    expect(saved.hasIn(['excel-api-key'])).toBe(false);
    expect(saved.toJS()['api-keys']).toEqual(parseDocument(yaml).toJS()['api-keys']);
    const legacy = 'excel-api-key: [{}]\napi-keys:\n  - client-key # Named\ndebug: false\n';
    const legacyOutput = runVisualConfig(legacy).applyVisualChangesToYaml(legacy);
    expect(parseDocument(legacyOutput).toJS()).toEqual({ 'api-keys': ['client-key'], debug: false });
    expect(legacyOutput).toContain('# Named');
  });
  test('routing-only canonical YAML writes the canonical retry leaf', () => {
    const source = 'request-retry: 9\nrouting: {retry: {request-retry: 3}}\n';
    const config = runVisualConfig(source, [{ requestRetry: '4' }]);
    expect(config.visualValues.requestRetry).toBe('4');
    const doc = parseDocument(config.applyVisualChangesToYaml(source));
    expect(doc.getIn(['routing', 'retry', 'request-retry'])).toBe(4);
    expect(doc.hasIn(['request-retry'])).toBe(false);
  });
  test('historical shared header aliases load and migrate only the edited leaf', () => {
    const source =
      'oauth:\n  providers:\n    claude:\n      header-defaults: {user-agent: historical, os: retained}\n';
    expect(runVisualConfig(source).visualValues.claudeHeaderUserAgent).toBe('historical');
    const config = runVisualConfig(source, [{ claudeHeaderUserAgent: 'updated' }]);
    const output = config.applyVisualChangesToYaml(source);
    const doc = parseDocument(output);
    expect(doc.getIn(['upstream', 'claude', 'header-defaults', 'user-agent'])).toBe('updated');
    expect(doc.hasIn(['oauth', 'providers', 'claude', 'header-defaults', 'user-agent'])).toBe(
      false
    );
    expect(runVisualConfig(output).visualValues.claudeHeaderOs).toBe('retained');
  });
  test('legacy-only edits keep their layout', () => {
    const source = 'debug: false\napi-keys:\n  - legacy-key # Named\n';
    const output = runVisualConfig(source, [{ debug: true }]).applyVisualChangesToYaml(source);
    const doc = parseDocument(output);
    expect(doc.getIn(['debug'])).toBe(true);
    expect(doc.hasIn(['observability'])).toBe(false);
    expect(output).toContain('# Named');
  });
});
