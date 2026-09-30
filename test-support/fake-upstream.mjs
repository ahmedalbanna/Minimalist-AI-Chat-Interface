import http from 'node:http';
import { URL } from 'node:url';

const HOST = process.env.FAKE_HOST || '127.0.0.1';
const PORT = Number(process.env.FAKE_PORT || 8799);
const CHUNK_BYTES = Number(process.env.FAKE_CHUNK_BYTES || 17);
const TOKEN_DELAY_MS = Number(process.env.FAKE_TOKEN_DELAY_MS || 8);
const SLOW_TOKEN_DELAY_MS = Number(process.env.FAKE_SLOW_TOKEN_DELAY_MS || 25);
const SLOW_TOKEN_COUNT = Number(process.env.FAKE_SLOW_TOKEN_COUNT || 400);
const TOOL_DELAY_MS = Number(process.env.FAKE_TOOL_DELAY_MS || 5000);
const MODEL_ID = process.env.FAKE_MODEL_ID || 'fake-chat-1';
const EMBED_MODEL_ID = process.env.FAKE_EMBED_MODEL_ID || 'fake-embed-1';
const OLLAMA_CHAT_MODEL = process.env.FAKE_OLLAMA_CHAT_MODEL || 'fake-llama-chat';
const OLLAMA_EMBED_MODEL = process.env.FAKE_OLLAMA_EMBED_MODEL || 'fake-llama-embed';
const PROTOCOL_VERSION = '2025-11-25';
const EXPECTED_READ_TOOLS = 226;

const TIER_ORDER = ['read', 'write', 'customize', 'administer', 'execute'];

const TIER_LABELS = {
  read: 'Read-only introspection and extraction; never writes.',
  write: 'Row/document-level business data changes (CRUD, submit, flows).',
  customize: 'Schema and metadata authoring (fields, doctypes, forms, workflows, reports, desk, scripts).',
  administer: 'Platform, users, access, and backup administration.',
  execute: 'Arbitrary code or command execution; highest blast radius.',
};

const TIER_SEMANTICS = {
  read: 'read',
  write: 'write',
  customize: 'admin',
  administer: 'admin',
  execute: 'dangerous',
};

const slug = (value) =>
  value
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();

const READ_NAMED = [
  ['get_doc', 'Fetch a single document by doctype and name. Field-level redaction is applied by the gateway.', ['doctype', 'name', 'fields']],
  ['list_docs', 'List documents of a doctype with filters, fields, order by and limit.', ['doctype', 'filters', 'fields', 'limit']],
  ['get_doctype_meta', 'Read the DocType meta: fields, permissions, naming and workflows.', ['doctype']],
  ['list_doctypes', 'List every DocType visible to the caller, with module and table flags.', ['module', 'limit']],
  ['get_capabilities', 'Report the surfaces and roles the calling client is allowed to use.', []],
  ['recommend_tools', 'Recommend tools, journeys, flows and playbooks for a natural language query.', ['query']],
  ['get_tool_manifest', 'Return the full tool manifest including tier assignments for every tool.', []],
  ['get_account_balance', 'Return the bank and cash account balances for a company.', ['company', 'account']],
  ['get_gl_entries', 'Read general ledger entries for an account over a period.', ['account', 'from_date', 'to_date']],
  ['get_outstanding_amounts', 'Outstanding receivable and payable amounts grouped by party.', ['company', 'party_type']],
  ['get_aging', 'Aging buckets for receivables or payables.', ['party_type', 'company']],
  ['get_profit_and_loss', 'Profit and loss statement for a company and fiscal year.', ['company', 'fiscal_year']],
  ['get_business_snapshot', 'Headline counts and totals across sales, stock and cash.', ['company']],
  ['get_ledger', 'Customer or supplier ledger with opening balance and running total.', ['party', 'party_type']],
  ['get_employee', 'Fetch one employee record with user, department and status.', ['employee', 'fields']],
  ['get_employee_list', 'List employees, optionally filtered by department, status or grade.', ['department', 'status', 'limit']],
  ['get_customer', 'Fetch one customer with credit limit, terms and outstanding.', ['customer']],
  ['get_supplier', 'Fetch one supplier with terms and outstanding payable.', ['supplier']],
  ['get_item', 'Fetch one item with stock unit, valuation and tax template.', ['item']],
  ['get_warehouse', 'Fetch one warehouse with company and disabled flag.', ['warehouse']],
  ['get_stock_qty', 'Available, reserved and ordered quantity for an item across warehouses.', ['item', 'warehouse']],
  ['get_bin', 'Read the stock bin ledger rows for an item in a warehouse.', ['item', 'warehouse']],
  ['get_sales_invoice', 'Fetch one sales invoice with lines, taxes and payment status.', ['sales_invoice']],
  ['get_sales_invoice_list', 'List sales invoices with customer, date range, status and outstanding.', ['customer', 'status', 'from_date', 'limit']],
  ['get_payment_entry', 'Fetch one payment entry with allocated references.', ['payment_entry']],
  ['get_payment_status', 'Payment and outstanding status for a sales invoice.', ['sales_invoice']],
  ['get_invoice_summary', 'Aggregate sales invoice counts and totals by status.', ['company', 'from_date', 'to_date']],
  ['get_customer_statement', 'Statement of account for a customer over a date range.', ['customer', 'from_date', 'to_date']],
  ['get_supplier_statement', 'Statement of account for a supplier over a date range.', ['supplier', 'from_date', 'to_date']],
  ['get_company', 'Fetch one company with default accounts and fiscal year setup.', ['company']],
  ['get_leave_balance', 'Leave balance and allocation history for an employee.', ['employee']],
  ['get_price_list', 'Read a price list with its item price rows.', ['price_list']],
  ['get_uom_conversion', 'Unit of measure conversion factors between two units.', ['item', 'from_uom', 'to_uom']],
  ['get_territory_hierarchy', 'Territory tree with parent and child mappings.', ['territory']],
  ['get_cost_center_detail', 'Fetch one cost center with its allocation ratios.', ['cost_center']],
  ['get_project_summary', 'Project budget, spent and billed totals.', ['project']],
  ['list_payment_entries', 'List payment entries by party, mode and date range.', ['party_type', 'mode', 'from_date', 'limit']],
  ['get_payment_schedule', 'Scheduled payment terms and dates for an invoice.', ['doctype', 'name']],
  ['get_invoice_payment_ledger', 'Payment allocations for one invoice over time.', ['sales_invoice']],
  ['get_employee_leave_request', 'Leave requests and their approval state for an employee.', ['employee', 'status']],
  ['flaky_tool', 'Diagnostic tool that always fails, used to exercise recoverable tool errors.', ['mode']],
  ['slow_tool', 'Diagnostic tool that responds slowly, used to exercise cancellation.', ['delay_ms']],
];

