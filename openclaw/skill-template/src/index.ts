/**
 * Example Skill Module
 *
 * Copy this template and customize it to create your own skill.
 * See docs/SKILLS.md for the full guide.
 *
 * When @xpr-agents/openclaw is installed as a peer dependency, you can use:
 *   import type { SkillApi } from '@xpr-agents/openclaw';
 */

interface SkillApi {
  registerTool(tool: {
    name: string;
    description: string;
    parameters: { type: 'object'; required?: string[]; properties: Record<string, unknown> };
    handler: (params: any) => Promise<unknown>;
  }): void;
  getConfig(): Record<string, unknown>;
}

export default function exampleSkill(api: SkillApi): void {
  api.registerTool({
    name: 'example_tool',
    description: 'An example tool that echoes a message. Replace this with your own tool.',
    parameters: {
      type: 'object',
      required: ['message'],
      properties: {
        message: { type: 'string', description: 'The message to echo' },
      },
    },
    handler: async ({ message }: { message: string }) => {
      return {
        echo: message,
        timestamp: new Date().toISOString(),
        skill: 'example-skill',
      };
    },
  });
}
