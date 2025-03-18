import { createFireworks } from '@ai-sdk/fireworks';
import { createOpenAI } from '@ai-sdk/openai';
import {
  extractReasoningMiddleware,
  LanguageModelV1,
  wrapLanguageModel,
} from 'ai';
import { getEncoding } from 'js-tiktoken';

import { RecursiveCharacterTextSplitter } from './text-splitter';

// Debug function to help identify issues
function debug(...args: any[]) {
  console.log('[DEBUG]', ...args);
}

// Log environment variables (without exposing full API keys)
debug('Environment variables check:');
debug('OPENAI_KEY exists:', !!process.env.OPENAI_KEY);
debug('OPENAI_ENDPOINT:', process.env.OPENAI_ENDPOINT);
debug('CUSTOM_MODEL:', process.env.CUSTOM_MODEL);
debug('FIREWORKS_KEY exists:', !!process.env.FIREWORKS_KEY);
debug('FIRECRAWL_KEY exists:', !!process.env.FIRECRAWL_KEY);
debug('CONTEXT_SIZE:', process.env.CONTEXT_SIZE);

// Providers
let openai: ReturnType<typeof createOpenAI> | undefined;
try {
  if (process.env.OPENAI_KEY) {
    debug('Initializing OpenAI client with custom endpoint:', process.env.OPENAI_ENDPOINT || 'default OpenAI endpoint');
    openai = createOpenAI({
      apiKey: process.env.OPENAI_KEY,
      baseURL: process.env.OPENAI_ENDPOINT || 'https://api.openai.com/v1',
    });
    debug('OpenAI client initialized successfully');
  } else {
    debug('No OPENAI_KEY provided, OpenAI client not initialized');
  }
} catch (error) {
  debug('Error initializing OpenAI client:', error);
}

const fireworks = process.env.FIREWORKS_KEY
  ? createFireworks({
      apiKey: process.env.FIREWORKS_KEY,
    })
  : undefined;

// Initialize custom model
let customModel: LanguageModelV1 | undefined;
try {
  if (process.env.CUSTOM_MODEL && openai) {
    debug('Initializing custom model:', process.env.CUSTOM_MODEL);
    customModel = openai(process.env.CUSTOM_MODEL, {
      structuredOutputs: true,
    }) as LanguageModelV1;
    debug('Custom model initialized successfully');
  } else if (process.env.CUSTOM_MODEL && !openai) {
    debug('CUSTOM_MODEL specified but OpenAI client not initialized');
  }
} catch (error) {
  debug('Error initializing custom model:', error);
}

// Models

const o3MiniModel = openai?.('o3-mini', {
  reasoningEffort: 'medium',
  structuredOutputs: true,
});

const deepSeekR1Model = fireworks
  ? wrapLanguageModel({
      model: fireworks(
        'accounts/fireworks/models/deepseek-r1',
      ) as LanguageModelV1,
      middleware: extractReasoningMiddleware({ tagName: 'think' }),
    })
  : undefined;

export function getModel(): LanguageModelV1 {
  debug('Getting model...');
  debug('Custom model available:', !!customModel);
  debug('DeepSeek model available:', !!deepSeekR1Model);
  debug('O3Mini model available:', !!o3MiniModel);
  
  if (customModel) {
    debug('Using custom model:', process.env.CUSTOM_MODEL);
    return customModel;
  }

  const model = deepSeekR1Model ?? o3MiniModel;
  if (!model) {
    if (process.env.CUSTOM_MODEL) {
      throw new Error(`No model found. Custom model "${process.env.CUSTOM_MODEL}" was specified but could not be initialized.`);
    } else {
      throw new Error('No model found. Please provide valid API keys and model configurations.');
    }
  }

  return model as LanguageModelV1;
}

const MinChunkSize = 140;
const encoder = getEncoding('o200k_base');

// trim prompt to maximum context size
export function trimPrompt(
  prompt: string,
  contextSize = Number(process.env.CONTEXT_SIZE) || 128_000,
) {
  if (!prompt) {
    return '';
  }

  const length = encoder.encode(prompt).length;
  if (length <= contextSize) {
    return prompt;
  }

  const overflowTokens = length - contextSize;
  // on average it's 3 characters per token, so multiply by 3 to get a rough estimate of the number of characters
  const chunkSize = prompt.length - overflowTokens * 3;
  if (chunkSize < MinChunkSize) {
    return prompt.slice(0, MinChunkSize);
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap: 0,
  });
  const trimmedPrompt = splitter.splitText(prompt)[0] ?? '';

  // last catch, there's a chance that the trimmed prompt is same length as the original prompt, due to how tokens are split & innerworkings of the splitter, handle this case by just doing a hard cut
  if (trimmedPrompt.length === prompt.length) {
    return trimPrompt(prompt.slice(0, chunkSize), contextSize);
  }

  // recursively trim until the prompt is within the context size
  return trimPrompt(trimmedPrompt, contextSize);
}
