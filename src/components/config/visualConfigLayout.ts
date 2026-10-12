import { isMap, parseDocument } from 'yaml';

type YamlDocument = ReturnType<typeof parseDocument>;
type RecordValue = Record<string, unknown>;
const PATHS: Array<[string, string]> = [
  ['usage-store-path', 'observability.usage.store-path'],
  ['usage-retention-days', 'observability.usage.retention-days'],
  ['model-context-overrides', 'routing.model-context-overrides'],
  ['desensitization', 'requests.desensitization'],
  ['qoder', 'oauth.providers.qoder'],
  ['github-token', 'server.github-token'],
  ['host', 'server.host'],
  ['port', 'server.port'],
  ['trusted-proxies', 'server.trusted-proxies'],
  ['tls', 'server.tls'],
  ['commercial-mode', 'server.commercial-mode'],
  ['discovery', 'server.discovery'],
  ['remote-management', 'management'],
  ['api-keys', 'access.api-keys'],
  ['credential-concurrency', 'credentials.concurrency'],
  ['credential-in-flight', 'credentials.in-flight'],
  ['force-model-prefix', 'routing.force-model-prefix'],
  ['request-retry', 'routing.retry.request-retry'],
  ['max-retry-credentials', 'routing.retry.max-retry-credentials'],
  ['max-retry-interval', 'routing.retry.max-retry-interval'],
  ['disable-cooling', 'routing.cooldown.disable-cooling'],
  ['save-cooldown-status', 'routing.cooldown.save-cooldown-status'],
  ['transient-error-cooldown-seconds', 'routing.cooldown.transient-error-cooldown-seconds'],
  ['proxy-url', 'requests.proxy-url'],
  ['passthrough-headers', 'requests.passthrough-headers'],
  ['nonstream-keepalive-interval', 'requests.nonstream-keepalive-interval'],
  ['streaming', 'requests.streaming'],
  ['payload', 'requests.payload'],
  ['auth-dir', 'oauth.auth-dir'],
  ['auth-auto-refresh-workers', 'oauth.auth-auto-refresh-workers'],
  ['oauth-model-alias', 'oauth.model-alias'],
  ['oauth-excluded-models', 'oauth.excluded-models'],
  ['oauth-request-scoped-errors', 'oauth.request-scoped-errors'],
  ['oauth-settings', 'oauth.settings'],
  ['ws-auth', 'oauth.providers.aistudio.ws-auth'],
  ['codex.disable-codex-cloaking', 'upstream.codex.disable-codex-cloaking'],
  ['codex.stream-bootstrap-buffering', 'upstream.codex.stream-bootstrap-buffering'],
  ['codex.stream-bootstrap-timeout', 'upstream.codex.stream-bootstrap-timeout'],
  ['codex.orphan-delegation-compatibility', 'upstream.codex.orphan-delegation-compatibility'],
  ['codex.model-level-cooling', 'upstream.codex.model-level-cooling'],
  ['codex.response-steering', 'upstream.codex.response-steering'],
  ['codex', 'oauth.providers.codex'],
  ['codex-header-defaults', 'oauth.providers.codex.header-defaults'],
  ['claude', 'upstream.claude'],
  ['claude-code', 'upstream.claude'],
  ['disable-claude-cloak-mode', 'upstream.claude.disable-claude-cloak-mode'],
  ['claude-header-defaults', 'upstream.claude.header-defaults'],
  ['antigravity', 'oauth.providers.antigravity'],
  ['antigravity-signature-cache-enabled', 'oauth.providers.antigravity.signature-cache-enabled'],
  ['antigravity-signature-bypass-strict', 'oauth.providers.antigravity.signature-bypass-strict'],
  ['quota-exceeded.antigravity-credits', 'oauth.providers.antigravity.antigravity-credits'],
  ['xai', 'upstream.xai'],
  ['devin', 'oauth.providers.devin'],
  ['disable-image-generation', 'multimedia.disable-image-generation'],
  ['gpt-image-2-base-model', 'multimedia.gpt-image-2-base-model'],
  ['video-result-auth-cache-ttl', 'multimedia.video-result-auth-cache-ttl'],
  ['debug', 'observability.logs.debug'],
  ['logging-to-file', 'observability.logs.logging-to-file'],
  ['logs-max-total-size-mb', 'observability.logs.logs-max-total-size-mb'],
  ['request-log', 'observability.logs.request-log'],
  ['error-logs-max-files', 'observability.logs.error-logs-max-files'],
  ['usage-statistics-enabled', 'observability.usage.usage-statistics-enabled'],
  [
    'redis-usage-queue-retention-seconds',
    'observability.usage.redis-usage-queue-retention-seconds',
  ],
  ['pprof', 'observability.pprof'],
];

