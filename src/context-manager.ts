/**
 * ContextManager — cache-first context folding engine.
 * Ported from MiMo-Reasonix `src/context-manager.ts` (MIT).
 *
 * Three-region partition:
 *   ImmutablePrefix — system prompt (never changes → prefix cache 99%+ hit)
 *   ProjectContext  — project memory (occasionally changes)
 *   TurnMessages    — current turn (frequently changes)
 *
 * Fold decision thresholds (ratio = promptTokens / ctxMax):
 *   >80% → force-summary (exit turn)
 *   >78% → aggressive fold (10% tail budget)
 *   >75% → normal fold (20% tail budget)
 *   >90% at turn-start → pre-flight fold
 */

import type { ChatMessage, ToolSpec } from "./types.js";

// ── Fold threshold constants ────────────────────────────────────────────────

/** Auto-fold when a turn's response shows promptTokens above this fraction. */
export const HISTORY_FOLD_THRESHOLD = 0.75;

/** Above this fraction the normal fold's tail budget didn't buy enough headroom — fold harder. */
export const HISTORY_FOLD_AGGRESSIVE_THRESHOLD = 0.78;

/** Above this fraction we exit the turn with a summary instead of folding. */
export const FORCE_SUMMARY_THRESHOLD = 0.8;

/** Turn-start local estimate above this fraction triggers a pre-iter fold. */
export const TURN_START_FOLD_THRESHOLD = 0.9;

/** Tail budget after a normal fold, as a fraction of ctxMax. */
export const HISTORY_FOLD_TAIL_FRACTION = 0.2;

/** Tail budget after an aggressive fold — half the normal one. */
export const HISTORY_FOLD_AGGRESSIVE_TAIL_FRACTION = 0.1;

/** Skip the fold if the head wouldn't shrink the log by at least this fraction. */
export const HISTORY_FOLD_MIN_SAVINGS_FRACTION = 0.3;

/** Hard deadline for semantic fold summaries. */
export const HISTORY_FOLD_SUMMARY_TIMEOUT_MS = 15_000;

/** Prepended to fold summary content so the model knows it's a synthesized recap. */
export const HISTORY_FOLD_MARKER = "[FOLD SUMMARY — synthesized recap of earlier conversation]\n\n";

/** Header preceding preserved skill bodies in a fold's synthesized assistant message. */
export const SKILL_PIN_MEMO_HEADER = "[Active skill memos — preserved verbatim across the fold:]";

/** Matches <skill-pin> wrappers emitted by run_skill. */
const SKILL_PIN_REGEX = /<skill-pin name="([^"]+)">\n[\s\S]*?\n<\/skill-pin>/g;

// ── Types ────────────────────────────────────────────────────────────────────

export type PostUsageDecisionKind = "none" | "fold" | "exit-with-summary";

export interface PostUsageDecision {
  kind: PostUsageDecisionKind;
  promptTokens: number;
  ctxMax: number;
  ratio: number;
  tailBudget?: number;
  aggressive?: boolean;
}

export interface FoldResult {
  folded: boolean;
  beforeMessages: number;
  afterMessages: number;
  summaryChars: number;
}

