'use strict';

import * as vscode from 'vscode';
import { TimestampParser } from './TimestampParsers/TimestampParser';

const LOG_LEVEL_RE = /\b(SEVERE|FATAL|ERROR|WARN(?:ING)?|INFO|DEBUG|TRACE)\b\s*/;
const THREAD_RE = /^\[.*?\]\s*/;
// Matches fully-qualified class+method: e.g. "org.apache.catalina.core.StandardEngine.startInternal"
// Captures [1]=ClassName.method, [2]=rest of line after the FQCN
const FQCN_RE = /^(?:[a-z]\w*\.)+([A-Z]\w+\.\w+)(.*)/;

export class MessagePreviewController implements vscode.Disposable {
    readonly codeLensProvider: MessagePreviewCodeLensProvider;

    private readonly _emitter = new vscode.EventEmitter<void>();
    private readonly _disposables: vscode.Disposable[] = [];

    constructor(private readonly _timestampParser: TimestampParser) {
        this.codeLensProvider = new MessagePreviewCodeLensProvider(this);

        this._disposables.push(
            this._emitter,
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('logFileHighlighter.messagePreview')) {
                    this._emitter.fire();
                }
            }),
        );
    }

    get onDidChangeCodeLenses(): vscode.Event<void> {
        return this._emitter.event;
    }

    isEnabled(): boolean {
        return vscode.workspace.getConfiguration('logFileHighlighter.messagePreview')
            .get<boolean>('enabled', false) === true;
    }

    extractMessage(line: string): string | undefined {
        const ts = this._timestampParser.getTimestampFromText(line);
        if (!ts) {
            return undefined;
        }

        // Remove timestamp
        let rest = (line.substring(0, ts.matchIndex) + line.substring(ts.matchIndex + ts.original.length)).trim();

        // Remove log level keyword (INFO, WARNING, ERROR, ...)
        rest = rest.replace(LOG_LEVEL_RE, '').trim();

        // Remove leading thread name [threadName]
        rest = rest.replace(THREAD_RE, '').trim();

        // If line starts with a FQCN, keep only the message after it (or nothing)
        const fqcnMatch = rest.match(FQCN_RE);
        if (fqcnMatch) {
            rest = fqcnMatch[2].trim();
        }

        if (!rest) {
            return undefined;
        }
        const maxLength = 160;
        return rest.length > maxLength ? rest.slice(0, maxLength) + '…' : rest;
    }

    dispose(): void {
        for (const d of this._disposables) {
            d.dispose();
        }
    }
}

class MessagePreviewCodeLensProvider implements vscode.CodeLensProvider {
    readonly onDidChangeCodeLenses: vscode.Event<void>;

    constructor(private readonly _ctrl: MessagePreviewController) {
        this.onDidChangeCodeLenses = _ctrl.onDidChangeCodeLenses;
    }

    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        if (!this._ctrl.isEnabled()) {
            return [];
        }

        const lenses: vscode.CodeLens[] = [];
        for (let i = 0; i < document.lineCount; i++) {
            const message = this._ctrl.extractMessage(document.lineAt(i).text);
            if (message) {
                lenses.push(new vscode.CodeLens(
                    new vscode.Range(i, 0, i, 0),
                    { title: message, command: '' }
                ));
            }
        }
        return lenses;
    }
}
