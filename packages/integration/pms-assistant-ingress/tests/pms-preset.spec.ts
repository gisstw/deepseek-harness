import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { signingPath } from '../src/index.ts'

const preset = fileURLToPath(new URL('../../../preset/agent-presets/presets/pms-staff-assistant/agent.cordis.yml', import.meta.url))

describe('PMS staff assistant preset fence', () => {
  it('advertises change intake without granting build or shell capabilities', async () => {
    const source = await readFile(fileURLToPath(new URL('../../tool-pms-assistant/src/index.ts', import.meta.url)), 'utf8')
    const enumeration = source.match(/enum:\s*\[([^\]]+)\]/)?.[1]
    expect(enumeration).toBeDefined()
    expect(enumeration).toContain("'change.request.propose'")
    expect(enumeration).not.toMatch(/command.run|code.edit|deploy|change.request.build/)
    expect(await readFile(preset, 'utf8')).toContain('change.request.propose')
  })
  it('signs the same ingress-relative path and query as the Laravel client', () => {
    expect(signingPath('/v1/integrations/pms/conversations/s1/turns/r1/events?after=7'))
      .toBe('/conversations/s1/turns/r1/events?after=7')
  })
  it('keeps turn creation on the collection URL used by the Laravel contract', () => {
    expect(signingPath('/v1/integrations/pms/conversations/s1/turns'))
      .toBe('/conversations/s1/turns')
  })
  it('mounts only the complete persona and the PMS capability tool', async () => {
    const source = await readFile(preset, 'utf8')
    const packages = [...source.matchAll(/^\s*name:\s*'([^']+)'\s*$/gm)].map(match => match[1])
    expect(packages).toEqual(['@deepseek-ai/dsh-persona', '@deepseek-ai/dsh-tool-pms-assistant'])
    expect(source).not.toMatch(/dsh-tool-(?:bash|pwsh|fs|web|mcp|subagent|cordis)/)
    expect(source).toContain('complete: true')
    expect(source).toContain('完整信用卡號')
  })
})
