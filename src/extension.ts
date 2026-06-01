'use strict';

import * as vscode from 'vscode';
import { CustomPatternController } from './CustomPatternController';
import { CustomPatternDecorator } from './CustomPatternDecorator';
import { ProgressIndicator } from './ProgressIndicator';
import { ProgressIndicatorController } from './ProgressIndicatorController';
import { SelectionHelper } from './SelectionHelper';
import { TimePeriodCalculator } from './TimePeriodCalculator';
import { TimePeriodController } from './TimePeriodController';
import { TailController } from './TailController';
import { TimestampParser } from './TimestampParsers/TimestampParser';
import { LogFoldingRangeProvider, LogBlock } from './LogFoldingRangeProvider';
import { Constants } from './Constants';

// this method is called when the extension is activated
export function activate(context: vscode.ExtensionContext) {

    const selectionHelper = new SelectionHelper();

    var timestampParser = new TimestampParser()

    // create a new time calculator and controller
    const timeCalculator = new TimePeriodCalculator(timestampParser);
    const timeController = new TimePeriodController(timeCalculator, selectionHelper);

    // create log level colorizer and -controller
    const customPatternDecorator = new CustomPatternDecorator();
    const customPatternController = new CustomPatternController(customPatternDecorator);

    // create progress indicator and -controller
    const progressIndicator = new ProgressIndicator(timeCalculator, selectionHelper, timestampParser);
    const progressIndicatorController = new ProgressIndicatorController(progressIndicator);

    // tail log files
    const tailController = new TailController();

    // folding provider for duplicate log lines and exception call stacks
    const foldingProvider = new LogFoldingRangeProvider(timestampParser);
    context.subscriptions.push(
        vscode.languages.registerFoldingRangeProvider(
            { language: Constants.LogLanguageId },
            foldingProvider
        )
    );

    // register commands
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'logFileHighlighter.removeProgressIndicatorDecorations', () => {
                // Remove decorations
                progressIndicatorController.removeDecorations();
            }));

    context.subscriptions.push(
        vscode.commands.registerCommand('logFileHighlighter.foldAllDuplicates', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== Constants.LogLanguageId) {
                return;
            }

            const blocks = foldingProvider.computeBlocks(editor.document);

            const byKey = new Map<string, LogBlock[]>();
            for (const block of blocks) {
                const list = byKey.get(block.canonicalKey) ?? [];
                list.push(block);
                byKey.set(block.canonicalKey, list);
            }

            const linesToFold: number[] = [];
            for (const group of byKey.values()) {
                const foldAll = group[0].kind === 'sql';
                if (foldAll || group.length >= 2) {
                    for (const b of group) {
                        linesToFold.push(b.startLine);
                    }
                }
            }

            if (linesToFold.length === 0) {
                vscode.window.showInformationMessage('No log blocks found to fold.');
                return;
            }

            const originalSelections = editor.selections;
            editor.selections = linesToFold.map(n => new vscode.Selection(n, 0, n, 0));
            await vscode.commands.executeCommand('editor.fold');
            editor.selections = originalSelections;
            vscode.window.showInformationMessage(`Folded ${linesToFold.length} duplicate block(s).`);
        }));

    context.subscriptions.push(
        vscode.commands.registerCommand('logFileHighlighter.unfoldAll', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== Constants.LogLanguageId) {
                return;
            }
            await vscode.commands.executeCommand('editor.unfoldAll');
        }));

    // Add to a list of disposables which are disposed when this extension is deactivated.
    context.subscriptions.push(timeController, customPatternController, progressIndicatorController, tailController);
}

// this method is called when your extension is deactivated
export function deactivate() {
    // Nothing to do here
}
