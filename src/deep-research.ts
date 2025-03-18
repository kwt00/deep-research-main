import FirecrawlApp, { SearchResponse } from '@mendable/firecrawl-js';
import { generateObject } from 'ai';
import { compact } from 'lodash-es';
import pLimit from 'p-limit';
import { z } from 'zod';

import { getModel, trimPrompt } from './ai/providers';
import { systemPrompt } from './prompt';

function log(...args: any[]) {
  console.log(...args);
}

export type ResearchProgress = {
  currentDepth: number;
  totalDepth: number;
  currentBreadth: number;
  totalBreadth: number;
  currentQuery?: string;
  totalQueries: number;
  completedQueries: number;
  stage?: string;
  percentage?: number;
  message?: string;
  url?: string;
  title?: string;
};

type ResearchResult = {
  learnings: string[];
  visitedUrls: string[];
  answer?: string;
  errors?: string[];
};

// increase this if you have higher API rate limits
const ConcurrencyLimit = 2;

// Initialize Firecrawl with optional API key and optional base url
const firecrawl = new FirecrawlApp({
  apiKey: process.env.FIRECRAWL_KEY ?? '',
  apiUrl: process.env.FIRECRAWL_BASE_URL,
});

// Log environment configuration to help with debugging
console.log('Environment configuration:');
console.log('- CONTEXT_SIZE:', process.env.CONTEXT_SIZE || 'Not set');
console.log('- FIRECRAWL_KEY exists:', !!process.env.FIRECRAWL_KEY);
console.log('- CUSTOM_MODEL:', process.env.CUSTOM_MODEL || 'Not set');

// take en user query, return a list of SERP queries
async function generateSerpQueries({
  query,
  numQueries = 3,
  learnings,
  onProgress,
}: {
  query: string;
  numQueries?: number;
  learnings?: string[];
  onProgress?: (progress: ResearchProgress) => void;
}) {
  // Report starting to generate queries
  onProgress?.({
    currentDepth: 0,
    totalDepth: 0,
    currentBreadth: 0,
    totalBreadth: numQueries,
    totalQueries: 0,
    completedQueries: 0,
    stage: 'generating_queries',
    message: `Generating search queries for "${query}"`,
    percentage: 10
  });
  
  const res = await generateObject({
    model: getModel(),
    system: systemPrompt(),
    prompt: `Given the following prompt from the user, generate a list of SERP queries to research the topic. Return a maximum of ${numQueries} queries, but feel free to return less if the original prompt is clear. Make sure each query is unique and not similar to each other: <prompt>${query}</prompt>\n\n${
      learnings
        ? `Here are some learnings from previous research, use them to generate more specific queries: ${learnings.join(
            '\n',
          )}`
        : ''
    }`,
    schema: z.object({
      queries: z
        .array(
          z.object({
            query: z.string().describe('The SERP query'),
            researchGoal: z
              .string()
              .describe(
                'First talk about the goal of the research that this query is meant to accomplish, then go deeper into how to advance the research once the results are found, mention additional research directions. Be as specific as possible, especially for additional research directions.',
              ),
          }),
        )
        .describe(`List of SERP queries, max of ${numQueries}`),
    }),
  });
  
  // Report queries generated
  const generatedQueries = res.object.queries.slice(0, numQueries);
  onProgress?.({
    currentDepth: 0,
    totalDepth: 0,
    currentBreadth: 0,
    totalBreadth: generatedQueries.length,
    totalQueries: generatedQueries.length,
    completedQueries: 0,
    stage: 'queries_generated',
    message: `Generated ${generatedQueries.length} search queries`,
    percentage: 15
  });
  
  log(`Created ${generatedQueries.length} queries`, generatedQueries);
  return generatedQueries;
}

