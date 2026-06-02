#!/usr/bin/env node
/**
 * consentgate-mcp — Model Context Protocol server for ConsentGate.
 *
 * Exposes two tools so any MCP-capable agent can gate its own actions behind a
 * human's consent policy:
 *   - check_action      : non-blocking policy check (allow / deny / ask)
 *   - request_approval  : blocks for an explicit human Approve/Deny via Telegram
 *
 * Both fail closed: anything other than an explicit `allow` means "do not proceed".
 *
 * Config (env):
 *   CONSENTGATE_API_KEY   (required)  a cg_… key from /dashboard/keys
 *   CONSENTGATE_BASE_URL  (optional)  defaults to https://consentgate.fyi
 *
 * NOTE: stdout is the MCP protocol channel — never write logs there. Use stderr.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const BASE_URL = (process.env.CONSENTGATE_BASE_URL || 'https://consentgate.fyi').replace(/\/+$/, '')
const API_KEY = process.env.CONSENTGATE_API_KEY || ''

const CATEGORY_HINT =
  'Built-in categories: email, social_post, message, file_write, file_delete, ' +
  'api_call, spending, calendar, system, custom. Any short label (<=50 chars) is accepted.'

interface CheckResult {
  ok: boolean
  httpStatus: number
  decision?: 'allow' | 'deny' | 'ask'
  allowed?: boolean
  reason?: string
  resolved_by?: string
  request_id?: string
  upgrade_required?: boolean
  telegram_linked?: boolean
  rule_id?: string
  error?: string
  code?: string
}

/** Call POST /api/v1/check-action. Never throws — network/HTTP errors fail closed. */
async function callCheckAction(payload: Record<string, unknown>): Promise<CheckResult> {
  if (!API_KEY) {
    return {
      ok: false, httpStatus: 0, code: 'NO_API_KEY',
      error: 'CONSENTGATE_API_KEY is not set. Create a key at https://consentgate.fyi/dashboard/keys and set it in the MCP server env.',
    }
  }
  try {
    const res = await fetch(`${BASE_URL}/api/v1/check-action`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(130_000), // > max wait (120s) + headroom
    })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      return {
        ok: false, httpStatus: res.status,
        error: (json.error as string) || `HTTP ${res.status}`,
        code: json.code as string | undefined,
      }
    }
    return {
      ok: true, httpStatus: res.status,
      decision: json.decision as CheckResult['decision'],
      allowed: json.allowed as boolean | undefined,
      reason: json.reason as string | undefined,
      resolved_by: json.resolved_by as string | undefined,
      request_id: json.request_id as string | undefined,
      upgrade_required: json.upgrade_required as boolean | undefined,
      telegram_linked: json.telegram_linked as boolean | undefined,
      rule_id: json.rule_id as string | undefined,
    }
  } catch (err) {
    return {
      ok: false, httpStatus: 0, code: 'NETWORK_ERROR',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/** Render a CheckResult into an MCP tool result with an unambiguous, fail-closed verdict. */
function renderResult(r: CheckResult) {
  if (!r.ok) {
    return {
      isError: true,
      content: [{
        type: 'text' as const,
        text:
          `⚠️ ConsentGate check FAILED (${r.code || r.httpStatus}): ${r.error}\n` +
          `FAIL CLOSED: treat this as NOT allowed — do not perform the action.`,
      }],
    }
  }
  const verdict =
    r.decision === 'allow' ? '✅ ALLOW — you may perform this action.'
    : r.decision === 'deny' ? '⛔ DENY — do NOT perform this action.'
    : '❔ ASK — no rule matched. This is NOT approval. Do not proceed without an explicit human decision (call request_approval, or ask the user).'

  const summary = [
    `DECISION: ${r.decision}`,
    verdict,
    r.reason ? `Reason: ${r.reason}` : '',
    r.resolved_by ? `Resolved by: ${r.resolved_by}` : '',
    r.request_id ? `Request ID: ${r.request_id}` : '',
    r.upgrade_required ? 'Note: interactive approvals require the owner to be on the Pro plan (upgrade_required=true).' : '',
    r.telegram_linked === false ? 'Note: the owner has not linked Telegram, so no human prompt could be sent.' : '',
  ].filter(Boolean).join('\n')

  // A machine-readable line follows the human summary so the agent can parse the verdict.
  const machine = JSON.stringify({
    decision: r.decision, allowed: r.allowed, reason: r.reason,
    resolved_by: r.resolved_by, request_id: r.request_id,
    upgrade_required: r.upgrade_required, telegram_linked: r.telegram_linked,
  })

  return { content: [{ type: 'text' as const, text: `${summary}\n\n${machine}` }] }
}

const server = new McpServer({ name: 'consentgate', version: '0.1.0' })

server.registerTool(
  'check_action',
  {
    title: 'Check an action against the consent policy',
    description:
      'Check whether an action is permitted by the ConsentGate owner\'s consent policy BEFORE you perform it. ' +
      'Call this for any potentially sensitive, irreversible, or high-impact action — e.g. sending email or messages, ' +
      'posting publicly, spending money, deleting or overwriting files, calling external/destructive APIs, or changing system state. ' +
      'Returns a decision: "allow" (you may proceed), "deny" (do NOT proceed), or "ask" (no rule matched — not approval; ' +
      'use request_approval to get a human decision, or ask the user). This call does not block. ' +
      'FAIL CLOSED: if the result is anything other than "allow", do not perform the action.',
    inputSchema: {
      action: z.string().min(1).max(255).describe('The specific action you intend to take, e.g. "send_email", "delete_file", "transfer_funds".'),
      category: z.string().min(1).max(50).describe(`Action category. ${CATEGORY_HINT}`),
      metadata: z.record(z.unknown()).optional().describe('Structured details of the action (e.g. recipient, amount, path, url). Used by the owner\'s rules and shown in any approval prompt. Max 10KB.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ action, category, metadata }) => callCheckAction({ action, category, metadata: metadata ?? {} }).then(renderResult),
)

server.registerTool(
  'request_approval',
  {
    title: 'Request explicit human approval (blocks)',
    description:
      'Request a human\'s explicit approval for an action and BLOCK until they decide or the timeout elapses. ' +
      'Use for high-stakes actions, or whenever check_action returned "ask". The owner gets an Approve/Deny prompt on Telegram. ' +
      'Returns "allow" ONLY if a human tapped Approve. Returns "deny" on tap-deny, on timeout (fail-closed), or when ' +
      'interactive approvals are unavailable (owner not on Pro, or Telegram not linked — see upgrade_required / telegram_linked). ' +
      'NEVER treat a non-"allow" result as permission.',
    inputSchema: {
      action: z.string().min(1).max(255).describe('The specific action requiring approval, e.g. "send_email", "transfer_funds".'),
      category: z.string().min(1).max(50).describe(`Action category. ${CATEGORY_HINT}`),
      metadata: z.record(z.unknown()).optional().describe('Structured details shown to the human in the approval prompt (e.g. recipient, amount, summary). Max 10KB.'),
      wait_seconds: z.number().int().min(1).max(120).default(60).describe('How long to block waiting for the human\'s tap (1-120s). On timeout the result fails closed to "deny".'),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  },
  async ({ action, category, metadata, wait_seconds }) =>
    callCheckAction({ action, category, metadata: metadata ?? {}, wait: wait_seconds }).then(renderResult),
)

const transport = new StdioServerTransport()
await server.connect(transport)
console.error(`[consentgate-mcp] ready — base=${BASE_URL} apiKey=${API_KEY ? 'set' : 'MISSING'}`)
