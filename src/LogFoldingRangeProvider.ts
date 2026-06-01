'use strict';

import * as vscode from 'vscode';
import { TimestampParser } from './TimestampParsers/TimestampParser';

const STACK_FRAME_RE = /^\s+at\s+/;
const STACK_MORE_RE = /^\s+\.\.\. \d+ more$/;
const EXCEPTION_HEADER_RE = /Exception|Error:|Caused by:/;

const SQL_START_RE = /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE|MERGE|WITH|EXPLAIN|REPLACE)\b/i;

export interface LogBlock {
    startLine: number;
    endLine: number;
    canonicalKey: string;
    kind: 'duplicate' | 'stackTrace' | 'sql';
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

        let dupKey: string | null = null;
        let dupStart = -1;
        let dupCount = 0;

        let stackStart = -1;
        let stackLines: string[] = [];

        let sqlStart = -1;
        let sqlLines: string[] = [];

        for (let i = 0; i < lineCount; i++) {
            const text = document.lineAt(i).text;

            // --- Stack trace detection ---
            if (STACK_FRAME_RE.test(text) || STACK_MORE_RE.test(text)) {
                if (stackStart === -1) {
                    stackStart = i;
                    stackLines = [];
                    // Close any open SQL block
                    if (sqlStart !== -1) {
                        const sqlEnd = i - 1;
                        if (sqlEnd - sqlStart + 1 >= 2) {
                            blocks.push({ startLine: sqlStart, endLine: sqlEnd, canonicalKey: sqlLines.join('\n'), kind: 'sql' });
                        }
                        sqlStart = -1;
                        sqlLines = [];
                    }
                }
                stackLines.push(this.stripTimestamp(text));

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

            const key = this.stripTimestamp(text);

            // --- SQL block detection ---
            const hasTimestamp = !!this.timestampParser.getTimestampFromText(text);

            if (sqlStart !== -1) {
                if (key !== '' && !hasTimestamp) {
                    sqlLines.push(key);
                    continue;
                }
                // Empty line or timestamped log line → close SQL block
                const sqlEnd = i - 1;
                if (sqlEnd - sqlStart + 1 >= 2) {
                    blocks.push({ startLine: sqlStart, endLine: sqlEnd, canonicalKey: sqlLines.join('\n'), kind: 'sql' });
                }
                sqlStart = -1;
                sqlLines = [];
            }

            if (key !== '' && !hasTimestamp && SQL_START_RE.test(text)) {
                if (dupCount >= 2) {
                    blocks.push({ startLine: dupStart, endLine: dupStart + dupCount - 1, canonicalKey: dupKey!, kind: 'duplicate' });
                }
                dupKey = null;
                dupStart = -1;
                dupCount = 0;
                sqlStart = i;
                sqlLines = [key];
                continue;
            }

            // --- Duplicate line detection ---
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

        // Flush trailing SQL block
        if (sqlStart !== -1) {
            const sqlEnd = lineCount - 1;
            if (sqlEnd - sqlStart + 1 >= 2) {
                blocks.push({ startLine: sqlStart, endLine: sqlEnd, canonicalKey: sqlLines.join('\n'), kind: 'sql' });
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
