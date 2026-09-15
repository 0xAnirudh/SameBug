import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { AppError } from '../lib/AppError.js';
import { basename } from '../fingerprint/hash.js';

/**
 * Asks Claude what is likely wrong and how to fix it.
 *
 * Two properties of this project make the integration cheap and safe, and both
 * fall out of the fingerprinting rather than being bolted on:
 *
 * 1. COST. A diagnosis is keyed to a fingerprint, not to a paste. Six
 *    occurrences of one bug cost one API call, ever — the result is stored on
 *    the fingerprint document and served from there forever after. Grouping is
 *    what turns an O(occurrences) bill into an O(distinct bugs) bill.
 *
 * 2. PRIVACY. What gets sent is the normalized signature, not the paste:
 *    the error type, the message with every literal already replaced by
 *    <str>/<num>/<path>/<ip>/<email>/<uuid>, and frames reduced to
 *    basename:function. Absolute paths, user ids, hostnames and tokens were
 *    stripped by normalize.js before this module ever sees them.
 */

const MODEL = 'claude-opus-5';

const SYSTEM = `You are a senior engineer triaging a production error report.

You are given an error SIGNATURE, not raw source. Literals have already been
replaced with placeholders — <str> was a quoted string, <num> a number, <path>
a file path, <ip> a host, <uuid> an id. Do not ask for them back and do not
speculate about their values.

Reply with a single JSON object and nothing else. No prose before or after, no
markdown fences. Shape:

{
  "summary": "one sentence: what is going wrong",
  "likelyCauses": [
    { "cause": "short label", "detail": "why this trace points at it", "likelihood": "high" | "medium" | "low" }
  ],
  "suggestedFix": "what to change, concretely. Include a short code sketch only if it genuinely helps.",
  "whatToCheck": ["a specific thing to look at or run, in order"],
  "confidence": "high" | "medium" | "low"
}

Rules:
- At most 3 likelyCauses, ordered most likely first.
- At most 4 whatToCheck entries.
- Set confidence to "low" when the signature is thin, and say so in summary
  rather than inventing detail. A hedged, honest answer is more useful than a
  confident wrong one.
- Never claim to know the contents of a stripped literal.`;

export function isDiagnosisAvailable() {
  return Boolean(env.ANTHROPIC_API_KEY);
}

let client = null;
function getClient() {
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

/**
 * Builds the prompt from the signature only. This function is the privacy
 * boundary: anything not assembled here never leaves the server.
 */
export function buildPrompt(group, variance) {
  const frames = (variance?.shared ?? [])
    .map((f, i) => `  ${i + 1}. ${f.function} (${basename(f.file)})`)
    .join('\n');

  const differs = (variance?.varying ?? [])
    .map((v) => `  - ${v.field}${v.frame ? ` in ${v.frame}` : ''}: ${v.distinct} distinct values`)
    .join('\n');

  return [
    `Runtime: ${group.runtime}`,
    `Error type: ${group.errorType}`,
    `Normalized message: ${group.normalizedMessage}`,
    '',
    frames ? `Application frames, innermost first:\n${frames}` : 'No application frames — this error was raised entirely inside library code.',
    '',
    `Seen ${group.count} time${group.count === 1 ? '' : 's'}.`,
    differs ? `Across those occurrences these fields differ:\n${differs}` : '',
    group.allFramesAreVendor
      ? 'Note: every frame is library code, so the application frame that triggered this is not in the trace.'
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Tolerates a fenced or prose-wrapped reply without trusting that it is JSON. */
function parseReply(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no JSON object in reply');

  const parsed = JSON.parse(candidate.slice(start, end + 1));

  return {
    summary: String(parsed.summary ?? '').trim(),
    likelyCauses: (Array.isArray(parsed.likelyCauses) ? parsed.likelyCauses : [])
      .slice(0, 3)
      .map((c) => ({
        cause: String(c.cause ?? '').trim(),
        detail: String(c.detail ?? '').trim(),
        likelihood: ['high', 'medium', 'low'].includes(c.likelihood) ? c.likelihood : 'medium',
      }))
      .filter((c) => c.cause),
    suggestedFix: String(parsed.suggestedFix ?? '').trim(),
    whatToCheck: (Array.isArray(parsed.whatToCheck) ? parsed.whatToCheck : [])
      .slice(0, 4)
      .map((s) => String(s).trim())
      .filter(Boolean),
    confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'low',
  };
}

/**
 * @param {object} group      the Fingerprint document
 * @param {object} variance   output of analyzeVariance
 * @returns {Promise<object>} the diagnosis, ready to store
 */
export async function generateDiagnosis(group, variance) {
  if (!isDiagnosisAvailable()) {
    throw new AppError(
      503,
      'DIAGNOSIS_UNAVAILABLE',
      'Diagnosis is not configured on this server'
    );
  }

  const prompt = buildPrompt(group, variance);
  const startedAt = Date.now();

  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    });

    // Safety classifiers can decline; stop_reason must be checked before
    // reading content, which would otherwise be empty.
    if (response.stop_reason === 'refusal') {
      throw new AppError(
        422,
        'DIAGNOSIS_DECLINED',
        'The model declined to analyse this error signature'
      );
    }

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    const diagnosis = parseReply(text);

    logger.info(
      {
        fingerprint: group._id,
        ms: Date.now() - startedAt,
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
      },
      'diagnosis generated'
    );

    return {
      ...diagnosis,
      model: response.model ?? MODEL,
      generatedAt: new Date(),
      // Lets a stale diagnosis be detected after the group's signature moves.
      signature: `${group.errorType}|${group.normalizedMessage}|${group.topFrame}`,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;

    if (err instanceof Anthropic.AuthenticationError) {
      throw new AppError(503, 'DIAGNOSIS_UNAVAILABLE', 'The configured API key was rejected');
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new AppError(429, 'DIAGNOSIS_RATE_LIMITED', 'Diagnosis is busy. Try again shortly.');
    }
    if (err instanceof Anthropic.APIError) {
      logger.error({ err, status: err.status }, 'diagnosis api error');
      throw new AppError(502, 'DIAGNOSIS_FAILED', 'Could not reach the diagnosis service');
    }

    logger.error({ err }, 'diagnosis failed');
    throw new AppError(502, 'DIAGNOSIS_FAILED', 'Could not produce a diagnosis for this error');
  }
}