const WRITE_TOOLS = [
  ['create_doc', 'Create a new document of a doctype.', ['doctype', 'values'], 'write'],
  ['update_doc', 'Update fields on an existing document.', ['doctype', 'name', 'values'], 'write'],
  ['delete_doc', 'Delete a document permanently.', ['doctype', 'name'], 'write'],
  ['submit_doc', 'Submit a draft document so it posts to the ledger.', ['doctype', 'name'], 'write'],
  ['cancel_doc', 'Cancel a submitted document and reverse its ledger effect.', ['doctype', 'name'], 'write'],
  ['set_value', 'Set a field on a document without a full form round trip.', ['doctype', 'name', 'field', 'value'], 'write'],
  ['run_flow', 'Execute a curated multi-step flow in one call.', ['flow', 'reference'], 'write'],
  ['send_email', 'Send a transactional email from a doctype.', ['doctype', 'name', 'recipients'], 'write'],
  ['create_custom_field', 'Add a custom field to a DocType.', ['doctype', 'fieldname', 'fieldtype'], 'customize'],
  ['bulk_insert', 'Insert many rows of a child table in one call.', ['doctype', 'rows'], 'customize'],
  ['create_print_format', 'Create a print format for a doctype.', ['doctype', 'name'], 'customize'],
  ['add_index', 'Add a database index to a DocType field.', ['doctype', 'fields'], 'administer'],
  ['set_moderator', 'Grant or revoke moderator privileges on a doctype.', ['doctype', 'role', 'level'], 'administer'],
  ['restore_backup', 'Restore the site from a named backup.', ['backup', 'site'], 'administer'],
  ['run_python', 'Run arbitrary Python inside the site context.', ['code'], 'execute'],
  ['run_shell', 'Run an arbitrary shell command on the bench host.', ['command'], 'execute'],
];

const UNTIERED_TOOLS = [
  ['mrtr_status', 'Report MRTR runtime status.', []],
  ['list_clients', 'List gateway clients.', []],
  ['gateway_audit_report', 'Render a gateway audit report.', []],
  ['list_approvals', 'List pending gateway approvals.', []],
];

const DOCTYPES = [
  'Sales Invoice', 'Purchase Invoice', 'Item', 'Customer', 'Supplier', 'Employee',
  'Sales Order', 'Purchase Order', 'Delivery Note', 'Payment Entry', 'Journal Entry',
  'GL Entry', 'Stock Ledger Entry', 'Bin', 'Warehouse', 'UOM', 'Territory', 'Company',
  'Cost Center', 'Project', 'Task', 'Lead', 'Opportunity', 'Quotation',
  'Material Request', 'Stock Entry', 'Bank Transaction', 'Tax Template',
  'Terms and Conditions', 'Print Format', 'Workflow', 'Custom Field',
];

const VERBS = [
  ['get', (d) => `Read one ${d} by name.`, ['doctype', 'name']],
  ['list', (d) => `List ${d} rows with optional filters and a limit.`, ['doctype', 'filters', 'limit']],
  ['find', (d) => `Search ${d} by text across indexed fields.`, ['doctype', 'query']],
  ['count', (d) => `Count ${d} rows matching filters.`, ['doctype', 'filters']],
  ['sum', (d) => `Aggregate a numeric field over ${d} rows.`, ['doctype', 'field', 'filters']],
  ['report', (d) => `Run the standard report view over ${d}.`, ['doctype', 'columns']],
];

