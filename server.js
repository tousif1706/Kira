import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

const SUPPORTED_LANGUAGES = ['JavaScript', 'Python', 'C++', 'Java'];

function getRank(cc) {
  if (cc <= 5) return 'A';
  if (cc <= 10) return 'B';
  if (cc <= 20) return 'C';
  return 'D';
}

function getRatingLabel(avg) {
  if (avg <= 5) return 'A · Low Risk';
  if (avg <= 10) return 'B · Moderate';
  if (avg <= 20) return 'C · Complex';
  return 'D · High Risk';
}

function countBranches(block, language) {
  const cleaned = block
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, '""')
    .replace(/\/\/.*$/gm, '')
    .replace(/#.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  const patterns =
    language === 'Python'
      ? [/\bif\b/g, /\belif\b/g, /\bfor\b/g, /\bwhile\b/g, /\bexcept\b/g, /\band\b/g, /\bor\b/g]
      : [/\bif\b/g, /\belse\s+if\b/g, /\bfor\b/g, /\bwhile\b/g, /\bcase\b/g, /\bcatch\b/g, /&&/g, /\|\|/g, /\?[^:]+:/g];

  let count = 1;
  for (const regex of patterns) {
    const matches = cleaned.match(regex);
    if (matches) count += matches.length;
  }
  return count;
}

