import * as vscode from 'vscode';
import { CompletionProvider } from './completionProvider';

export function activate(context: vscode.ExtensionContext) {
  const provider = vscode.languages.registerCompletionItemProvider(
    { scheme: 'file', language: 'typescript' },
    new CompletionProvider()
  );

  context.subscriptions.push(provider);
}

export function deactivate() { }
