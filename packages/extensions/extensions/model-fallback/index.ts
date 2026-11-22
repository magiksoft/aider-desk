import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_MODEL_FALLBACK_CONFIG,
  parseModelFallbackConfig,
  parseModelSelection,
  shouldTriggerFallback,
} from './policy';

import type {
  AgentStepFinishedEvent,
  Extension,
  ExtensionContext,
} from '@aiderdesk/extensions';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default class ModelFallbackExtension implements Extension {
  static metadata = {
    name: 'Model Fallback',
    version: '1.0.0',
    description: 'Continue the current agent run with a secondary model after quota, rate-limit, subscription, or other configured errors',
    author: 'wladimiiir',
    iconUrl: 'https://raw.githubusercontent.com/magiksoft/aider-desk/refs/heads/main/packages/extensions/extensions/model-fallback/icon.png',
    capabilities: ['models', 'ui'],
  };

  readonly configPath: string;

  constructor(configPath = join(__dirname, 'config.json')) {
    this.configPath = configPath;
  }

  async onLoad(context: ExtensionContext): Promise<void> {
    context.log('Model Fallback extension loaded', 'info');
  }

  getConfigComponent(): string {
    return readFileSync(join(__dirname, 'ConfigComponent.jsx'), 'utf-8');
  }

  async getConfigData(context: ExtensionContext): Promise<unknown> {
    try {
      const data = await readFile(this.configPath, 'utf-8');
      return parseModelFallbackConfig(JSON.parse(data));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        context.log(
          `Could not load Model Fallback configuration; using defaults: ${error instanceof Error ? error.message : String(error)}`,
          'warn',
        );
      }
      return { ...DEFAULT_MODEL_FALLBACK_CONFIG };
    }
  }

  async saveConfigData(configData: unknown): Promise<void> {
    const config = parseModelFallbackConfig(configData);
    await mkdir(dirname(this.configPath), { recursive: true });
    await writeFile(this.configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
  }

  async onAgentStepFinished(
    event: AgentStepFinishedEvent,
    context: ExtensionContext,
  ): Promise<void | Partial<AgentStepFinishedEvent>> {
    if (
      event.error === undefined ||
      event.continue !== undefined ||
      event.modelId !== undefined ||
      event.hasOutput ||
      event.hasToolCalls
    ) {
      return;
    }

    const config = (await this.getConfigData(context)) as ReturnType<typeof parseModelFallbackConfig>;
    if (!config.enabled || !shouldTriggerFallback(event.error, config)) {
      return;
    }

    const fallback = parseModelSelection(config.fallbackModelId);
    if (!fallback || (event.providerId === fallback.providerId && event.model === fallback.modelId)) {
      return;
    }

    const availableProvider = context.getProviders().find((provider) => provider.id === fallback.providerId && !provider.disabled);
    if (!availableProvider) {
      context.log(`Model Fallback provider profile is unavailable: ${fallback.providerId}`, 'warn');
      return;
    }

    context.log(`Quota, rate-limit, or configured trigger error; retrying step with ${config.fallbackModelId} for the rest of this run`, 'info');
    return {
      continue: true,
      modelId: config.fallbackModelId,
    };
  }
}
