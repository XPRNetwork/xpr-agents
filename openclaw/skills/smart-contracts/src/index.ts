/**
 * Smart Contracts Skill — Chain inspection, code scaffolding, and auditing
 *
 * 6 chain inspection tools (read-only, RPC + Hyperion)
 * 4 code generation tools (return source code strings)
 * 1 audit tool (static analysis with 17 rules)
 */

// ── Types ────────────────────────────────────────

interface ToolDef {
  name: string;
  description: string;
  parameters: { type: 'object'; required?: string[]; properties: Record<string, unknown> };
  handler: (params: any) => Promise<unknown>;
}

interface SkillApi {
  registerTool(tool: ToolDef): void;
  getConfig(): Record<string, unknown>;
}

// ── RPC Helper ──────────────────────────────────

const API_TIMEOUT = 15000;

async function rpcPost(endpoint: string, path: string, body: unknown): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT);
  try {
    const resp = await fetch(`${endpoint}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`RPC ${path} failed (${resp.status}): ${text.slice(0, 300)}`);
    }
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

async function rpcGet(endpoint: string, path: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT);
  try {
    const resp = await fetch(`${endpoint}${path}`, {
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`RPC GET ${path} failed (${resp.status}): ${text.slice(0, 300)}`);
    }
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── Hyperion endpoint resolution ────────────────

function getHyperionEndpoint(rpcEndpoint: string): string {
  // Map known RPC endpoints to their Hyperion equivalents
  if (rpcEndpoint.includes('proton-testnet') || rpcEndpoint.includes('proton-test')) {
    return 'https://proton-testnet.eosusa.io';
  }
  if (rpcEndpoint.includes('proton.eosusa.io') || rpcEndpoint.includes('proton.greymass.com')) {
    return 'https://proton.eosusa.io';
  }
  // Default: assume the RPC endpoint also serves Hyperion
  return rpcEndpoint;
}

// ── Skill Entry Point ───────────────────────────

export default function smartContractsSkill(api: SkillApi): void {
  const config = api.getConfig();
  const rpcEndpoint = (config.rpcEndpoint as string) || process.env.XPR_RPC_ENDPOINT || '';
  const network = (config.network as string) || process.env.XPR_NETWORK || 'testnet';

  // ════════════════════════════════════════════════
  // CHAIN INSPECTION TOOLS (6 read-only)
  // ════════════════════════════════════════════════

  // ── 1. sc_get_abi ──
  api.registerTool({
    name: 'sc_get_abi',
    description: 'Fetch the ABI for a deployed contract. Returns all tables, actions, structs, and types. Equivalent to `proton contract:abi ACCOUNT`.',
    parameters: {
      type: 'object',
      required: ['account'],
      properties: {
        account: { type: 'string', description: 'Contract account name (e.g. "agentcore", "eosio.token")' },
      },
    },
    handler: async ({ account }: { account: string }) => {
      if (!account) return { error: 'account is required' };
      try {
        const result = await rpcPost(rpcEndpoint, '/v1/chain/get_abi', { account_name: account });
        if (!result.abi) return { error: `No contract deployed on account "${account}"` };
        const abi = result.abi;
        return {
          account,
          tables: (abi.tables || []).map((t: any) => ({
            name: t.name,
            type: t.type,
            index_type: t.index_type,
            key_names: t.key_names,
            key_types: t.key_types,
          })),
          actions: (abi.actions || []).map((a: any) => ({
            name: a.name,
            type: a.type,
            ricardian_contract: a.ricardian_contract ? '(has ricardian)' : '',
          })),
          structs: (abi.structs || []).map((s: any) => ({
            name: s.name,
            base: s.base || undefined,
            fields: s.fields,
          })),
          types: abi.types || [],
          version: abi.version,
        };
      } catch (err: any) {
        return { error: `Failed to get ABI: ${err.message}` };
      }
    },
  });

  // ── 2. sc_get_table_schema ──
  api.registerTool({
    name: 'sc_get_table_schema',
    description: 'Extract table field names and types from a contract ABI. Useful for understanding table structure before reading data.',
    parameters: {
      type: 'object',
      required: ['account', 'table'],
      properties: {
        account: { type: 'string', description: 'Contract account name' },
        table: { type: 'string', description: 'Table name' },
      },
    },
    handler: async ({ account, table }: { account: string; table: string }) => {
      if (!account || !table) return { error: 'account and table are required' };
      try {
        const result = await rpcPost(rpcEndpoint, '/v1/chain/get_abi', { account_name: account });
        if (!result.abi) return { error: `No contract deployed on account "${account}"` };
        const abi = result.abi;

        // Find the table definition
        const tableDef = (abi.tables || []).find((t: any) => t.name === table);
        if (!tableDef) {
          const available = (abi.tables || []).map((t: any) => t.name);
          return { error: `Table "${table}" not found. Available tables: ${available.join(', ')}` };
        }

        // Find the struct that defines this table's row type
        const structDef = (abi.structs || []).find((s: any) => s.name === tableDef.type);
        if (!structDef) return { error: `Struct "${tableDef.type}" not found in ABI` };

        // Resolve base struct fields (inheritance)
        const fields: Array<{ name: string; type: string }> = [];
        if (structDef.base) {
          const baseDef = (abi.structs || []).find((s: any) => s.name === structDef.base);
          if (baseDef) {
            fields.push(...baseDef.fields);
          }
        }
        fields.push(...structDef.fields);

        return {
          account,
          table,
          struct_name: tableDef.type,
          index_type: tableDef.index_type,
          fields,
        };
      } catch (err: any) {
        return { error: `Failed to get table schema: ${err.message}` };
      }
    },
  });

  // ── 3. sc_read_table ──
  api.registerTool({
    name: 'sc_read_table',
    description: 'Read table rows from a deployed contract. Equivalent to `proton table CODE TABLE [SCOPE]`. Returns JSON rows with field names.',
    parameters: {
      type: 'object',
      required: ['code', 'table'],
      properties: {
        code: { type: 'string', description: 'Contract account that owns the table' },
        table: { type: 'string', description: 'Table name' },
        scope: { type: 'string', description: 'Table scope (defaults to code account)' },
        lower_bound: { type: 'string', description: 'Lower bound filter (primary key or index value)' },
        upper_bound: { type: 'string', description: 'Upper bound filter' },
        limit: { type: 'number', description: 'Max rows to return (default 10, max 100)' },
        index_position: { type: 'string', description: 'Index to query: "1" (primary), "2" (secondary), etc.' },
        key_type: { type: 'string', description: 'Key type for index: "i64", "name", "i128", etc.' },
        reverse: { type: 'boolean', description: 'Reverse order (default false)' },
      },
    },
    handler: async ({ code, table, scope, lower_bound, upper_bound, limit, index_position, key_type, reverse }: {
      code: string; table: string; scope?: string; lower_bound?: string; upper_bound?: string;
      limit?: number; index_position?: string; key_type?: string; reverse?: boolean;
    }) => {
      if (!code || !table) return { error: 'code and table are required' };
      try {
        const result = await rpcPost(rpcEndpoint, '/v1/chain/get_table_rows', {
          json: true,
          code,
          scope: scope || code,
          table,
          lower_bound: lower_bound || undefined,
          upper_bound: upper_bound || undefined,
          limit: Math.min(Math.max(limit || 10, 1), 100),
          index_position: index_position || undefined,
          key_type: key_type || undefined,
          reverse: reverse || false,
        });
        return {
          code,
          table,
          scope: scope || code,
          rows: result.rows || [],
          more: result.more || false,
          next_key: result.next_key || undefined,
        };
      } catch (err: any) {
        return { error: `Failed to read table: ${err.message}` };
      }
    },
  });

  // ── 4. sc_get_account_info ──
  api.registerTool({
    name: 'sc_get_account_info',
    description: 'Get account details: permissions, RAM usage, contract deployment status, and resource limits. Equivalent to `proton account ACCOUNT`.',
    parameters: {
      type: 'object',
      required: ['account'],
      properties: {
        account: { type: 'string', description: 'Account name to inspect' },
      },
    },
    handler: async ({ account }: { account: string }) => {
      if (!account) return { error: 'account is required' };
      try {
        const result = await rpcPost(rpcEndpoint, '/v1/chain/get_account', { account_name: account });
        return {
          account_name: result.account_name,
          created: result.created,
          has_contract: !!(result.last_code_update && result.last_code_update !== '1970-01-01T00:00:00.000'),
          last_code_update: result.last_code_update,
          ram_quota: result.ram_quota,
          ram_usage: result.ram_usage,
          ram_free: (result.ram_quota || 0) - (result.ram_usage || 0),
          net_weight: result.net_weight,
          cpu_weight: result.cpu_weight,
          permissions: (result.permissions || []).map((p: any) => ({
            perm_name: p.perm_name,
            parent: p.parent,
            threshold: p.required_auth?.threshold,
            keys: (p.required_auth?.keys || []).map((k: any) => ({
              key: k.key,
              weight: k.weight,
            })),
            accounts: (p.required_auth?.accounts || []).map((a: any) => ({
              actor: a.permission?.actor,
              permission: a.permission?.permission,
              weight: a.weight,
            })),
          })),
        };
      } catch (err: any) {
        return { error: `Failed to get account info: ${err.message}` };
      }
    },
  });

  // ── 5. sc_get_chain_info ──
  api.registerTool({
    name: 'sc_get_chain_info',
    description: 'Get chain info: head block number, chain ID, server version, and block time. Equivalent to `proton chain:info`.',
    parameters: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      try {
        const result = await rpcPost(rpcEndpoint, '/v1/chain/get_info', {});
        return {
          chain_id: result.chain_id,
          head_block_num: result.head_block_num,
          head_block_time: result.head_block_time,
          last_irreversible_block_num: result.last_irreversible_block_num,
          server_version_string: result.server_version_string,
          fork_db_head_block_num: result.fork_db_head_block_num,
          network: result.chain_id === '384da888112027f0321850a169f737c33e53b388aad48b5adace4bab97f437e0' ? 'mainnet' : 'testnet',
        };
      } catch (err: any) {
        return { error: `Failed to get chain info: ${err.message}` };
      }
    },
  });

  // ── 6. sc_get_action_history ──
  api.registerTool({
    name: 'sc_get_action_history',
    description: 'Query Hyperion for action history of an account. Returns recent actions with data, timestamps, and transaction IDs.',
    parameters: {
      type: 'object',
      required: ['account'],
      properties: {
        account: { type: 'string', description: 'Account to query actions for' },
        filter: { type: 'string', description: 'Filter by contract:action (e.g. "eosio.token:transfer", "agentcore:*")' },
        limit: { type: 'number', description: 'Max actions to return (default 20, max 100)' },
        skip: { type: 'number', description: 'Number of actions to skip (for pagination)' },
        sort: { type: 'string', description: 'Sort order: "asc" or "desc" (default "desc" = newest first)' },
        after: { type: 'string', description: 'Only actions after this ISO date (e.g. "2026-01-01T00:00:00Z")' },
        before: { type: 'string', description: 'Only actions before this ISO date' },
      },
    },
    handler: async ({ account, filter, limit, skip, sort, after, before }: {
      account: string; filter?: string; limit?: number; skip?: number;
      sort?: string; after?: string; before?: string;
    }) => {
      if (!account) return { error: 'account is required' };
      try {
        const hyperion = getHyperionEndpoint(rpcEndpoint);
        const params = new URLSearchParams();
        params.set('account', account);
        params.set('limit', String(Math.min(Math.max(limit || 20, 1), 100)));
        if (filter) params.set('filter', filter);
        if (skip) params.set('skip', String(skip));
        if (sort) params.set('sort', sort);
        if (after) params.set('after', after);
        if (before) params.set('before', before);

        const result = await rpcGet(hyperion, `/v2/history/get_actions?${params.toString()}`);
        const actions = result.actions || [];
        return {
          account,
          total: result.total?.value || actions.length,
          actions: actions.map((a: any) => ({
            timestamp: a.timestamp || a['@timestamp'],
            block_num: a.block_num,
            trx_id: a.trx_id,
            contract: a.act?.account,
            action: a.act?.name,
            data: a.act?.data,
            authorization: a.act?.authorization,
          })),
        };
      } catch (err: any) {
        return { error: `Failed to get action history: ${err.message}` };
      }
    },
  });

  // ════════════════════════════════════════════════
  // CODE GENERATION TOOLS (4)
  // ════════════════════════════════════════════════

  // ── 7. sc_scaffold_contract ──
  api.registerTool({
    name: 'sc_scaffold_contract',
    description: 'Generate a full contract project: contract.ts with tables and actions, package.json, tsconfig.json, and a basic test file. Returns all files as an object.',
    parameters: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Contract name (1-12 chars, a-z1-5). Used for filename and class name.' },
        description: { type: 'string', description: 'Contract description (added as comment)' },
        tables: {
          type: 'array',
          description: 'Table definitions: [{name, fields: [{name, type}], singleton?: bool}]',
        },
        actions: {
          type: 'array',
          description: 'Action definitions: [{name, params: [{name, type}], auth?: "user"|"self"|"both", notify?: bool}]',
        },
        has_token_handler: { type: 'boolean', description: 'Include a transfer notify handler for incoming token payments (default false)' },
      },
    },
    handler: async ({ name, description, tables, actions, has_token_handler }: {
      name: string; description?: string; tables?: any[]; actions?: any[]; has_token_handler?: boolean;
    }) => {
      if (!name || name.length > 12 || !/^[a-z1-5]+$/.test(name)) {
        return { error: 'Invalid contract name. Must be 1-12 characters, a-z and 1-5 only.' };
      }

      const className = name.charAt(0).toUpperCase() + name.slice(1) + 'Contract';
      const imports = new Set(['Contract', 'Name', 'check', 'requireAuth', 'currentTimeSec']);
      const tableClasses: string[] = [];
      const tableDeclarations: string[] = [];
      const actionMethods: string[] = [];

      // Generate table classes
      if (tables && tables.length > 0) {
        imports.add('Table');
        imports.add('TableStore');
        for (const t of tables) {
          if (t.singleton) {
            imports.add('Singleton');
            tableClasses.push(generateSingletonClass(t));
            tableDeclarations.push(`  ${t.name}Singleton: Singleton<${pascalCase(t.name)}> = new Singleton<${pascalCase(t.name)}>(this.receiver);`);
          } else {
            tableClasses.push(generateTableClass(t));
            tableDeclarations.push(`  ${t.name}Table: TableStore<${pascalCase(t.name)}> = new TableStore<${pascalCase(t.name)}>(this.receiver);`);
          }
        }
      }

      // Generate action methods
      if (actions && actions.length > 0) {
        for (const a of actions) {
          if (a.notify) imports.add('Asset');
          actionMethods.push(generateActionMethod(a, imports));
        }
      }

      // Add init action if not already present
      const hasInit = actions?.some(a => a.name === 'init');
      if (!hasInit && tables?.some(t => t.singleton)) {
        actionMethods.unshift(generateInitAction(tables.filter(t => t.singleton), imports));
      }

      // Add token handler
      if (has_token_handler) {
        imports.add('Asset');
        actionMethods.push(generateTokenHandler());
      }

      // Build contract source
      const contractSource = [
        `// ${name}.contract.ts`,
        description ? `// ${description}` : '',
        '',
        `import {`,
        `  ${[...imports].join(', ')}`,
        `} from 'proton-tsc';`,
        '',
        ...tableClasses,
        `@contract`,
        `export class ${className} extends Contract {`,
        ...tableDeclarations,
        '',
        ...actionMethods,
        `}`,
        '',
      ].filter(line => line !== undefined).join('\n');

      // Build package.json
      const packageJson = JSON.stringify({
        name,
        version: '1.0.0',
        description: description || `${name} smart contract`,
        scripts: {
          build: `npx proton-asc ./assembly/${name}.contract.ts`,
          test: 'npx ts-mocha tests/**/*.spec.ts --timeout 30000',
        },
        dependencies: {
          'proton-tsc': '^0.12.0',
        },
        devDependencies: {
          '@proton/vert': '^0.2.0',
          'chai': '^4.3.10',
          'mocha': '^10.2.0',
          'ts-mocha': '^10.0.0',
          'typescript': '^5.0.0',
        },
      }, null, 2);

      // Build tsconfig.json
      const tsConfig = JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          module: 'commonjs',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          outDir: './dist',
        },
        include: ['tests/**/*.ts'],
      }, null, 2);

      // Build test file
      const testSource = generateTestFile(name, className, tables || [], actions || []);

      return {
        files: {
          [`assembly/${name}.contract.ts`]: contractSource,
          'package.json': packageJson,
          'tsconfig.json': tsConfig,
          [`tests/${name}.spec.ts`]: testSource,
        },
        note: `Generated ${name} contract with ${tables?.length || 0} table(s) and ${(actions?.length || 0) + (hasInit ? 0 : tables?.some(t => t.singleton) ? 1 : 0)} action(s). Run \`npm install && npm run build\` to compile.`,
      };
    },
  });

  // ── 8. sc_scaffold_table ──
  api.registerTool({
    name: 'sc_scaffold_table',
    description: 'Generate a single table class with primary key and optional secondary indexes. Returns AssemblyScript source code.',
    parameters: {
      type: 'object',
      required: ['name', 'fields'],
      properties: {
        name: { type: 'string', description: 'Table name (1-12 chars, a-z1-5)' },
        fields: {
          type: 'array',
          description: 'Array of {name, type} field definitions. Types: u8, u16, u32, u64, i64, string, Name, boolean, Asset',
        },
        singleton: { type: 'boolean', description: 'Generate a singleton table (default false)' },
        secondary_indexes: {
          type: 'array',
          description: 'Field names to add secondary indexes on (must be u64 or Name type)',
        },
      },
    },
    handler: async ({ name, fields, singleton, secondary_indexes }: {
      name: string; fields: Array<{ name: string; type: string }>;
      singleton?: boolean; secondary_indexes?: string[];
    }) => {
      if (!name || name.length > 12 || !/^[a-z1-5.]*$/.test(name)) {
        return { error: 'Invalid table name. Must be 1-12 characters, a-z, 1-5, and dots only.' };
      }
      if (!fields || fields.length === 0) {
        return { error: 'At least one field is required' };
      }

      const table = { name, fields, singleton, secondary_indexes };
      const code = singleton ? generateSingletonClass(table) : generateTableClass(table);

      return {
        code,
        imports: singleton
          ? "import { Table, Singleton, Name } from 'proton-tsc';"
          : "import { Table, TableStore, Name } from 'proton-tsc';",
        usage: singleton
          ? `// In contract class:\n${name}Singleton: Singleton<${pascalCase(name)}> = new Singleton<${pascalCase(name)}>(this.receiver);`
          : `// In contract class:\n${name}Table: TableStore<${pascalCase(name)}> = new TableStore<${pascalCase(name)}>(this.receiver);`,
      };
    },
  });

  // ── 9. sc_scaffold_action ──
  api.registerTool({
    name: 'sc_scaffold_action',
    description: 'Generate a single action method with proper authorization checks. Returns AssemblyScript source code to paste into a contract class.',
    parameters: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Action name (1-12 chars)' },
        params: {
          type: 'array',
          description: 'Action parameters: [{name, type}]. First Name-type param used for requireAuth.',
        },
        auth: { type: 'string', description: 'Authorization: "user" (requireAuth on first Name param), "self" (requireAuth on this.receiver), "both" (default "user")' },
        notify: { type: 'boolean', description: 'Generate as a notify handler (e.g. for incoming transfers)' },
        description: { type: 'string', description: 'Action description (added as comment)' },
      },
    },
    handler: async ({ name, params, auth, notify, description }: {
      name: string; params?: Array<{ name: string; type: string }>;
      auth?: string; notify?: boolean; description?: string;
    }) => {
      if (!name) return { error: 'Action name is required' };

      const imports = new Set<string>();
      const action = { name, params: params || [], auth: auth || 'user', notify, description };
      const code = generateActionMethod(action, imports);

      return {
        code,
        imports: imports.size > 0 ? `import { ${[...imports].join(', ')} } from 'proton-tsc';` : '',
        note: notify
          ? 'This is a notify handler. It will fire when the matching action occurs on another contract.'
          : `Paste this method inside your contract class.`,
      };
    },
  });

  // ── 10. sc_scaffold_test ──
  api.registerTool({
    name: 'sc_scaffold_test',
    description: 'Generate a @proton/vert test file for a contract. Returns TypeScript test source with mocha/chai structure.',
    parameters: {
      type: 'object',
      required: ['contract_name'],
      properties: {
        contract_name: { type: 'string', description: 'Contract name (matches the .contract.ts filename)' },
        actions: {
          type: 'array',
          description: 'Actions to generate test cases for: [{name, params: [{name, type, example_value}]}]',
        },
        tables: {
          type: 'array',
          description: 'Tables to generate read test cases for: [{name}]',
        },
      },
    },
    handler: async ({ contract_name, actions, tables }: {
      contract_name: string; actions?: any[]; tables?: any[];
    }) => {
      if (!contract_name) return { error: 'contract_name is required' };

      const className = contract_name.charAt(0).toUpperCase() + contract_name.slice(1) + 'Contract';
      const code = generateTestFile(contract_name, className, tables || [], actions || []);

      return {
        code,
        note: `Run with: npx ts-mocha tests/${contract_name}.spec.ts --timeout 30000`,
      };
    },
  });

  // ════════════════════════════════════════════════
  // ANALYSIS TOOL (1)
  // ════════════════════════════════════════════════

  // ── 11. sc_audit_contract ──
  api.registerTool({
    name: 'sc_audit_contract',
    description: 'Scan contract source code for 17 known XPR/EOSIO/AssemblyScript pitfalls. Returns findings sorted by severity (critical, warning, info).',
    parameters: {
      type: 'object',
      required: ['source_code'],
      properties: {
        source_code: { type: 'string', description: 'Full contract source code (AssemblyScript .contract.ts content)' },
        contract_name: { type: 'string', description: 'Contract name (for better reporting)' },
      },
    },
    handler: async ({ source_code, contract_name }: { source_code: string; contract_name?: string }) => {
      if (!source_code) return { error: 'source_code is required' };

      const findings = auditContract(source_code);
      const bySeverity = {
        critical: findings.filter(f => f.severity === 'critical'),
        warning: findings.filter(f => f.severity === 'warning'),
        info: findings.filter(f => f.severity === 'info'),
      };

      return {
        contract: contract_name || '(unnamed)',
        total_findings: findings.length,
        summary: {
          critical: bySeverity.critical.length,
          warning: bySeverity.warning.length,
          info: bySeverity.info.length,
        },
        findings,
        verdict: bySeverity.critical.length > 0
          ? 'FAIL — critical issues must be fixed before deployment'
          : bySeverity.warning.length > 0
            ? 'WARN — review warnings before deployment'
            : 'PASS — no major issues detected',
      };
    },
  });
}

