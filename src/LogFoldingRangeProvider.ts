'use strict';

import * as vscode from 'vscode';
import { TimestampParser } from './TimestampParsers/TimestampParser';

const STACK_FRAME_RE = /^\s+at\s+/;
const STACK_MORE_RE = /^\s+\.\.\. \d+ more$/;
const EXCEPTION_HEADER_RE = /Exception|Error:|Caused by:/;

export interface LogBlock {
    startLine: number;
    endLine: number;
    canonicalKey: string;
    kind: 'duplicate' | 'stackTrace';
}

export class LogFoldingRangeProvider implements vscode.FoldingRangeProvider {

    constructor(private readonly timestampParser: TimestampParser) { }

    provideFoldingRanges(
        document: vscode.TextDocument,
        _context: vscode.FoldingContext,
        _token: vscode.CancellationToken
    ): vscode.FoldingRange[] {
        const config = vscode.workspace.getConfiguration('logFileHighlighter');
        if (!config.get<boolean>('enableLogFolding', true)) {
            return [];
        }
        return this.computeBlocks(document).map(b => new vscode.FoldingRange(b.startLine, b.endLine));
    }

    computeBlocks(document: vscode.TextDocument): LogBlock[] {
        const blocks: LogBlock[] = [];
        const lineCount = document.lineCount;

        // State for duplicate-line detection
        let dupKey: string | null = null;
        let dupStart = -1;
        let dupCount = 0;

        // State for stack-trace detection
        let stackStart = -1;
        let stackLines: string[] = [];

        for (let i = 0; i < lineCount; i++) {
            const text = document.lineAt(i).text;

            // --- Stack trace detection ---
            if (STACK_FRAME_RE.test(text) || STACK_MORE_RE.test(text)) {
                if (stackStart === -1) {
                    stackStart = i;
                    stackLines = [];
                }
                stackLines.push(this.stripTimestamp(text));

                // Flush any pending duplicate block that ends before the stack trace.
                if (dupCount >= 2 && dupStart < stackStart) {
                    blocks.push({ startLine: dupStart, endLine: dupStart + dupCount - 1, canonicalKey: dupKey!, kind: 'duplicate' });
                }
                dupKey = null;
                dupStart = -1;
                dupCount = 0;
                continue;
            }

            // Line is NOT a stack frame — close any open stack trace block
            if (stackStart !== -1) {
                const stackEnd = i - 1;
                const framesCount = stackEnd - stackStart + 1;
                if (framesCount >= 2) {
                    const headerIdx = stackStart - 1;
                    const hasHeader = headerIdx >= 0 && EXCEPTION_HEADER_RE.test(document.lineAt(headerIdx).text);
                    const foldStart = hasHeader ? headerIdx : stackStart;
                    const headerKey = hasHeader ? this.stripTimestamp(document.lineAt(headerIdx).text) : '';
                    const canonicalKey = headerKey + '\n' + (stackLines[0] ?? '');
                    blocks.push({ startLine: foldStart, endLine: stackEnd, canonicalKey, kind: 'stackTrace' });
                }
                stackStart = -1;
                stackLines = [];
            }

            // --- Duplicate line detection ---
            const key = this.stripTimestamp(text);

            if (key === '') {
                if (dupCount >= 2) {
                    blocks.push({ startLine: dupStart, endLine: dupStart + dupCount - 1, canonicalKey: dupKey!, kind: 'duplicate' });
                }
                dupKey = null;
                dupStart = -1;
                dupCount = 0;
                continue;
            }

            if (key === dupKey) {
                dupCount++;
            } else {
                if (dupCount >= 2) {
                    blocks.push({ startLine: dupStart, endLine: dupStart + dupCount - 1, canonicalKey: dupKey!, kind: 'duplicate' });
                }
                dupKey = key;
                dupStart = i;
                dupCount = 1;
            }
        }

        // Flush trailing duplicate block
        if (dupCount >= 2) {
            blocks.push({ startLine: dupStart, endLine: dupStart + dupCount - 1, canonicalKey: dupKey!, kind: 'duplicate' });
        }

        // Flush trailing stack trace block
        if (stackStart !== -1) {
            const stackEnd = lineCount - 1;
            const framesCount = stackEnd - stackStart + 1;
            if (framesCount >= 2) {
                const headerIdx = stackStart - 1;
                const hasHeader = headerIdx >= 0 && EXCEPTION_HEADER_RE.test(document.lineAt(headerIdx).text);
                const foldStart = hasHeader ? headerIdx : stackStart;
                const headerKey = hasHeader ? this.stripTimestamp(document.lineAt(headerIdx).text) : '';
                const canonicalKey = headerKey + '\n' + (stackLines[0] ?? '');
                blocks.push({ startLine: foldStart, endLine: stackEnd, canonicalKey, kind: 'stackTrace' });
            }
        }

        return blocks;
    }

    private stripTimestamp(line: string): string {
        const ts = this.timestampParser.getTimestampFromText(line);
        if (ts) {
            return (line.substring(0, ts.matchIndex) +
                line.substring(ts.matchIndex + ts.original.length)).trim();
        }
        return line.trim();
    }
}
