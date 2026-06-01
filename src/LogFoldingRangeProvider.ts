'use strict';

import * as vscode from 'vscode';
import { TimestampParser } from './TimestampParsers/TimestampParser';

const STACK_FRAME_RE = /^\s+at\s+/;
const STACK_MORE_RE = /^\s+\.\.\. \d+ more$/;
const EXCEPTION_HEADER_RE = /Exception|Error:|Caused by:/;

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

        const ranges: vscode.FoldingRange[] = [];
        const lineCount = document.lineCount;

        // State for duplicate-line detection
        let dupKey: string | null = null;
        let dupStart = -1;
        let dupCount = 0;

        // State for stack-trace detection
        let stackStart = -1;

        for (let i = 0; i < lineCount; i++) {
            const text = document.lineAt(i).text;

            // --- Stack trace detection ---
            if (STACK_FRAME_RE.test(text) || STACK_MORE_RE.test(text)) {
                if (stackStart === -1) {
                    stackStart = i;
                }
                // While in a stack trace, don't participate in duplicate detection.
                // Flush any pending duplicate block that ends before the stack trace.
                if (dupCount >= 2 && dupStart < stackStart) {
                    ranges.push(new vscode.FoldingRange(dupStart, dupStart + dupCount - 1));
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
                    // Include the preceding exception header in the fold if it looks like one
                    const headerIdx = stackStart - 1;
                    const foldStart =
                        headerIdx >= 0 &&
                        EXCEPTION_HEADER_RE.test(document.lineAt(headerIdx).text)
                            ? headerIdx
                            : stackStart;
                    ranges.push(new vscode.FoldingRange(foldStart, stackEnd));
                }
                stackStart = -1;
            }

            // --- Duplicate line detection ---
            const key = this.stripTimestamp(text);

            if (key === '') {
                // Empty line breaks any duplicate run
                if (dupCount >= 2) {
                    ranges.push(new vscode.FoldingRange(dupStart, dupStart + dupCount - 1));
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
                    ranges.push(new vscode.FoldingRange(dupStart, dupStart + dupCount - 1));
                }
                dupKey = key;
                dupStart = i;
                dupCount = 1;
            }
        }

        // Flush trailing duplicate block
        if (dupCount >= 2) {
            ranges.push(new vscode.FoldingRange(dupStart, dupStart + dupCount - 1));
        }

        // Flush trailing stack trace block
        if (stackStart !== -1) {
            const stackEnd = lineCount - 1;
            const framesCount = stackEnd - stackStart + 1;
            if (framesCount >= 2) {
                const headerIdx = stackStart - 1;
                const foldStart =
                    headerIdx >= 0 &&
                    EXCEPTION_HEADER_RE.test(document.lineAt(headerIdx).text)
                        ? headerIdx
                        : stackStart;
                ranges.push(new vscode.FoldingRange(foldStart, stackEnd));
            }
        }

        return ranges;
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