// ════════════════════════════════════════════════════
// Code Generation Helpers
// ════════════════════════════════════════════════════

function pascalCase(s: string): string {
  return s.split(/[_.]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

function defaultValue(type: string): string {
  switch (type.toLowerCase()) {
    case 'u8': case 'u16': case 'u32': case 'u64':
    case 'i8': case 'i16': case 'i32': case 'i64':
    case 'f32': case 'f64':
      return '0';
    case 'string': return '""';
    case 'name': return 'new Name()';
    case 'boolean': case 'bool': return 'false';
    case 'asset': return 'new Asset()';
    default: return '0';
  }
}

function asType(type: string): string {
  const map: Record<string, string> = {
    'string': 'string',
    'name': 'Name',
    'boolean': 'boolean',
    'bool': 'boolean',
    'asset': 'Asset',
  };
  return map[type.toLowerCase()] || type;
}

function generateTableClass(table: any): string {
  const className = pascalCase(table.name);
  const fields = table.fields || [];
  const secondaryIndexes = table.secondary_indexes || [];

  // Find primary key: prefer 'id' field, then first u64 field, then first Name field, then first field
  const primaryField =
    fields.find((f: any) => f.name === 'id') ||
    fields.find((f: any) => f.type === 'u64') ||
    fields.find((f: any) => f.type.toLowerCase() === 'name') ||
    fields[0];

  const constructorParams = fields.map((f: any) =>
    `    public ${f.name}: ${asType(f.type)} = ${defaultValue(f.type)}`
  ).join(',\n');

  const secondaryGetters = secondaryIndexes
    .filter((name: string) => fields.some((f: any) => f.name === name))
    .map((name: string) => {
      const field = fields.find((f: any) => f.name === name);
      const isName = field && (field.type.toLowerCase() === 'name');
      return [
        '',
        `  @secondary`,
        `  get by${pascalCase(name)}(): u64 { return ${isName ? `this.${name}.N` : `this.${name}`}; }`,
      ].join('\n');
    });

  return [
    `@table("${table.name}")`,
    `export class ${className} extends Table {`,
    `  constructor(`,
    constructorParams,
    `  ) {`,
    `    super();`,
    `  }`,
    '',
    `  @primary`,
    `  get primary(): u64 { return ${primaryField.type.toLowerCase() === 'name' ? `this.${primaryField.name}.N` : `this.${primaryField.name}`}; }`,
    ...secondaryGetters,
    `}`,
    '',
  ].join('\n');
}

function generateSingletonClass(table: any): string {
  const className = pascalCase(table.name);
  const fields = table.fields || [];

  const constructorParams = fields.map((f: any) =>
    `    public ${f.name}: ${asType(f.type)} = ${defaultValue(f.type)}`
  ).join(',\n');

  return [
    `@table("${table.name}", singleton)`,
    `export class ${className} extends Table {`,
    `  constructor(`,
    constructorParams,
    `  ) {`,
    `    super();`,
    `  }`,
    `}`,
    '',
  ].join('\n');
}

function generateActionMethod(action: any, imports: Set<string>): string {
  const params = action.params || [];
  const isNotify = action.notify;
  const auth = action.auth || 'user';

  const paramStr = params.map((p: any) => `${p.name}: ${asType(p.type)}`).join(', ');

  const lines: string[] = [];
  if (action.description) {
    lines.push(`  // ${action.description}`);
  }

  if (isNotify) {
    imports.add('Name');
    lines.push(`  @action("${action.name}", notify)`);
    lines.push(`  on${pascalCase(action.name)}(${paramStr}): void {`);
    // Add firstReceiver check for notify handlers
    lines.push(`    // SECURITY: Only accept from the real contract`);
    lines.push(`    if (this.firstReceiver != Name.fromString("eosio.token")) return;`);
    if (params.some((p: any) => p.name === 'to')) {
      lines.push(`    // Only process transfers TO this contract`);
      lines.push(`    if (to != this.receiver) return;`);
    }
  } else {
    lines.push(`  @action("${action.name}")`);
    lines.push(`  ${action.name}(${paramStr}): void {`);

    // Add auth checks
    if (auth === 'self' || auth === 'both') {
      imports.add('requireAuth');
      lines.push(`    requireAuth(this.receiver);`);
    }
    if (auth === 'user' || auth === 'both') {
      const nameParam = params.find((p: any) => p.type.toLowerCase() === 'name');
      if (nameParam) {
        imports.add('requireAuth');
        lines.push(`    requireAuth(${nameParam.name});`);
      }
    }
  }

  lines.push('');
  lines.push('    // TODO: Implement action logic');
  lines.push('  }');

  return lines.join('\n');
}

function generateInitAction(singletons: any[], imports: Set<string>): string {
  imports.add('requireAuth');
  imports.add('check');
  imports.add('Name');

  const lines = [
    '  @action("init")',
    '  init(owner: Name): void {',
    '    requireAuth(this.receiver);',
    '',
    '    // Re-init guard — prevent overwriting existing config',
  ];

  if (singletons.length > 0) {
    const s = singletons[0];
    const className = pascalCase(s.name);
    lines.push(`    const existing = this.${s.name}Singleton.get();`);
    lines.push(`    check(existing === null, "Already initialized");`);
    lines.push('');
    lines.push(`    const config = new ${className}();`);
    lines.push(`    config.owner = owner;`);
    lines.push(`    this.${s.name}Singleton.set(config, this.receiver);`);
  }

  lines.push('  }');
  return lines.join('\n');
}

function generateTokenHandler(): string {
  return [
    '',
    '  @action("transfer", notify)',
    '  onTransfer(from: Name, to: Name, quantity: Asset, memo: string): void {',
    '    // Only process transfers TO this contract',
    '    if (to != this.receiver) return;',
    '',
    '    // SECURITY: Only accept from eosio.token',
    '    if (this.firstReceiver != Name.fromString("eosio.token")) return;',
    '',
    '    // Parse memo and handle payment',
    '    if (memo.startsWith("deposit:")) {',
    '      // TODO: Handle deposit',
    '    }',
    '  }',
  ].join('\n');
}

function generateTestFile(contractName: string, className: string, tables: any[], actions: any[]): string {
  const lines = [
    `import { expect } from 'chai';`,
    `import { Blockchain, nameToBigInt, mintTokens, expectToThrow } from '@proton/vert';`,
    '',
    `// Initialize blockchain`,
    `const blockchain = new Blockchain();`,
    '',
    `// Load contract`,
    `const contract = blockchain.createContract('${contractName}', 'assembly/target/${contractName}.contract');`,
    '',
    `// Create test accounts`,
    `const [alice, bob] = blockchain.createAccounts('alice', 'bob');`,
    '',
    `describe('${className}', () => {`,
    `  beforeEach(async () => {`,
    `    blockchain.resetTables();`,
    `  });`,
    '',
  ];

  // Generate init test if there are singletons
  const hasSingleton = tables.some(t => t.singleton);
  if (hasSingleton) {
    lines.push(`  describe('init', () => {`);
    lines.push(`    it('should initialize config', async () => {`);
    lines.push(`      await contract.actions.init(['${contractName}']).send('${contractName}@active');`);
    lines.push(`    });`);
    lines.push('');
    lines.push(`    it('should prevent re-initialization', async () => {`);
    lines.push(`      await contract.actions.init(['${contractName}']).send('${contractName}@active');`);
    lines.push(`      await expectToThrow(`);
    lines.push(`        contract.actions.init(['${contractName}']).send('${contractName}@active'),`);
    lines.push(`        'Already initialized'`);
    lines.push(`      );`);
    lines.push(`    });`);
    lines.push(`  });`);
    lines.push('');
  }

  // Generate tests for each action
  for (const action of actions) {
    if (action.name === 'init') continue;
    const params = action.params || [];
    const exampleArgs = params.map((p: any) => {
      if (p.example_value !== undefined) return JSON.stringify(p.example_value);
      switch (p.type?.toLowerCase()) {
        case 'name': return "'alice'";
        case 'string': return "'test'";
        case 'u64': case 'u32': case 'u16': case 'u8': return '100';
        case 'boolean': case 'bool': return 'true';
        default: return "'test'";
      }
    });

    lines.push(`  describe('${action.name}', () => {`);
    lines.push(`    it('should execute ${action.name}', async () => {`);
    lines.push(`      await contract.actions.${action.name}([${exampleArgs.join(', ')}]).send('alice@active');`);
    lines.push(`    });`);
    lines.push('');
    lines.push(`    it('should require auth', async () => {`);
    lines.push(`      await expectToThrow(`);
    lines.push(`        contract.actions.${action.name}([${exampleArgs.join(', ')}]).send('bob@active'),`);
    lines.push(`        'Missing required authority'`);
    lines.push(`      );`);
    lines.push(`    });`);
    lines.push(`  });`);
    lines.push('');
  }

  // Generate table read tests
  for (const table of tables) {
    if (table.singleton) continue;
    lines.push(`  describe('${table.name} table', () => {`);
    lines.push(`    it('should read ${table.name} rows', async () => {`);
    lines.push(`      const rows = contract.tables.${table.name}().getTableRows();`);
    lines.push(`      expect(rows).to.be.an('array');`);
    lines.push(`    });`);
    lines.push(`  });`);
    lines.push('');
  }

  lines.push(`});`);
  lines.push('');

  return lines.join('\n');
}

// ════════════════════════════════════════════════════
// Audit Engine (17 rules)
// ════════════════════════════════════════════════════

interface AuditFinding {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  line?: number;
  suggestion: string;
}

function auditContract(source: string): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const lines = source.split('\n');

  // Track which actions have requireAuth
  const actionLines: Array<{ name: string; lineNum: number; hasAuth: boolean; isSelf: boolean }> = [];
  let inAction = false;
  let currentAction = '';
  let currentActionLine = 0;
  let hasAuthInAction = false;
  let isSelfAuth = false;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Track action boundaries
    const actionMatch = trimmed.match(/@action\("([^"]+)"\)/);
    if (actionMatch && !trimmed.includes('notify')) {
      if (inAction) {
        actionLines.push({ name: currentAction, lineNum: currentActionLine, hasAuth: hasAuthInAction, isSelf: isSelfAuth });
      }
      currentAction = actionMatch[1];
      currentActionLine = i + 1;
      hasAuthInAction = false;
      isSelfAuth = false;
      inAction = true;
      braceDepth = 0;
    }

    if (inAction) {
      braceDepth += (line.match(/{/g) || []).length;
      braceDepth -= (line.match(/}/g) || []).length;

      if (trimmed.includes('requireAuth(')) {
        hasAuthInAction = true;
        if (trimmed.includes('this.receiver')) isSelfAuth = true;
      }

      if (braceDepth <= 0 && i > currentActionLine) {
        actionLines.push({ name: currentAction, lineNum: currentActionLine, hasAuth: hasAuthInAction, isSelf: isSelfAuth });
        inAction = false;
      }
    }
  }
  // Flush last action if file ends inside one
  if (inAction) {
    actionLines.push({ name: currentAction, lineNum: currentActionLine, hasAuth: hasAuthInAction, isSelf: isSelfAuth });
  }

  // AUTH01: Action missing requireAuth (critical)
  for (const action of actionLines) {
    if (!action.hasAuth) {
      findings.push({
        id: 'AUTH01',
        severity: 'critical',
        title: `Action "${action.name}" missing requireAuth`,
        description: `The action at line ${action.lineNum} has no requireAuth() call. Any account can execute this action.`,
        line: action.lineNum,
        suggestion: 'Add requireAuth(actor) with the appropriate authority check.',
      });
    }
  }

  // AUTH02: Notify handler missing firstReceiver check (warning)
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('@action(') && lines[i].includes('notify')) {
      // Scan next 15 lines for firstReceiver check
      let hasCheck = false;
      for (let j = i + 1; j < Math.min(i + 15, lines.length); j++) {
        if (lines[j].includes('firstReceiver')) {
          hasCheck = true;
          break;
        }
      }
      if (!hasCheck) {
        findings.push({
          id: 'AUTH02',
          severity: 'warning',
          title: 'Notify handler missing firstReceiver check',
          description: `Notify handler at line ${i + 1} does not check this.firstReceiver. Malicious contracts could send spoofed notifications.`,
          line: i + 1,
          suggestion: 'Add: if (this.firstReceiver != Name.fromString("eosio.token")) return;',
        });
      }
    }
  }

  // AUTH03: Admin action missing self-auth (info)
  const adminKeywords = ['init', 'setconfig', 'setpaused', 'pause', 'unpause', 'admin', 'setfee', 'setowner'];
  for (const action of actionLines) {
    if (adminKeywords.some(k => action.name.toLowerCase().includes(k)) && !action.isSelf) {
      findings.push({
        id: 'AUTH03',
        severity: 'info',
        title: `Admin action "${action.name}" missing this.receiver auth`,
        description: `Action "${action.name}" appears to be admin-only but doesn't require contract self-authorization.`,
        line: action.lineNum,
        suggestion: 'Add: requireAuth(this.receiver); for admin-only actions.',
      });
    }
  }

  // TABLE02: Invalid table name (warning)
  for (let i = 0; i < lines.length; i++) {
    const tableMatch = lines[i].match(/@table\("([^"]+)"/);
    if (tableMatch) {
      const tableName = tableMatch[1];
      if (tableName.length > 12 || !/^[a-z1-5.]+$/.test(tableName)) {
        findings.push({
          id: 'TABLE02',
          severity: 'warning',
          title: `Invalid table name "${tableName}"`,
          description: `Table name at line ${i + 1} uses invalid characters or exceeds 12 chars. Must be a-z, 1-5, and dots only.`,
          line: i + 1,
          suggestion: 'Rename to a valid EOSIO name (1-12 chars, a-z1-5. only).',
        });
      }
    }
  }

  // TABLE03: Missing secondary indexes on Name fields (info)
  let inTable = false;
  let tableHasSecondary = false;
  let tableNameFields: Array<{ name: string; line: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('@table(') && !trimmed.includes('singleton')) {
      inTable = true;
      tableHasSecondary = false;
      tableNameFields = [];
    }
    if (inTable) {
      if (trimmed.includes('@secondary')) tableHasSecondary = true;
      const fieldMatch = trimmed.match(/public\s+(\w+)\s*:\s*Name\s*=/);
      if (fieldMatch && fieldMatch[1] !== 'account' && !trimmed.includes('@primary')) {
        tableNameFields.push({ name: fieldMatch[1], line: i + 1 });
      }
      // End of class
      if (trimmed === '}' && !trimmed.includes('{')) {
        if (!tableHasSecondary && tableNameFields.length > 0) {
          for (const field of tableNameFields) {
            findings.push({
              id: 'TABLE03',
              severity: 'info',
              title: `Name field "${field.name}" has no secondary index`,
              description: `Consider adding a @secondary getter for "${field.name}" to enable efficient lookups.`,
              line: field.line,
              suggestion: `Add: @secondary\nget by${field.name.charAt(0).toUpperCase() + field.name.slice(1)}(): u64 { return this.${field.name}.N; }`,
            });
          }
        }
        inTable = false;
      }
    }
  }

  // INIT01: init() without re-init guard (critical)
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.includes('@action("init")') && !trimmed.includes('notify')) {
      // Scan next 20 lines for re-init guard patterns
      let hasGuard = false;
      for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
        const checkLine = lines[j];
        if (checkLine.includes('Already initialized') ||
            checkLine.includes('already init') ||
            checkLine.includes('EMPTY_NAME') ||
            (checkLine.includes('.get()') && lines[j + 1]?.includes('check(') && lines[j + 1]?.includes('null'))) {
          hasGuard = true;
          break;
        }
      }
      if (!hasGuard) {
        findings.push({
          id: 'INIT01',
          severity: 'critical',
          title: 'init() action missing re-initialization guard',
          description: `The init() action at line ${i + 1} can be called multiple times, potentially overwriting config.`,
          line: i + 1,
          suggestion: 'Add: const existing = this.configSingleton.get(); check(existing === null, "Already initialized");',
        });
      }
    }
  }

  // REVERT01: check(false) after inline token transfer (critical)
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('InlineAction') || lines[i].includes('.send(')) {
      // Look for check(false) in the next 10 lines
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        if (lines[j].includes('check(false')) {
          findings.push({
            id: 'REVERT01',
            severity: 'critical',
            title: 'check(false) after inline action — reverts the transfer!',
            description: `check(false) at line ${j + 1} will revert the entire transaction including the inline action at line ${i + 1}.`,
            line: j + 1,
            suggestion: 'Use return instead of check(false) after inline actions you want to keep.',
          });
        }
      }
    }
  }

  // AS01: === string comparison (warning)
  for (let i = 0; i < lines.length; i++) {
    // Match === with string-like operands (quotes or string variables)
    if (lines[i].includes('===') && (lines[i].includes('"') || lines[i].includes("'"))) {
      findings.push({
        id: 'AS01',
        severity: 'warning',
        title: '=== with string operands — compares references, not content',
        description: `Line ${i + 1} uses === which checks reference equality in AssemblyScript. Use == for string content comparison.`,
        line: i + 1,
        suggestion: 'Replace === with == for string comparisons.',
      });
    }
  }

  // AS02: Arrow functions in .filter/.map/.reduce (warning)
  for (let i = 0; i < lines.length; i++) {
    if (/\.(filter|map|reduce)\s*\(/.test(lines[i]) && lines[i].includes('=>')) {
      findings.push({
        id: 'AS02',
        severity: 'warning',
        title: 'Arrow function closure in .filter/.map/.reduce',
        description: `Line ${i + 1} uses arrow functions which don't support closures in AssemblyScript. Variables from outer scope won't be captured.`,
        line: i + 1,
        suggestion: 'Use a for loop instead of .filter/.map/.reduce with closures.',
      });
    }
  }

  // AS03: try/catch (warning)
  for (let i = 0; i < lines.length; i++) {
    if (/\btry\s*\{/.test(lines[i].trim())) {
      findings.push({
        id: 'AS03',
        severity: 'warning',
        title: 'try/catch not supported in AssemblyScript',
        description: `Line ${i + 1} uses try/catch which is not available in AssemblyScript. Use check() for validation.`,
        line: i + 1,
        suggestion: 'Remove try/catch and use check() assertions for error handling.',
      });
    }
  }

  // AS04: : any type annotation (warning)
  for (let i = 0; i < lines.length; i++) {
    if (/:\s*any\b/.test(lines[i])) {
      findings.push({
        id: 'AS04',
        severity: 'warning',
        title: '"any" type not supported in AssemblyScript',
        description: `Line ${i + 1} uses the "any" type which does not exist in AssemblyScript. All values must be typed.`,
        line: i + 1,
        suggestion: 'Replace with a concrete type (u64, string, Name, etc.) or use generics.',
      });
    }
  }

  // AS05: undefined used as value (warning)
  for (let i = 0; i < lines.length; i++) {
    if (/\bundefined\b/.test(lines[i]) && !lines[i].trim().startsWith('//') && !lines[i].trim().startsWith('*')) {
      findings.push({
        id: 'AS05',
        severity: 'warning',
        title: '"undefined" not available in AssemblyScript',
        description: `Line ${i + 1} uses "undefined" which does not exist as a value in AssemblyScript. Use null or default values.`,
        line: i + 1,
        suggestion: 'Replace "undefined" with null or a typed default value.',
      });
    }
  }

  // FIN01: Floating point for financial calculations (warning)
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    if (/:\s*(f32|f64)\b/.test(lines[i]) || /\bFloat\b/.test(lines[i])) {
      // Check if it looks like financial context
      const context = lines.slice(Math.max(0, i - 3), i + 4).join(' ').toLowerCase();
      if (/balance|amount|price|fee|payment|cost|total|stake|reward/.test(context)) {
        findings.push({
          id: 'FIN01',
          severity: 'warning',
          title: 'Floating point used in financial context',
          description: `Line ${i + 1} uses floating point (f32/f64) near financial terms. Floating point causes rounding errors.`,
          line: i + 1,
          suggestion: 'Use u64 with fixed decimal places (e.g. 10000 = 1.0000 with 4 decimals).',
        });
      }
    }
  }

  // SEC01: Hardcoded private key pattern (warning)
  for (let i = 0; i < lines.length; i++) {
    if (/PVT_K1_|5[HJK][1-9A-HJ-NP-Za-km-z]{49}/.test(lines[i])) {
      findings.push({
        id: 'SEC01',
        severity: 'warning',
        title: 'Possible hardcoded private key',
        description: `Line ${i + 1} appears to contain a private key. Never hardcode keys in contract source.`,
        line: i + 1,
        suggestion: 'Remove the private key immediately and rotate it.',
      });
    }
  }

  // ITER01: Unbounded getAll() without limit (info)
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('.getAll()') || lines[i].includes('.getAll(')) {
      findings.push({
        id: 'ITER01',
        severity: 'info',
        title: 'Unbounded table iteration with getAll()',
        description: `Line ${i + 1} reads all rows from a table. Large tables can exceed transaction CPU limits.`,
        line: i + 1,
        suggestion: 'Consider paginated reads or use cursor-based iteration with limits.',
      });
    }
  }

  // SINGLE01: Singleton .get() without null check (warning)
  for (let i = 0; i < lines.length; i++) {
    if (/Singleton.*\.get\(\)/.test(lines[i]) || /singleton.*\.get\(\)/.test(lines[i])) {
      // Check if next line has null/check
      const nextLines = lines.slice(i, Math.min(i + 3, lines.length)).join(' ');
      if (!nextLines.includes('null') && !nextLines.includes('check(') && !nextLines.includes('!== null') && !nextLines.includes('!= null')) {
        findings.push({
          id: 'SINGLE01',
          severity: 'warning',
          title: 'Singleton .get() without null check',
          description: `Line ${i + 1} reads a singleton without checking for null. Returns null if not initialized.`,
          line: i + 1,
          suggestion: 'Add: const config = this.singleton.get(); check(config !== null, "Not initialized");',
        });
      }
    }
  }

  // SCOPE01: Cross-contract table read (info)
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/@table\("([^"]+)",\s*"([^"]+)"\)/);
    if (match) {
      findings.push({
        id: 'SCOPE01',
        severity: 'info',
        title: `Cross-contract table read: "${match[1]}" from "${match[2]}"`,
        description: `Line ${i + 1} reads a table from another contract. Binary serialization requires fields to match exactly.`,
        line: i + 1,
        suggestion: 'Verify field order and types match the source contract exactly. Missing/reordered fields cause silent data corruption.',
      });
    }
  }

  // Sort: critical first, then warning, then info
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return findings;
}