function analyzeComplexity(code, language) {
  const lines = code.split(/\r?\n/);
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  const loc = nonEmptyLines.length;
  const details = [];

  if (language === 'Python') {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/^(\s*)def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
      if (match) {
        const baseIndent = match[1].length;
        const fnName = match[2];
        const fnLines = [line];
        let maxNest = 0;

        for (let j = i + 1; j < lines.length; j++) {
          const next = lines[j];
          if (next.trim() === '') {
            fnLines.push(next);
            continue;
          }
          const indentMatch = next.match(/^(\s*)/);
          const indent = indentMatch ? indentMatch[1].length : 0;
          if (indent <= baseIndent && !next.trim().startsWith('#')) {
            break;
          }
          const relativeDepth = Math.max(0, Math.floor((indent - baseIndent) / 4) - 1);
          if (relativeDepth > maxNest) maxNest = relativeDepth;
          fnLines.push(next);
        }

        const cc = countBranches(fnLines.join('\n'), language);
        details.push({
          name: `${fnName}()`,
          line: i + 1,
          complexity: cc,
          nesting: maxNest,
          rank: getRank(cc),
        });
      }
    }
  } else {
    let fnRegex;
    if (language === 'JavaScript') {
      fnRegex =
        /^\s*(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\([^)]*\)\s*\{|^\s*(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>\s*\{/;
    } else if (language === 'Java') {
      fnRegex =
        /^\s*(?:public|private|protected|static|final|synchronized|\s)*[\w<>[\]]+\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^;]*\)\s*\{/;
    } else {
      fnRegex =
        /^\s*(?:static|inline|virtual|const|unsigned|signed|[\w:<>]+)\s+(?:[\w:*&<>]+\s+)*([a-zA-Z_][a-zA-Z0-9_:]*)\s*\([^;]*\)\s*(?:const)?\s*\{/;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(if|else|for|while|switch|catch)\b/.test(line)) continue;
      const match = line.match(fnRegex);
      if (match) {
        const fnName = match[1] || match[2] || 'anonymous';
        let braceDepth = 0;
        let maxNest = 0;
        const fnLines = [];
        let started = false;

        for (let j = i; j < lines.length; j++) {
          const cur = lines[j];
          fnLines.push(cur);
          for (const ch of cur) {
            if (ch === '{') {
              braceDepth++;
              started = true;
              if (braceDepth - 1 > maxNest) maxNest = braceDepth - 1;
            } else if (ch === '}') {
              braceDepth--;
            }
          }
          if (started && braceDepth <= 0) break;
        }

        const cc = countBranches(fnLines.join('\n'), language);
        details.push({
          name: `${fnName}()`,
          line: i + 1,
          complexity: cc,
          nesting: maxNest,
          rank: getRank(cc),
        });
      }
    }
  }

  if (details.length === 0) {
    const overallCC = countBranches(code, language);
    details.push({
      name: 'Module / Top-Level',
      line: 1,
      complexity: overallCC,
      nesting: 0,
      rank: getRank(overallCC),
    });
  }

  const totalCC = details.reduce((sum, item) => sum + item.complexity, 0);
  const avgCC = Number((totalCC / details.length).toFixed(2));
  const maxCC = Math.max(...details.map((item) => item.complexity));
  const rawMI = 100 - Math.log2(Math.max(loc, 1)) * 7.5 - avgCC * 2.4;
  const mi = Math.max(0, Math.min(100, Math.round(rawMI)));

  return {
    method: language === 'Python' ? 'Python Branch Scan' : `${language} Control-Flow Scan`,
    average_complexity: avgCC,
    max_complexity: maxCC,
    rating: getRatingLabel(avgCC),
    maintainability_index: mi,
    loc,
    details,
  };
}

app.post('/api/review', async (req, res) => {
  try {
    const { code, language } = req.body || {};

    if (!code || !String(code).trim()) {
      return res.status(400).json({ error: 'Please paste some code first.' });
    }

    const targetLanguage = SUPPORTED_LANGUAGES.includes(language) ? language : 'Python';
    const complexity = analyzeComplexity(String(code), targetLanguage);

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        error: 'GEMINI_API_KEY is missing. Please configure it in Settings > Secrets.',
      });
    }

    const numberedCode = String(code)
      .split(/\r?\n/)
      .map((line, index) => `${index + 1}: ${line}`)
      .join('\n');

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Review this ${targetLanguage} code (line numbers included for reference):\n\n${numberedCode}`,
      config: {
        systemInstruction: `You are an expert senior software engineer performing a thorough, constructive code review for ${targetLanguage}.
Analyze the provided code for:
1. Bugs, edge cases, null/bounds safety, off-by-one errors, type issues, or logic errors. Reference exact line numbers from the numbered snippet.
2. Concrete, idiomatic improvements for readability, performance, error handling, and maintainability.
3. Time and space complexity observations in complexity_notes.
4. An honest overall_score from 1 to 10 (where 9-10 is production-ready, 6-8 is decent with minor issues, 1-5 needs significant fixes).
5. improved_code_lines: an array of strings where each string is one individual line of the clean, complete, idiomatic refactored version of the submitted code (preserving leading indentation spaces on each line, with no line numbers). Every statement, docstring, and function signature must be its own separate array element.`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: {
              type: Type.STRING,
              description: 'Concise 1-2 sentence assessment of the code.',
            },
            bugs: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  line: { type: Type.STRING, description: 'Line number or range, e.g. "7" or "4-6".' },
                  severity: {
                    type: Type.STRING,
                    description: 'One of: critical, high, medium, low, info.',
                  },
                  title: { type: Type.STRING, description: 'Short 3-6 word bug title.' },
                  description: { type: Type.STRING, description: 'Why this is a bug or risk.' },
                  fix: { type: Type.STRING, description: 'Concrete fix recommendation.' },
                },
                required: ['line', 'severity', 'title', 'description', 'fix'],
              },
            },
            improvements: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING, description: 'Concise improvement headline.' },
                  category: {
                    type: Type.STRING,
                    description: 'Category such as Readability, Performance, Safety, or Style.',
                  },
                  description: { type: Type.STRING, description: 'Why this change helps.' },
                  suggestion: { type: Type.STRING, description: 'Actionable recommendation or snippet.' },
                },
                required: ['title', 'category', 'description', 'suggestion'],
              },
            },
            complexity_notes: {
              type: Type.STRING,
              description: 'Concise Big-O time/space and control-flow analysis.',
            },
            overall_score: {
              type: Type.NUMBER,
              description: 'Integer or half-step score from 1 to 10.',
            },
            improved_code_lines: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description:
                'The complete refactored code split into an array of individual lines, preserving leading indentation spaces on each line.',
            },
          },
          required: [
            'summary',
            'bugs',
            'improvements',
            'complexity_notes',
            'overall_score',
            'improved_code_lines',
          ],
        },
      },
    });

    const rawText = (response.text ?? '{}').trim();
    const parsed = JSON.parse(rawText);

    const normalizedBugs = Array.isArray(parsed.bugs)
      ? parsed.bugs.map((bug) => {
          const sev = String(bug.severity ?? 'info').toLowerCase();
          const validSev = ['critical', 'high', 'medium', 'low', 'info'].includes(sev) ? sev : 'info';
          return {
            line: String(bug.line ?? 'N/A'),
            severity: validSev,
            title: String(bug.title ?? 'Code issue'),
            description: String(bug.description ?? ''),
            fix: String(bug.fix ?? ''),
          };
        })
      : [];

    const normalizedImprovements = Array.isArray(parsed.improvements)
      ? parsed.improvements.map((item) => ({
          title: String(item.title ?? 'Improvement'),
          category: String(item.category ?? 'Quality'),
          description: String(item.description ?? ''),
          suggestion: String(item.suggestion ?? ''),
        }))
      : [];

    const score = Math.max(0, Math.min(10, Number(parsed.overall_score ?? 7)));

    const improvedCode = Array.isArray(parsed.improved_code_lines) && parsed.improved_code_lines.length > 0
      ? parsed.improved_code_lines.map((line) => String(line)).join('\n')
      : String(parsed.improved_code ?? code);

    return res.json({
      review: {
        summary: String(parsed.summary ?? 'Review completed.'),
        bugs: normalizedBugs,
        improvements: normalizedImprovements,
        complexity_notes: String(parsed.complexity_notes ?? ''),
        overall_score: score,
        improved_code: improvedCode,
      },
      complexity,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error while reviewing code.';
    console.error('Code review error:', err);

    if (
      message.includes('API_KEY_INVALID') ||
      message.includes('PERMISSION_DENIED') ||
      message.includes('403')
    ) {
      return res.status(403).json({
        error: 'The configured GEMINI_API_KEY was rejected. Please verify it in Settings > Secrets.',
      });
    }
    if (message.includes('RESOURCE_EXHAUSTED') || message.includes('429')) {
      return res.status(429).json({
        error: 'Rate limit reached for the Gemini API key. Please wait a moment and try again.',
      });
    }

    return res.status(500).json({
      error: message || 'Something went wrong during review.',
    });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`AI Code Reviewer server running on http://localhost:${PORT}`);
});