const HISTORICAL_PATHS: Array<[string, string]> = [
  ['oauth.providers.codex.disable-codex-cloaking', 'upstream.codex.disable-codex-cloaking'],
  ['oauth.providers.codex.stream-bootstrap-buffering', 'upstream.codex.stream-bootstrap-buffering'],
  ['oauth.providers.codex.stream-bootstrap-timeout', 'upstream.codex.stream-bootstrap-timeout'],
  [
    'oauth.providers.codex.orphan-delegation-compatibility',
    'upstream.codex.orphan-delegation-compatibility',
  ],
  ['oauth.providers.codex.model-level-cooling', 'upstream.codex.model-level-cooling'],
  ['oauth.providers.codex.response-steering', 'upstream.codex.response-steering'],
  ['oauth.providers.claude.model-level-cooling', 'upstream.claude.model-level-cooling'],
  [
    'oauth.providers.claude.claude-code.disable-cloaking-model-list',
    'upstream.claude.disable-cloaking-model-list',
  ],
  ['oauth.providers.claude.disable-claude-cloak-mode', 'upstream.claude.disable-claude-cloak-mode'],
  [
    'oauth.providers.claude.header-defaults.user-agent',
    'upstream.claude.header-defaults.user-agent',
  ],
  [
    'oauth.providers.claude.header-defaults.package-version',
    'upstream.claude.header-defaults.package-version',
  ],
  [
    'oauth.providers.claude.header-defaults.runtime-version',
    'upstream.claude.header-defaults.runtime-version',
  ],
  ['oauth.providers.claude.header-defaults.os', 'upstream.claude.header-defaults.os'],
  ['oauth.providers.claude.header-defaults.arch', 'upstream.claude.header-defaults.arch'],
  ['oauth.providers.claude.header-defaults.timeout', 'upstream.claude.header-defaults.timeout'],
  ['oauth.providers.claude.header-defaults.timezone', 'upstream.claude.header-defaults.timezone'],
  [
    'oauth.providers.claude.header-defaults.stabilize-device-profile',
    'upstream.claude.header-defaults.stabilize-device-profile',
  ],
  ['oauth.providers.xai.inject-x-search', 'upstream.xai.inject-x-search'],
  [
    'oauth.providers.xai.auto-disable-permission-denied',
    'upstream.xai.auto-disable-permission-denied',
  ],
  ['oauth.providers.xai.other-403-cooldown-hours', 'upstream.xai.other-403-cooldown-hours'],
  [
    'oauth.providers.xai.free-usage-exhausted-cooldown-hours',
    'upstream.xai.free-usage-exhausted-cooldown-hours',
  ],
  [
    'oauth.providers.xai.free-usage-exhausted-disable-after',
    'upstream.xai.free-usage-exhausted-disable-after',
  ],
  ['oauth.providers.xai.other-403-disable-after', 'upstream.xai.other-403-disable-after'],
  ['oauth.providers.claude.header-defaults', 'upstream.claude.header-defaults'],
  ['oauth.providers.claude.claude-code', 'upstream.claude'],
  ['oauth.providers.claude', 'upstream.claude'],
  ['oauth.providers.xai', 'upstream.xai'],
];

const record = (value: unknown): value is RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function mergePresent(legacy: unknown, canonical: unknown): unknown {
  if (!record(legacy) || !record(canonical)) return canonical;
  const result = { ...legacy };
  for (const [key, value] of Object.entries(canonical)) {
    result[key] = mergePresent(result[key], value);
  }
  return result;
}

function assignPath(root: RecordValue, path: string[], value: unknown): void {
  let parent = root;
  for (const key of path.slice(0, -1)) {
    if (!record(parent[key])) parent[key] = {};
    parent = parent[key] as RecordValue;
  }
  parent[path[path.length - 1]] = value;
}

/** Read existing fork controls from either layout; canonical presence wins even when false/null. */
export function readVisualConfigRecord(doc: YamlDocument): RecordValue {
  const raw: unknown = doc.toJS();
  const effective = parseDocument('{}');
  effective.contents = effective.createNode(structuredClone(raw)) as typeof effective.contents;
  // Match backend historical shared-field aliases without overriding present canonical leaves.
  for (const [historical, canonical] of HISTORICAL_PATHS) {
    const source = historical.split('.');
    const target = canonical.split('.');
    if (effective.hasIn(target) || !doc.hasIn(source) || isMap(doc.getIn(source, true))) continue;
    effective.setIn(target, effective.createNode(doc.getIn(source, true)));
  }
  const view: RecordValue = record(raw) ? structuredClone(raw) : {};
  for (const [legacy, canonical] of [...PATHS].sort((a, b) => a[0].length - b[0].length)) {
    const path = canonical.split('.');
    if (!effective.hasIn(path)) continue;
    const oldPath = legacy.split('.');
    let oldValue: unknown = view;
    for (const key of oldPath) oldValue = record(oldValue) ? oldValue[key] : undefined;
    // The root api-keys map contains providers, not legacy client keys.
    if (legacy === 'api-keys' && record(oldValue)) oldValue = undefined;
    const node = effective.getIn(path, true);
    const value =
      node && typeof node === 'object' && 'toJSON' in node
        ? (node as { toJSON(): unknown }).toJSON()
        : effective.getIn(path);
    assignPath(view, oldPath, mergePresent(oldValue, value));
  }
  if (doc.hasIn(['api-keys', 'excel'])) {
    const rawGroups = (doc.toJS() as RecordValue)['api-keys'];
    const groups = record(rawGroups) ? rawGroups.excel : undefined;
    view['excel-api-key'] = Array.isArray(groups)
      ? groups.flatMap((group) => {
          if (!record(group) || !Array.isArray(group.keys)) return [];
          return group.keys.map((key) => ({
            ...(record(key) ? key : {}),
            ...(group.disabled === true ? { disabled: true } : {}),
          }));
        })
      : [];
  }
  return view;
}

