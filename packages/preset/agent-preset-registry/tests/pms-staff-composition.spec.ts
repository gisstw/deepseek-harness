import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as PmsTool from '../../../integration/tool-pms-assistant/src/index.ts'
import { expect, it } from 'vitest'

it('PMS staff composition materializes the owned record-only capability schema', async () => {
  const context = new Context()
  try {
    await context.plugin(SystemPrompt)
    await context.plugin(ToolRuntime)
    await context.plugin(PmsTool, { baseUrl: 'http://127.0.0.1', secret: 'test-only-key', timeoutMs: 5000 })
    const schemas = context.tools.schemas()
    expect(schemas.map(schema => schema.name)).toEqual(['pms_capability'])
    expect(schemas[0]?.parameters).toMatchSnapshot()
  } finally {
    await context.fiber.dispose()
  }
})