export interface ContextManagerDeps {
  model: string;
  ctxMax: number;
  /** Returns all session messages (including system). */
  getMessages: () => ChatMessage[];
  /** Returns the current system prompt text. */
  getSystemPrompt: () => string;
  /** Returns the current turn number. */
  getCurrentTurn: () => number;
  /** Abort signal for the current turn. */
  getAbortSignal: () => AbortSignal;
  /** Sends a chat completion (for fold summaries). */
  summarize: (
    messages: ChatMessage[],
    signal: AbortSignal
  ) => Promise<{ content: string; usage?: { promptTokens: number } }>;
  /** Persists rewritten messages to disk. */
  rewriteMessages: (messages: ChatMessage[]) => void;
  /** Fired when log was rewritten — resets read-before-edit tracker. */
  onLogRewrite?: () => void;
  /** Tool specs for fold-summary call (reuses cached prefix). */
  getToolSpecs?: () => readonly ToolSpec[];
  /** Estimate token count for a string. */
  countTokens: (text: string) => number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract pinned constraints — HIGH PRIORITY, User memory, Project memory
 * blocks from the system prompt. These survive folds so critical instructions
 * are never paraphrased away.
 */
export function extractPinnedConstraints(systemPrompt: string): string {
  const pattern = /# (?:HIGH PRIORITY constraints|User memory|Project memory)[\s\S]*?(?=\n# |\n---|$)/g;
  return Array.from(systemPrompt.matchAll(pattern), (m) => m[0]).join("\n\n");
}

function buildFoldSummaryInstruction(pinnedSkillNames: string[]): string {
  const base =
    "Summarize the conversation above as one self-contained prose recap. " +
    "Preserve the user's ORIGINAL OBJECTIVE (never paraphrase away negative " +
    "constraints like 'do NOT do X'), all 'do not' / 'never' / 'avoid' " +
    "instructions, decisions reached, files inspected or modified, tool results " +
    "still relevant, and any open todos. Skip turn-by-turn play-by-play. " +
    "Output plain prose only — no tool calls, no markdown headings, no SEARCH/REPLACE blocks.";
  if (pinnedSkillNames.length === 0) return base;
  const list = pinnedSkillNames.map((n) => `"${n}"`).join(", ");
  return `${base} The following skill memos are pinned verbatim — do NOT quote or paraphrase their bodies: ${list}.`;
}

function collectPinnedSkills(head: ChatMessage[]): { names: string[]; bodies: string[] } {
  const pinned = new Map<string, string>();
  for (const msg of head) {
    if (typeof msg.content !== "string") continue;
    SKILL_PIN_REGEX.lastIndex = 0;
    for (const match of msg.content.matchAll(SKILL_PIN_REGEX)) {
      const name = match[1] as string;
      const full = match[0];
      pinned.delete(name);
      pinned.set(name, full);
    }
  }
  return { names: [...pinned.keys()], bodies: [...pinned.values()] };
}

function countMessageTokens(msg: ChatMessage, countFn: (s: string) => number): number {
  let n = countFn(typeof msg.content === "string" ? msg.content : "");
  if (msg.role === "assistant" && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
    n += countFn(JSON.stringify(msg.tool_calls));
  }
  return n;
}

// ── ContextManager ───────────────────────────────────────────────────────────

export class ContextManager {
  private _foldedThisTurn = false;

  constructor(private deps: ContextManagerDeps) {}

  resetFoldFlag(): void {
    this._foldedThisTurn = false;
  }

  /** Real-time token count of all messages (independent of API usage). */
  getLogTokens(): number {
    let total = 0;
    for (const msg of this.deps.getMessages()) {
      total += countMessageTokens(msg, this.deps.countTokens);
    }
    return total;
  }

  /**
   * Turn-start token estimate vs ctxMax. Caller folds if ratio crosses
   * TURN_START_FOLD_THRESHOLD. Covers cases the post-response fold can't
   * (terminal prior turn, fresh session restore, huge user paste).
   */
  estimateTurnStart(toolSpecs?: readonly ToolSpec[] | null): {
    estimateTokens: number;
    ctxMax: number;
    ratio: number;
  } {
    const messages = this.deps.getMessages();
    let total = 0;
    for (const msg of messages) {
      total += countMessageTokens(msg, this.deps.countTokens);
    }
    if (toolSpecs && toolSpecs.length > 0) {
      total += this.deps.countTokens(JSON.stringify(toolSpecs));
    }
    return {
      estimateTokens: total,
      ctxMax: this.deps.ctxMax,
      ratio: total / this.deps.ctxMax,
    };
  }

  /**
   * Decision after a turn's usage — fold, exit with summary, or carry on.
   * Uses graduated thresholds for normal vs aggressive fold.
   */
  decideAfterUsage(promptTokens: number): PostUsageDecision {
    const { ctxMax } = this.deps;
    const ratio = promptTokens / ctxMax;
    const base = { promptTokens, ctxMax, ratio };

    if (ratio > FORCE_SUMMARY_THRESHOLD) {
      return { kind: "exit-with-summary", ...base };
    }
    if (this._foldedThisTurn) return { kind: "none", ...base };

    if (ratio > HISTORY_FOLD_AGGRESSIVE_THRESHOLD) {
      return {
        kind: "fold",
        ...base,
        tailBudget: Math.floor(ctxMax * HISTORY_FOLD_AGGRESSIVE_TAIL_FRACTION),
        aggressive: true,
      };
    }
    if (ratio > HISTORY_FOLD_THRESHOLD) {
      return {
        kind: "fold",
        ...base,
        tailBudget: Math.floor(ctxMax * HISTORY_FOLD_TAIL_FRACTION),
        aggressive: false,
      };
    }
    return { kind: "none", ...base };
  }

