export function config(env: NodeJS.ProcessEnv) {
  const required = (key: string, pattern: RegExp) => {
    const value = env[key]?.trim() ?? '';
    if (!pattern.test(value)) throw new Error(`Set a valid ${key} privately in .env`);
    return value;
  };
  const number = (key: string, fallback: number, min: number, max: number) => {
    const value = env[key] === undefined ? fallback : Number(env[key]);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${key}: expected integer ${min}..${max}`);
    return value;
  };
  const proactive = env.PROACTIVE_ENABLED ?? 'false';
  if (!['true', 'false'].includes(proactive)) throw new Error('PROACTIVE_ENABLED must be true or false');
  const channels = (env.ALLOWED_CHANNELS ?? '').split(',').map(x => x.trim());
  if (channels.some(x => !/^C[A-Z0-9]{8,}$/.test(x))) throw new Error('ALLOWED_CHANNELS must contain public channel IDs');
  const model = env.OPENAI_MODEL?.trim() ?? 'gpt-5.6-luna';
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(model)) throw new Error('Invalid OPENAI_MODEL');
  return {
    apiKey: required('OPENAI_API_KEY', /^sk-\S{8,}$/), botToken: required('SLACK_BOT_TOKEN', /^xoxb-\S{8,}$/),
    appToken: required('SLACK_APP_TOKEN', /^xapp-\S{8,}$/), channels: new Set(channels), model,
    proactive: proactive === 'true', cooldown: number('PROACTIVE_COOLDOWN_MINUTES', 30, 1, 1440) * 60000,
    proactiveCap: number('MAX_PROACTIVE_PER_CHANNEL_PER_DAY', 4, 1, 100),
    dailyCap: number('MAX_DAILY_MODEL_CALLS', 100, 1, 10000), concurrency: number('MAX_CONCURRENT_REQUESTS', 2, 1, 10),
    timeout: number('MODEL_TIMEOUT_MS', 30000, 1000, 120000)
  };
}
export type Config = ReturnType<typeof config>;