function buildCatalog() {
  const byName = new Map();
  const add = (tool) => {
    if (byName.has(tool.name)) return;
    byName.set(tool.name, tool);
  };
  for (const [name, description, params] of READ_NAMED) add({ name, description, params, tier: 'read' });
  for (const doctype of DOCTYPES) {
    for (const [verb, describe, params] of VERBS) {
      add({ name: `${verb}_${slug(doctype)}`, description: describe(doctype), params, tier: 'read', doctype });
    }
  }
  for (const [name, description, params, tier] of WRITE_TOOLS) add({ name, description, params, tier });
  for (const [name, description, params] of UNTIERED_TOOLS) add({ name, description, params, tier: null });
  add({
    name: 'call_tool',
    description:
      'Generic escape hatch: invoke any tool by name with arbitrary arguments, bypassing the declared tier of the target tool.',
    params: ['tool', 'arguments'],
    tier: 'read',
  });

  const tools = [...byName.values()];
  const readCount = tools.filter((t) => t.tier === 'read').length;
  if (readCount !== EXPECTED_READ_TOOLS) {
    throw new Error(`fake catalog read count drifted: expected ${EXPECTED_READ_TOOLS}, got ${readCount}`);
  }

  return tools;
}

const TOOLS = buildCatalog();
const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

const TIERS = (() => {
  const tiers = {};
  for (const tool of TOOLS) if (tool.tier) tiers[tool.name] = tool.tier;
  return tiers;
})();

const READ_COUNT = Object.values(TIERS).filter((t) => t === 'read').length;

const state = {
  scenario: 'auto',
  framing: 'json',
  sessionId: null,
  sessionLoss: false,
  httpStatus: 429,
  httpFailuresRemaining: 0,
  requests: [],
  calls: [],
  inFlight: 0,
  sessions: 0,
  lastLlmTools: new Set(),
};

// `poll` is declared before the early return on purpose: `finish` closes over it, and a setTimeout
// callback runs after this function has returned, so reaching `clearInterval(poll)` with the binding
// still in its temporal dead zone throws on every single request.
const delay = (ms, options) => new Promise((resolve) => {
  let poll = null;
  const finish = () => {
    clearTimeout(timer);
    if (poll) clearInterval(poll);
    resolve();
  };
  const timer = setTimeout(finish, ms);
  if (!options || typeof options.aborted !== 'function') return;
  poll = setInterval(() => { if (options.aborted()) finish(); }, 50);
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      parts.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res, status, payload, extraHeaders = {}) {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
    ...extraHeaders,
  });
  res.end(text);
}

async function writeChunked(res, text, size, gapMs) {
  if (typeof text !== 'string') throw new TypeError(`writeChunked expects a string, received ${typeof text}`);
  const buf = Buffer.from(text, 'utf8');
  for (let i = 0; i < buf.length; i += size) {
    if (res.destroyed || res.writableEnded || res.socket?.destroyed) return false;
    const ok = res.write(buf.subarray(i, Math.min(i + size, buf.length)));
    if (!ok) await new Promise((resolve) => res.once('drain', resolve));
    if (gapMs > 0) await delay(gapMs);
  }
  return !(res.destroyed || res.writableEnded);
}

function lastUserText(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') return String(messages[i].content ?? '');
  }
  return '';
}

function countToolResults(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  return messages.filter((m) => m.role === 'tool').length;
}

// A fixture that claims success after a failed tool teaches the harness to pass on a lie. The closing
// turn has to read the results it was actually given, exactly as a well-behaved model would.
function lastToolResultsFailed(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const results = messages.filter((m) => m.role === 'tool');
  if (!results.length) return false;
  return results.some((m) => {
    let text = m.content;
    if (typeof text !== 'string') return false;
    try {
      const outer = JSON.parse(text);
      if (typeof outer.result === 'string') text = outer.result;
      else if (outer && typeof outer === 'object' && 'result' in outer) text = outer.result;
    } catch { /* not JSON: treat the raw text as the message */ }
    if (typeof text === 'object' && text !== null) return text.status !== 'ok';
    return /"status"\s*:\s*"(error|indeterminate|rejected|cancelled)"/.test(String(text))
      || /rejected|indeterminate|not available|not found|failed/i.test(String(text));
  });
}

function toolNamesInRequest(body) {
  const tools = Array.isArray(body?.tools) ? body.tools : [];
  return tools.map((t) => t?.function?.name).filter(Boolean);
}

const SCENARIOS = new Set([
  'auto', 'plain', 'text', 'tool-read', 'tool-error', 'tool-write', 'multi-write', 'tool-untiered',
  'tool-escape', 'tool-recommend', 'slow-text', 'slow-tool', 'error-http', 'error-json',
  'error-then-ok', 'multi-tool',
]);

function resolveScenario(url, body) {
  const explicit = url.searchParams.get('scenario');
  const chosen = state.scenario !== 'auto' ? state.scenario : explicit;
  if (chosen && SCENARIOS.has(chosen)) return chosen;
  if (explicit && SCENARIOS.has(explicit)) return explicit;
  if (body && countToolResults(body) > 0) return 'finish';
  return 'plain';
}