/** Route dirty writes into an existing v8 document without migrating legacy-only YAML. */
export function visualConfigDocument(doc: YamlDocument): YamlDocument {
  const v8 =
    [
      'server',
      'management',
      'access',
      'credentials',
      'requests',
      'oauth',
      'upstream',
      'multimedia',
      'observability',
    ].some((root) => isMap(doc.getIn([root], true))) ||
    isMap(doc.getIn(['api-keys'], true)) ||
    PATHS.some(([, path]) => doc.hasIn(path.split('.')));
  const mappings = [...PATHS].sort((a, b) => b[0].length - a[0].length);
  const translate = (path: Iterable<unknown>): string[] => {
    const parts = Array.from(path, String);
    if (!v8) return parts;
    if (parts[0] === 'excel-api-key') return ['api-keys', 'excel', ...parts.slice(1)];
    const text = parts.join('.');
    const mapping = mappings.find(([old]) => text === old || text.startsWith(old + '.'));
    return mapping
      ? [...mapping[1].split('.'), ...parts.slice(mapping[0].split('.').length)]
      : parts;
  };
  const safeLegacyDelete = (parts: string[]) => {
    if (parts[0] === 'api-keys' && isMap(doc.getIn(['api-keys'], true))) return;
    if (doc.hasIn(parts)) doc.deleteIn(parts);
  };
  const clearHistorical = (canonical: string[]) => {
    const text = canonical.join('.');
    for (const [old, current] of HISTORICAL_PATHS) {
      if (text === current || text.startsWith(current + '.')) {
        const path = [...old.split('.'), ...canonical.slice(current.split('.').length)];
        if (doc.hasIn(path)) doc.deleteIn(path);
      }
    }
  };
  const parents = (parts: string[]) => {
    for (let length = 1; length < parts.length; length++) {
      const path = parts.slice(0, length);
      if (!isMap(doc.getIn(path, true))) doc.setIn(path, doc.createNode({}));
    }
  };
  return new Proxy(doc, {
    get(target, property) {
      if (property === 'getIn' || property === 'hasIn')
        return (path: Iterable<unknown>, keep?: boolean) => {
          const original = Array.from(path, String);
          const canonical = translate(original);
          const historical = HISTORICAL_PATHS.filter(
            ([, current]) =>
              canonical.join('.') === current || canonical.join('.').startsWith(current + '.')
          )
            .sort((a, b) => b[1].length - a[1].length)
            .map(([old, current]) => [
              ...old.split('.'),
              ...canonical.slice(current.split('.').length),
            ])
            .find((path) => target.hasIn(path));
          const selected = target.hasIn(canonical) ? canonical : (historical ?? original);
          // Never read the provider-group map as the legacy client key sequence.
          if (
            original.length === 1 &&
            original[0] === 'api-keys' &&
            selected === original &&
            isMap(target.getIn(original, true))
          )
            return property === 'hasIn' ? false : undefined;
          return property === 'hasIn' ? target.hasIn(selected) : target.getIn(selected, keep);
        };
      if (property === 'setIn')
        return (path: Iterable<unknown>, value: unknown) => {
          const original = Array.from(path, String);
          const canonical = translate(original);
          parents(canonical);
          if (v8 && original[0] === 'excel-api-key') {
            target.setIn(canonical, target.createNode([{ name: 'excel-1', keys: [{}] }]));
          } else target.setIn(canonical, value);
          if (canonical.join('.') !== original.join('.')) safeLegacyDelete(original);
          if (v8) clearHistorical(canonical);
        };
      if (property === 'deleteIn')
        return (path: Iterable<unknown>) => {
          const original = Array.from(path, String);
          const canonical = translate(original);
          const removed = target.hasIn(canonical) ? target.deleteIn(canonical) : false;
          if (canonical.join('.') !== original.join('.')) safeLegacyDelete(original);
          if (v8) clearHistorical(canonical);
          return removed;
        };
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
