import { COMMAND_CATEGORIES } from './command-catalog';

const commands = new Map(COMMAND_CATEGORIES.flatMap(category => category.commands.map(command => [command.code, command] as const)));

export function commandInstructions(prompt: string): string {
  const selected = [...new Set(prompt.split(/\s+/).filter(token => /^\/[A-Z0-9]+$/.test(token)).map(token => token.slice(1)))];
  const directions = selected.flatMap(code => {
    const command = commands.get(code);
    return command ? [`/${code}: ${command.label} (${command.use})`] : [];
  });
  return directions.length ? `${prompt}\n연출 지시: ${directions.join('; ')}` : prompt;
}