function sseFrame(delta, finishReason, usage) {
  const payload = {
    id: 'chatcmpl-fake',
    object: 'chat.completion.chunk',
    created: 1700000000,
    model: MODEL_ID,
    choices: [{ index: 0, delta, finish_reason: finishReason ?? null }],
  };
  if (usage) payload.usage = usage;
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function toolCallFrames(call, finishReason, usage) {
  const name = call.function.name;
  const args = call.function.arguments;
  const frames = [];
  frames.push(
    sseFrame({
      tool_calls: [{ index: call.index ?? 0, id: call.id, type: 'function', function: { name, arguments: '' } }],
    }, null),
  );
  const half = Math.max(1, Math.floor(args.length / 2));
  frames.push(sseFrame({ tool_calls: [{ index: call.index ?? 0, function: { arguments: args.slice(0, half) } }] }, null));
  frames.push(sseFrame({ tool_calls: [{ index: call.index ?? 0, function: { arguments: args.slice(half) } }] }, finishReason, usage));
  return frames.join('');
}

function planFor(scenario, body) {
  if (scenario === 'error-http') return { kind: 'http-error' };
  if (scenario === 'error-json') return { kind: 'stream-error' };
  if (scenario === 'slow-text') {
    if (countToolResults(body) > 0) return { kind: 'text', text: 'Recovered after the slow turn.' };
    return { kind: 'slow-text' };
  }
  if (scenario === 'slow-tool') {
    if (countToolResults(body) > 0) return { kind: 'text', text: 'Stock query finished.' };
    return { kind: 'calls', calls: [{ name: 'slow_tool', args: {} }] };
  }
  if (countToolResults(body) > 0) {
    if (lastToolResultsFailed(body)) {
      return { kind: 'text', text: 'The tool call did not succeed, so I have nothing to report. I did not make the change.' };
    }
    return { kind: 'text', text: finishTextFor(scenario) };
  }

  switch (scenario) {
    case 'plain':
    case 'text':
      return { kind: 'text', text: 'There are 3 unpaid sales invoices totalling 4,200 in the fake ledger.' };
    case 'tool-read':
      return { kind: 'calls', calls: [{ name: 'get_doc', args: { doctype: 'Sales Invoice', name: 'SI-0001' } }] };
    case 'tool-error':
      return { kind: 'calls', calls: [{ name: 'flaky_tool', args: { mode: 'hard' } }] };
    case 'tool-write':
      return { kind: 'calls', calls: [{ name: 'create_doc', args: { doctype: 'Sales Invoice', title: 'Called by the fake model' } }] };
    case 'multi-write':
      // Two calls to the same write tool plus a different one. The conversation-grant path has to
      // suppress only the repeat, so the fixture needs both halves of that distinction.
      return {
        kind: 'calls',
        calls: [
          { name: 'create_doc', args: { doctype: 'Sales Invoice', title: 'First' } },
          { name: 'create_doc', args: { doctype: 'Sales Invoice', title: 'Second' } },
          { name: 'delete_doc', args: { doctype: 'Sales Invoice', name: 'SI-0001' } },
        ],
      };
    case 'tool-untiered':
      return { kind: 'calls', calls: [{ name: 'list_approvals', args: { limit: 5 } }] };
    case 'tool-escape':
      return { kind: 'calls', calls: [{ name: 'call_tool', args: { tool: 'delete_doc', arguments: { doctype: 'Sales Invoice', name: 'SI-0001' } } }] };
    case 'multi-tool':
      return {
        kind: 'calls',
        calls: [
          { name: 'get_doc', args: { doctype: 'Sales Invoice', name: 'SI-0001' } },
          { name: 'get_capabilities', args: {} },
          { name: 'get_doctype_meta', args: { doctype: 'Sales Invoice' } },
        ],
      };
    case 'tool-recommend':
      return { kind: 'calls', calls: [{ name: 'recommend_tools', args: { query: lastUserText(body) || 'unpaid sales invoices' } }] };
    default:
      return { kind: 'text', text: 'Nothing to look up; here is a plain answer.' };
  }
}

function finishTextFor(scenario) {
  switch (scenario) {
    case 'tool-read':
      return 'SI-0001 is 1,200 outstanding and unpaid, due in 9 days.';
    case 'tool-error':
      return 'The lookup tool failed, so I could not read the value. Retry if you want me to try again.';
    case 'tool-write':
      return 'The draft Sales Invoice was created.';
    case 'multi-write':
      return 'Both drafts were created.';
    case 'tool-untiered':
      return 'That tool is not available to this client.';
    case 'tool-escape':
      return 'That escape hatch was not available.';
    case 'tool-recommend':
      return 'Found it with the recommended tool.';
    case 'tool-error-second':
      return 'The second tool also failed.';
    default:
      return 'Done.';
  }
}

async function handleOpenAiChat(req, res, url) {
  const raw = await readBody(req);
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return json(res, 400, { error: { message: 'invalid JSON body', type: 'invalid_request_error' } });
  }
  state.requests.push({
    at: Date.now(),
    kind: 'openai',
    model: body.model ?? null,
    stream: body.stream !== false,
    tools: toolNamesInRequest(body),
    messageRoles: Array.isArray(body.messages) ? body.messages.map((m) => m.role) : [],
    lastUserText: lastUserText(body),
    temperature: body.temperature ?? null,
    max_tokens: body.max_tokens ?? null,
    tool_choice: body.tool_choice ?? null,
  });

  const scenario = resolveScenario(url, body);
  const plan = planFor(scenario, body);
  state.lastLlmTools = new Set(toolNamesInRequest(body));

  if (plan.kind === 'http-error' || (scenario === 'error-then-ok' && state.httpFailuresRemaining > 0)) {
    if (scenario === 'error-then-ok') state.httpFailuresRemaining -= 1;
    const status = Number.isInteger(state.httpStatus) ? state.httpStatus : 429;
    return json(res, status, { error: { message: `simulated upstream ${status}`, type: 'rate_limit_error' } });
  }

  if (scenario === 'tool-recommend' && countToolResults(body) === 1) {
    const present = new Set(toolNamesInRequest(body));
    const followUp = [
      { name: 'get_outstanding_amounts', args: { party_type: 'Customer' } },
      { name: 'get_invoice_summary', args: { company: 'Example' } },
    ].find((c) => present.has(c.name));
    if (followUp) {
      return streamSse(res, [
        toolCallFrames({ id: 'call_recommend_2', function: { name: followUp.name, arguments: JSON.stringify(followUp.args) } }, 'tool_calls', { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 }),
        'data: [DONE]\n\n',
      ], 6);
    }
  }

  if (plan.kind === 'stream-error') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ error: { message: 'simulated stream fault' } })}\n\n`);
    return void res.end();
  }

  if (!body.stream) {
    if (plan.kind === 'calls') {
      const call = plan.calls[0];
      return json(res, 200, {
        id: 'chatcmpl-fake',
        object: 'chat.completion',
        model: MODEL_ID,
        choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [{ id: call.id || 'call_1', type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] }, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
      });
    }
    return json(res, 200, {
      id: 'chatcmpl-fake',
      object: 'chat.completion',
      model: MODEL_ID,
      choices: [{ index: 0, message: { role: 'assistant', content: plan.text ?? '' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 20, completion_tokens: 12, total_tokens: 32 },
    });
  }

  if (plan.kind === 'calls') {
    const frames = plan.calls
      .map((call, i) => toolCallFrames({ id: call.id || `call_${i + 1}`, index: i, function: { name: call.name, arguments: JSON.stringify(call.args) } }, null))
      .join('');
    return streamSse(res, [
      sseFrame({ content: 'Checking the fake ledger. ' }),
      frames,
      sseFrame({}, 'tool_calls', { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 }),
      'data: [DONE]\n\n',
    ], 6);
  }

  if (plan.kind === 'slow-text') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(sseFrame({ role: 'assistant', content: '' }, null));
    for (let i = 0; i < SLOW_TOKEN_COUNT; i += 1) {
      const alive = await writeChunked(res, sseFrame({ content: `token${i} ` }, null), CHUNK_BYTES, SLOW_TOKEN_DELAY_MS);
      if (!alive) return;
    }
    await writeChunked(res, sseFrame({}, 'stop', { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 }) + 'data: [DONE]\n\n', CHUNK_BYTES, 0);
    return void res.end();
  }

  return streamSse(res, [textFrames(plan.text), sseFrame({}, 'stop', { prompt_tokens: 20, completion_tokens: 14, total_tokens: 34 }), 'data: [DONE]\n\n'], TOKEN_DELAY_MS);
}

function textFrames(text) {
  const tokens = text.match(/\S+\s*/g) || [text];
  const frames = [sseFrame({ role: 'assistant', content: '' }, null)];
  for (const token of tokens) frames.push(sseFrame({ content: token }, null));
  return frames.join('');
}

async function streamSse(res, parts, gapMs) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  for (const part of parts) {
    const alive = await writeChunked(res, part, CHUNK_BYTES, gapMs);
    if (!alive) return;
  }
  if (!res.writableEnded) res.end();
}

async function handleOllamaChat(req, res, url) {
  const raw = await readBody(req);
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return json(res, 400, { error: 'invalid JSON body' });
  }
  state.requests.push({
    at: Date.now(),
    kind: 'ollama',
    model: body.model ?? null,
    stream: body.stream !== false,
    tools: toolNamesInRequest(body),
    messageRoles: Array.isArray(body.messages) ? body.messages.map((m) => m.role) : [],
    lastUserText: lastUserText(body),
  });

  const scenario = resolveScenario(url, body);
  const plan = planFor(scenario, body);
  state.lastLlmTools = new Set(toolNamesInRequest(body));

  res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });

  const emit = async (obj) => {
    const alive = await writeChunked(res, `${JSON.stringify(obj)}\n`, CHUNK_BYTES, TOKEN_DELAY_MS);
    return alive;
  };

  if (plan.kind === 'calls') {
    const call = plan.calls[0];
    if (!(await emit({ model: body.model ?? OLLAMA_CHAT_MODEL, created_at: '2024-01-01T00:00:00Z', message: { role: 'assistant', content: 'Checking the fake ledger. ' }, done: false }))) return;
    if (!(await emit({
      model: body.model ?? OLLAMA_CHAT_MODEL,
      created_at: '2024-01-01T00:00:00Z',
      message: { role: 'assistant', content: '', tool_calls: [{ function: { name: call.name, arguments: call.args } }] },
      done: false,
    }))) return;
    if (!(await emit({ model: body.model ?? OLLAMA_CHAT_MODEL, created_at: '2024-01-01T00:00:00Z', message: { role: 'assistant', content: '' }, done_reason: 'stop', done: true, prompt_eval_count: 20, eval_count: 8 }))) return;
    return void res.end();
  }

  if (plan.kind === 'http-error') {
    return void res.end();
  }

  if (plan.kind === 'slow-text') {
    await emit({ model: body.model ?? OLLAMA_CHAT_MODEL, created_at: '2024-01-01T00:00:00Z', message: { role: 'assistant', content: '' }, done: false });
    for (let i = 0; i < SLOW_TOKEN_COUNT; i += 1) {
      const alive = await emit({ model: body.model ?? OLLAMA_CHAT_MODEL, created_at: '2024-01-01T00:00:00Z', message: { role: 'assistant', content: `token${i} ` }, done: false });
      if (!alive) return;
    }
    if (!(await emit({ model: body.model ?? OLLAMA_CHAT_MODEL, created_at: '2024-01-01T00:00:00Z', message: { role: 'assistant', content: '' }, done_reason: 'stop', done: true, prompt_eval_count: 20, eval_count: 20 }))) return;
    return void res.end();
  }

  for (const token of (plan.text.match(/\S+\s*/g) || [plan.text])) {
    if (!(await emit({ model: body.model ?? OLLAMA_CHAT_MODEL, created_at: '2024-01-01T00:00:00Z', message: { role: 'assistant', content: token }, done: false }))) return;
  }
  if (!(await emit({ model: body.model ?? OLLAMA_CHAT_MODEL, created_at: '2024-01-01T00:00:00Z', message: { role: 'assistant', content: '' }, done_reason: 'stop', done: true, prompt_eval_count: 20, eval_count: 14 }))) return;
  void res.end();
}

const okEnvelope = (inner) => JSON.stringify({ status: 'ok', result: JSON.stringify(inner) });
const errorEnvelope = (message) => JSON.stringify({ status: 'error', error: message });
const indeterminateEnvelope = (message) => JSON.stringify({ status: 'indeterminate', error: message });

const SALES_INVOICE = {
  name: 'SI-0001',
  customer: 'CUST-0007',
  posting_date: '2026-09-18',
  grand_total: 1200,
  outstanding_amount: 1200,
  status: 'Unpaid',
  currency: 'USD',
  items: [{ item_code: 'ITEM-0001', qty: 4, rate: 300 }],
};

function toolInnerResult(name, args) {
  switch (name) {
    case 'get_doc':
    case 'get_sales_invoice':
    case 'get_payment_entry':
      return { status: 'ok', message: `Read ${args.doctype || 'Sales Invoice'} ${args.name || args.sales_invoice || 'SI-0001'}`, data: SALES_INVOICE, hints: [] };
    case 'list_docs':
    case 'get_sales_invoice_list':
      return {
        status: 'ok',
        message: 'Found 2 document(s)',
        data: null,
        hints: [],
        count: 2,
        docs: [SALES_INVOICE, { ...SALES_INVOICE, name: 'SI-0002', grand_total: 3000, outstanding_amount: 3000 }],
      };
    case 'list_doctypes':
      return { status: 'ok', message: `Found ${DOCTYPES.length} DocType(s)`, data: null, hints: [], count: DOCTYPES.length, doctypes: DOCTYPES.map((d) => ({ name: d, module: 'Core', custom: 0, istable: 0 })) };
    case 'get_doctype_meta':
      return { status: 'ok', message: `Meta for ${args.doctype || 'Sales Invoice'}`, data: { name: args.doctype || 'Sales Invoice', fields: [{ fieldname: 'name', fieldtype: 'Data' }, { fieldname: 'grand_total', fieldtype: 'Currency' }] }, hints: [] };
    case 'get_capabilities':
      return { status: 'ok', message: 'Capabilities', data: { client: 'fake-default', tiers: TIER_ORDER, read_tools: READ_COUNT }, hints: [] };
    case 'get_tool_manifest':
      return {
        status: 'ok',
        message: `Tool manifest with ${Object.keys(TIERS).length} tools`,
        data: {
          tiers: TIERS,
          tier_order: TIER_ORDER,
          tier_labels: TIER_LABELS,
          tier_semantics: TIER_SEMANTICS,
          surface_version: '0.0.0-fake',
          total: TOOLS.length,
        },
        hints: [],
        site: 'fake.localhost',
        site_source: 'default',
      };
    case 'recommend_tools': {
      const query = String(args.query || '').toLowerCase();
      const tokens = query.split(/[^a-z]+/).filter((t) => t.length > 2);
      const scored = TOOLS
        .filter((t) => t.tier === 'read' || t.tier === 'write')
        .map((t) => {
          const hay = `${t.name} ${t.description}`.toLowerCase();
          const score = tokens.reduce((acc, token) => acc + (hay.includes(token) ? 1 : 0), 0);
          return { tool: t.name, tier: t.tier, description: t.description, score, inShortlist: state.lastLlmTools.has(t.name) };
        })
        .filter((m) => m.score > 0);
      scored.sort((a, b) => (a.inShortlist === b.inShortlist ? b.score - a.score : a.inShortlist ? 1 : -1));
      const matches = scored.slice(0, 6);
      if (!matches.some((m) => m.tool === 'get_doc')) {
        matches.unshift({ tool: 'get_doc', tier: 'read', description: BY_NAME.get('get_doc').description, score: 0, inShortlist: state.lastLlmTools.has('get_doc') });
      }
      return { status: 'ok', message: `${matches.length} tool(s) matched '${args.query || ''}'`, data: { query: args.query || '', matches }, hints: [], journeys: [], flows: [], playbooks: [] };
    }
    case 'create_doc':
    case 'create_custom_field':
    case 'add_index':
    case 'run_python':
    case 'run_shell':
      return { status: 'ok', message: `Created ${name}`, data: { name: args.name || args.fieldname || 'NEW-0001', request_id: args.request_id ?? null }, hints: [] };
    case 'call_tool': {
      const target = String(args.tool || '');
      const spec = BY_NAME.get(target);
      if (!spec) return null;
      return { status: 'ok', message: `call_tool dispatched ${target}`, data: { dispatched: true, target, forwarded: args.arguments ?? null }, hints: [] };
    }
    default: {
      const spec = BY_NAME.get(name);
      const text = `${spec ? spec.description : name} completed.`;
      return { status: 'ok', message: text, data: { tool: name, args, note: 'synthetic fixture result' }, hints: [] };
    }
  }
}

const MUTATING = new Set(WRITE_TOOLS.map((t) => t[0]));

async function handleMcp(req, res) {
  if (req.method !== 'POST') return json(res, 405, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Method Not Allowed' } });
  // A real backend notices the moment its client hangs up. Without this, a slow tool keeps counting as
  // in-flight after Stop, and the "Stop leaks nothing" assertion would pass or fail on the fixture's
  // sleep length rather than on whether the bridge actually aborted the upstream request.
  let clientGone = false;
  req.on('aborted', () => { clientGone = true; });
  res.on('close', () => { if (!res.writableEnded) clientGone = true; });
  const raw = await readBody(req);
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }
  const batch = Array.isArray(msg);
  const messages = batch ? msg : [msg];
  const replies = [];

  for (const m of messages) {
    const method = m?.method;
    if (method === 'notifications/initialized' || String(method || '').startsWith('notifications/')) {
      res.statusCode = 202;
      res.end();
      return;
    }
    if (method === 'initialize') {
      state.sessions += 1;
      const result = {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'fake-erpnext-mcp', version: '0.0.0-fake' },
        instructions: 'Synthetic MCP backend. Mirrors the response shape of the erpnext-mcp-gateway.',
      };
      replies.push({ jsonrpc: '2.0', id: m.id, result });
      continue;
    }
    if (method === 'ping') {
      replies.push({ jsonrpc: '2.0', id: m.id, result: {} });
      continue;
    }
    if (method === 'tools/list') {
      replies.push({
        jsonrpc: '2.0',
        id: m.id,
        result: { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: inputSchemaFor(t) })) },
      });
      continue;
    }
    if (method === 'tools/call') {
      const name = m.params?.name;
      const args = m.params?.arguments || {};
      state.calls.push({ at: Date.now(), name, args, requestId: args.request_id ?? null });
      let text;
      if (!BY_NAME.has(name)) {
        replies.push({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `Unknown tool: '${name}'` }], isError: true } });
        continue;
      }
      if (BY_NAME.get(name).tier === null) {
        text = errorEnvelope('admin tools are restricted to the default client');
      } else if (name === 'flaky_tool') {
        text = errorEnvelope('Simulated backend failure: the ledger is locked by another operation.');
      } else if (name === 'slow_tool') {
        const ms = Number(args.delay_ms) > 0 ? Math.min(Number(args.delay_ms), TOOL_DELAY_MS) : TOOL_DELAY_MS;
        await delay(ms, { aborted: () => clientGone });
        if (clientGone) return;
        text = okEnvelope({ status: 'ok', message: 'Slow tool finished', data: { tool: name }, hints: [] });
      } else if (MUTATING.has(name) && !args.request_id) {
        text = errorEnvelope(`tool '${name}' rejected: mutating tools require a caller-supplied request_id; automatic ids are forbidden`);
      } else if (name === 'call_tool' && MUTATING.has(String(args.tool || '')) && !args.request_id) {
        text = errorEnvelope("tool 'call_tool' rejected: mutating tools require a caller-supplied request_id; automatic ids are forbidden");
      } else {
        const inner = toolInnerResult(name, args);
        if (inner === null) {
          text = errorEnvelope(`Unknown tool: '${args.tool}'`);
        } else {
          text = okEnvelope(inner);
        }
      }
      replies.push({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text }], isError: false } });
      if (state.sessionLoss) {
        state.sessionId = null;
      }
      continue;
    }
    replies.push({ jsonrpc: '2.0', id: m?.id ?? null, error: { code: -32601, message: `Method not found: ${method}` } });
  }

  const payload = batch ? replies : replies[0];
  const extraHeaders = state.sessionId ? { 'mcp-session-id': state.sessionId } : {};
  if (state.framing === 'sse') {
    const text = `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', ...extraHeaders });
    return void res.end(text);
  }
  return json(res, 200, payload, extraHeaders);
}