async function processSerpResult({
  query,
  result,
  numLearnings = 3,
  numFollowUpQuestions = 3,
  onProgress,
}: {
  query: string;
  result: SearchResponse;
  numLearnings?: number;
  numFollowUpQuestions?: number;
  onProgress?: (progress: ResearchProgress) => void;
}) {
  // Report that we're analyzing search results
  onProgress?.({
    currentDepth: 0,
    totalDepth: 0,
    currentBreadth: 0,
    totalBreadth: 0,
    totalQueries: 0,
    completedQueries: 0,
    stage: 'analyzing',
    message: `Analyzing search results for query: "${query}"`,
    percentage: 60
  });
  
  const contents = compact(result.data.map(item => item.markdown)).map(
    content => trimPrompt(content, 25_000),
  );
  log(`Ran ${query}, found ${contents.length} contents`);

  // Add sources to progress
  if (result.data && result.data.length > 0) {
    for (const item of result.data) {
      if (item.url) {
        onProgress?.({
          currentDepth: 0,
          totalDepth: 0,
          currentBreadth: 0,
          totalBreadth: 0,
          totalQueries: 0,
          completedQueries: 0,
          stage: 'visiting',
          message: `Found source: ${item.url}`,
          url: item.url,
          title: item.title || item.url,
          percentage: 65
        });
      }
    }
  }

  const res = await generateObject({
    model: getModel(),
    abortSignal: AbortSignal.timeout(60_000),
    system: systemPrompt(),
    prompt: trimPrompt(
      `Given the following contents from a SERP search for the query <query>${query}</query>, generate a list of learnings from the contents. Return a maximum of ${numLearnings} learnings, but feel free to return less if the contents are clear. Make sure each learning is unique and not similar to each other. The learnings should be concise and to the point, as detailed and information dense as possible. Make sure to include any entities like people, places, companies, products, things, etc in the learnings, as well as any exact metrics, numbers, or dates. The learnings will be used to research the topic further.\n\n<contents>${contents
        .map(content => `<content>\n${content}\n</content>`)
        .join('\n')}</contents>`,
    ),
    schema: z.object({
      learnings: z
        .array(z.string())
        .describe(`List of learnings, max of ${numLearnings}`),
      followUpQuestions: z
        .array(z.string())
        .describe(
          `List of follow-up questions to research the topic further, max of ${numFollowUpQuestions}`,
        ),
    }),
  });
  
  // Report learning analysis complete
  onProgress?.({
    currentDepth: 0,
    totalDepth: 0,
    currentBreadth: 0,
    totalBreadth: 0,
    totalQueries: 0,
    completedQueries: 0,
    stage: 'summarizing',
    message: `Extracted ${res.object.learnings.length} key learnings from search results`,
    percentage: 75
  });
  
  log(`Created ${res.object.learnings.length} learnings`, res.object.learnings);

  return res.object;
}

export async function writeFinalReport({
  prompt,
  learnings,
  visitedUrls,
}: {
  prompt: string;
  learnings: string[];
  visitedUrls: string[];
}) {
  const learningsString = learnings
    .map(learning => `<learning>\n${learning}\n</learning>`)
    .join('\n');

  const res = await generateObject({
    model: getModel(),
    system: systemPrompt(),
    prompt: trimPrompt(
      `Given the following prompt from the user, write a final report on the topic using the learnings from research. Make it as as detailed as possible, aim for 3 or more pages, include ALL the learnings from research:\n\n<prompt>${prompt}</prompt>\n\nHere are all the learnings from previous research:\n\n<learnings>\n${learningsString}\n</learnings>`,
    ),
    schema: z.object({
      reportMarkdown: z
        .string()
        .describe('Final report on the topic in Markdown'),
    }),
  });

  // Append the visited URLs section to the report
  const urlsSection = `\n\n## Sources\n\n${visitedUrls.map(url => `- ${url}`).join('\n')}`;
  return res.object.reportMarkdown + urlsSection;
}

export async function writeFinalAnswer({
  prompt,
  learnings,
}: {
  prompt: string;
  learnings: string[];
}) {
  const learningsString = learnings
    .map(learning => `<learning>\n${learning}\n</learning>`)
    .join('\n');

  const res = await generateObject({
    model: getModel(),
    system: systemPrompt(),
    prompt: trimPrompt(
      `Given the following prompt from the user, write a final answer on the topic using the learnings from research. Follow the format specified in the prompt. Do not yap or babble or include any other text than the answer besides the format specified in the prompt. Keep the answer as concise as possible - usually it should be just a few words or maximum a sentence. Try to follow the format specified in the prompt (for example, if the prompt is using Latex, the answer should be in Latex. If the prompt gives multiple answer choices, the answer should be one of the choices).\n\n<prompt>${prompt}</prompt>\n\nHere are all the learnings from research on the topic that you can use to help answer the prompt:\n\n<learnings>\n${learningsString}\n</learnings>`,
    ),
    schema: z.object({
      exactAnswer: z
        .string()
        .describe(
          'The final answer, make it short and concise, just the answer, no other text',
        ),
    }),
  });

  return res.object.exactAnswer;
}