  /**
   * Fold old messages into a summary. Finds tail boundary by scanning
   * backwards with per-message token counts, refuses savings below
   * MIN_SAVINGS_FRACTION, preserves pinned constraints and skill memos.
   */
  async fold(opts?: {
    keepRecentTokens?: number;
    /** Refuse fold if no user message lands in tail (safety for turn-start). */
    requireTailBoundary?: boolean;
  }): Promise<FoldResult> {
    const all = this.deps.getMessages();
    const noop: FoldResult = {
      folded: false,
      beforeMessages: all.length,
      afterMessages: all.length,
      summaryChars: 0,
    };
    if (all.length === 0) return noop;

    const tailBudget = opts?.keepRecentTokens ?? Math.floor(this.deps.ctxMax * HISTORY_FOLD_TAIL_FRACTION);

    const tokenCounts = all.map((m) => countMessageTokens(m, this.deps.countTokens));
    const totalTokens = tokenCounts.reduce((a, b) => a + b, 0);

    // Scan backwards to find the fold boundary
    let cumTokens = 0;
    let boundary = all.length;
    for (let i = all.length - 1; i >= 0; i--) {
      if (cumTokens + tokenCounts[i]! > tailBudget) break;
      cumTokens += tokenCounts[i]!;
      if (all[i]!.role === "user") boundary = i;
    }
    if (boundary <= 0) return noop;
    if (opts?.requireTailBoundary && boundary >= all.length) return noop;

    const head = all.slice(0, boundary);
    const headTokens = totalTokens - cumTokens;
    if (headTokens < totalTokens * HISTORY_FOLD_MIN_SAVINGS_FRACTION) return noop;

    // Collect pinned skills from head before summarizing
    const { names: pinnedNames, bodies: pinnedBodies } = collectPinnedSkills(head);
    const summary = await this.summarizeForFold(head, pinnedNames);
    if (!summary.content) return noop;

    // Build replacement: summary + tail messages
    const constraints = extractPinnedConstraints(this.deps.getSystemPrompt());
    const memoTail = pinnedBodies.length > 0 ? `\n\n${SKILL_PIN_MEMO_HEADER}\n\n${pinnedBodies.join("\n\n")}` : "";
    const constraintTail = constraints ? `\n\n[PINNED CONSTRAINTS — preserved verbatim]\n\n${constraints}` : "";

    const summaryMsg: ChatMessage = {
      role: "assistant",
      content: `${HISTORY_FOLD_MARKER}${summary.content}${memoTail}${constraintTail}`,
    };

    const replacement = [summaryMsg, ...all.slice(boundary)];
    deps.rewriteMessages(replacement);
    deps.onLogRewrite?.();

    this._foldedThisTurn = true;
    return {
      folded: true,
      beforeMessages: all.length,
      afterMessages: replacement.length,
      summaryChars: summary.content.length,
    };
  }

  /** Drop a trailing in-flight assistant-with-tool_calls before forced summary. */
  trimTrailingToolCalls(): boolean {
    const all = this.deps.getMessages();
    const tail = all[all.length - 1];
    if (!tail || tail.role !== "assistant" || !Array.isArray(tail.tool_calls) || tail.tool_calls.length === 0) {
      return false;
    }
    const replacement = all.slice(0, -1);
    this.deps.rewriteMessages(replacement);
    return true;
  }

  private async summarizeForFold(head: ChatMessage[], pinnedSkillNames: string[]): Promise<{ content: string }> {
    const instruction = buildFoldSummaryInstruction(pinnedSkillNames);
    const messages: ChatMessage[] = [
      { role: "system", content: this.deps.getSystemPrompt() },
      ...head,
      { role: "user", content: instruction },
    ];

    const signal = this.deps.getAbortSignal();
    const foldCtrl = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      const abortPromise = new Promise<never>((_, reject) => {
        const abort = () => {
          foldCtrl.abort();
          reject(new Error("fold-aborted"));
        };
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          foldCtrl.abort();
          reject(new Error("fold-timeout"));
        }, HISTORY_FOLD_SUMMARY_TIMEOUT_MS);
      });

      const resp = await Promise.race([this.deps.summarize(messages, foldCtrl.signal), abortPromise, timeoutPromise]);
      return { content: resp.content.trim() };
    } catch {
      return { content: "" };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