function inputSchemaFor(tool) {
  const properties = {};
  const required = [];
  for (const p of tool.params) {
    if (p === 'doctype' || p === 'name' || p === 'field' || p === 'fieldname' || p === 'flow' || p === 'backup' || p === 'site' || p === 'command' || p === 'code' || p === 'item' || p === 'warehouse' || p === 'customer' || p === 'supplier' || p === 'employee' || p === 'company' || p === 'tool' || p === 'role' || p === 'bucket' || p === 'version') {
      properties[p] = { type: 'string' };
      required.push(p);
    } else if (p === 'limit') {
      properties[p] = { type: 'integer', minimum: 1, maximum: 500 };
    } else if (p === 'delay_ms') {
      properties[p] = { type: 'integer' };
    } else {
      properties[p] = {};
    }
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}

function handleControl(url, res) {
  const route = url.pathname.replace('/__control', '');
  if (route === '/requests') return json(res, 200, { requests: state.requests, count: state.requests.length });
  if (route === '/calls') return json(res, 200, { calls: state.calls, count: state.calls.length });
  if (route === '/connections') return json(res, 200, { inFlight: state.inFlight, sessions: state.sessions });
  if (route === '/tools') return json(res, 200, { tools: TOOLS.map((t) => ({ name: t.name, tier: t.tier })), tiers: TIERS, readCount: READ_COUNT, total: TOOLS.length });
  if (route === '/reset') return resetState(res);
  return json(res, 404, { error: 'unknown control route' });
}

async function handleControlPost(url, req, res) {
  const route = url.pathname.replace('/__control', '');
  const raw = await readBody(req).catch(() => '');
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return json(res, 400, { error: 'invalid JSON body' });
  }
  if (route === '/scenario') {
    if (body.scenario && !SCENARIOS.has(body.scenario)) return json(res, 400, { error: `unknown scenario: ${body.scenario}`, scenarios: [...SCENARIOS] });
    state.scenario = body.scenario || 'auto';
    if (Number.isInteger(body.httpStatus)) state.httpStatus = body.httpStatus;
    if (Number.isInteger(body.failures)) state.httpFailuresRemaining = body.failures;
    return json(res, 200, { ok: true, scenario: state.scenario, httpStatus: state.httpStatus, failures: state.httpFailuresRemaining });
  }
  if (route === '/framing') {
    if (body.framing) state.framing = body.framing === 'sse' ? 'sse' : 'json';
    if (typeof body.sessionId === 'string') state.sessionId = body.sessionId;
    if (typeof body.sessionLoss === 'boolean') state.sessionLoss = body.sessionLoss;
    return json(res, 200, { ok: true, framing: state.framing, sessionId: state.sessionId, sessionLoss: state.sessionLoss });
  }
  if (route === '/reset') return resetState(res);
  return json(res, 404, { error: 'unknown control route' });
}