export async function deepResearch({
  query,
  depth = 2,
  breadth = 3,
  onProgress,
}: {
  query: string;
  depth?: number;
  breadth?: number;
  onProgress?: (progress: ResearchProgress) => void;
}): Promise<ResearchResult> {
  if (!process.env.FIRECRAWL_KEY) {
    throw new Error(
      'FIRECRAWL_KEY environment variable is required. Get one at https://firecrawl.dev',
    );
  }

  log('Starting research:', { query, depth, breadth });

  // Create progress object
  const progress: ResearchProgress = {
    currentDepth: depth,
    totalDepth: depth,
    currentBreadth: breadth,
    totalBreadth: breadth,
    totalQueries: 0,
    completedQueries: 0,
    stage: 'starting',
    message: 'Initializing research process',
    percentage: 5
  };

  const reportProgress = (update: Partial<ResearchProgress>) => {
    Object.assign(progress, update);
    onProgress?.(progress);
  };

  reportProgress({
    stage: 'starting',
    message: `Starting deep research on: "${query}"`,
    percentage: 5
  });

  const serpQueries = await generateSerpQueries({
    query,
    learnings: [],
    numQueries: breadth,
    onProgress,
  });

  reportProgress({
    totalQueries: serpQueries.length,
    currentQuery: serpQueries[0]?.query,
    stage: 'searching',
    message: `Beginning search with ${serpQueries.length} queries`,
    percentage: 20
  });

  const limit = pLimit(ConcurrencyLimit);
  let completedQueries = 0;

  const results = await Promise.all(
    serpQueries.map(serpQuery =>
      limit(async () => {
        try {
          reportProgress({
            currentQuery: serpQuery.query,
            stage: 'searching',
            message: `Searching web for: "${serpQuery.query}"`,
            percentage: 25 + Math.floor((completedQueries / serpQueries.length) * 35)
          });

          const result = await firecrawl.search(serpQuery.query, {
            timeout: 15000,
            limit: 5,
            scrapeOptions: { formats: ['markdown'] },
          });

          // Collect URLs from this search
          const newUrls = compact(result.data.map(item => item.url));
          const newBreadth = Math.ceil(breadth / 2);
          const newDepth = depth - 1;

          const newLearnings = await processSerpResult({
            query: serpQuery.query,
            result,
            numFollowUpQuestions: newBreadth,
            onProgress,
          });
          
          completedQueries++;
          reportProgress({
            completedQueries,
            stage: 'processing',
            message: `Completed search for "${serpQuery.query}" (${completedQueries}/${serpQueries.length})`,
            percentage: 25 + Math.floor((completedQueries / serpQueries.length) * 35)
          });

          const allLearnings = [...newLearnings.learnings];
          const allUrls = [...newUrls];

          if (newDepth > 0) {
            const nextQueries = newLearnings.followUpQuestions.slice(0, newBreadth);
            reportProgress({
              currentDepth: newDepth,
              stage: 'researching_deeper',
              message: `Researching ${nextQueries.length} follow-up questions at depth ${newDepth}`,
              percentage: 60 + Math.floor((completedQueries / serpQueries.length) * 10)
            });
            
            if (nextQueries.length > 0) {
              const nestedResults = await Promise.all(
                nextQueries.map(nextQuery =>
                  deepResearch({
                    query: nextQuery,
                    depth: newDepth,
                    breadth: newBreadth,
                    onProgress,
                  }),
                ),
              );

              for (const nestedResult of nestedResults) {
                allLearnings.push(...nestedResult.learnings);
                allUrls.push(...nestedResult.visitedUrls);
              }
            }
          }

          return {
            visitedUrls: allUrls,
            learnings: allLearnings,
          };
        } catch (error) {
          console.error('Error in SERP query:', error);
          
          reportProgress({
            stage: 'error',
            message: `Error searching for "${serpQuery.query}": ${error instanceof Error ? error.message : String(error)}`,
            percentage: progress.percentage // Keep the current percentage
          });
          
          return {
            visitedUrls: [],
            learnings: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    ),
  );

  const allVisitedUrls = new Set<string>();
  const allLearnings: string[] = [];
  const errors: string[] = [];

  for (const result of results) {
    if (result.error) {
      errors.push(result.error);
    }
    for (const url of result.visitedUrls) {
      allVisitedUrls.add(url);
    }
    allLearnings.push(...result.learnings);
  }

  const visitedUrls = [...allVisitedUrls];

  reportProgress({
    stage: 'finishing',
    message: `Research complete. Found ${visitedUrls.length} sources and ${allLearnings.length} key insights`,
    percentage: 95
  });

  const res = await generateFinalAnswer({
    query,
    learnings: allLearnings,
    onProgress,
  });

  reportProgress({
    stage: 'completed',
    message: 'Research completed successfully',
    percentage: 100
  });

  return {
    visitedUrls,
    learnings: allLearnings,
    answer: res.answer,
    errors: errors.length > 0 ? errors : undefined,
  };
}

// Generate final answer
async function generateFinalAnswer({
  query,
  learnings,
  onProgress,
}: {
  query: string;
  learnings: string[];
  onProgress?: (progress: ResearchProgress) => void;
}) {
  onProgress?.({
    currentDepth: 0,
    totalDepth: 0,
    currentBreadth: 0,
    totalBreadth: 0,
    totalQueries: 0,
    completedQueries: 0,
    stage: 'summarizing',
    message: `Creating final research summary from ${learnings.length} insights`,
    percentage: 90
  });
  
  const res = await generateObject({
    model: getModel(),
    abortSignal: AbortSignal.timeout(60_000),
    system: systemPrompt(),
    prompt: trimPrompt(
      `You are an expert researcher and academic writer. You've been given a research question and a list of learnings. Your task is to synthesize these learnings into a comprehensive answer to the research question.\n\n<research_question>${query}</research_question>\n\n<learnings>\n${learnings
        .map(learning => `<learning>${learning}</learning>`)
        .join('\n')}\n</learnings>\n\nBased on the learnings above, write a comprehensive answer to the research question. The answer should be well-structured, detailed, and information-dense. Use markdown formatting to organize your answer with headers, bullet points, and emphasis where appropriate. Remember to synthesize the information rather than just listing the learnings.`,
    ),
    schema: z.object({
      answer: z.string().describe('Comprehensive answer to the research question'),
    }),
  });

  return res.object;
}
