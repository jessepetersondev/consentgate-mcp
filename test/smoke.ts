/**
 * Smoke test: spawn the built server over stdio, list tools, and call check_action
 * against the configured ConsentGate instance. Requires CONSENTGATE_API_KEY in env.
 *   CONSENTGATE_API_KEY=cg_… npm run smoke
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/index.js'],
  env: { ...process.env } as Record<string, string>,
})
const client = new Client({ name: 'consentgate-smoke', version: '0.0.0' })
await client.connect(transport)

const { tools } = await client.listTools()
console.log('TOOLS:', tools.map((t) => t.name).join(', '))

const res = await client.callTool({
  name: 'check_action',
  arguments: { action: 'send_email', category: 'email', metadata: { recipient: 'smoke@example.com' } },
})
console.log('\ncheck_action result:')
for (const c of res.content as Array<{ type: string; text?: string }>) {
  if (c.type === 'text') console.log(c.text)
}

await client.close()
process.exit(0)