function resetState(res) {
  state.requests = [];
  state.calls = [];
  state.scenario = 'auto';
  state.framing = 'json';
  state.sessionId = null;
  state.sessionLoss = false;
  state.httpStatus = 429;
  state.httpFailuresRemaining = 0;
  state.sessions = 0;
  state.lastLlmTools = new Set();
  return json(res, 200, { ok: true });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  const counted = !url.pathname.startsWith('/__control');
  if (counted) state.inFlight += 1;
  let settled = false;
  const settle = () => {
    if (settled || !counted) return;
    settled = true;
    state.inFlight -= 1;
  };
  res.on('close', settle);
  res.on('finish', settle);

  const run = async () => {
    const path = url.pathname;
    if (path.startsWith('/__control')) {
      if (req.method === 'POST') return handleControlPost(url, req, res);
      return handleControl(url, res);
    }
    if (path === '/v1/models' && req.method === 'GET') {
      return json(res, 200, {
        object: 'list',
        data: [
          { id: MODEL_ID, object: 'model', owned_by: 'fake' },
          { id: 'fake-chat-mini', object: 'model', owned_by: 'fake' },
          { id: EMBED_MODEL_ID, object: 'model', owned_by: 'fake' },
        ],
      });
    }
    if (path === '/api/tags' && req.method === 'GET') {
      return json(res, 200, {
        models: [
          { name: `${OLLAMA_CHAT_MODEL}:latest`, model: `${OLLAMA_CHAT_MODEL}:latest`, size: 1234567, details: { family: 'llama', parameter_size: '3B' } },
          { name: `${OLLAMA_EMBED_MODEL}:latest`, model: `${OLLAMA_EMBED_MODEL}:latest`, size: 234567, details: { family: 'nomic-bert', embedding_length: 768 } },
        ],
      });
    }
    if (path === '/v1/chat/completions' && req.method === 'POST') return handleOpenAiChat(req, res, url);
    if (path === '/api/chat' && req.method === 'POST') return handleOllamaChat(req, res, url);
    if (path === '/mcp') return handleMcp(req, res);
    return json(res, 404, { error: `no fake route for ${req.method} ${path}` });
  };

  run().catch((err) => {
    if (res.headersSent) return void res.destroy();
    json(res, 500, { error: String(err?.message || err) });
  });
});

server.keepAliveTimeout = 1000;
server.on('listening', () => {
  process.stdout.write(`fake-upstream listening on http://${HOST}:${PORT} readTools=${READ_COUNT} total=${TOOLS.length}\n`);
});
server.listen(PORT, HOST, () => {});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.closeAllConnections?.();
    server.close(() => process.exit(0));
  });
}
