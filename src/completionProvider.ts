import { CancellationToken, commands, CompletionContext, CompletionItem, CompletionItemProvider, CompletionList, Position, Range, TextDocument, TextEdit } from 'vscode';

export class CompletionProvider implements CompletionItemProvider {
  private fixtureCache = new Map<string, { items: CompletionItem[]; timestamp: number }>();
  private fixtureBlockCache = new Map<string, { range: Range | null; timestamp: number }>();
  private readonly FIXTURE_CACHE_TTL = 60000; // 1 minute
  private readonly FIXTURE_BLOCK_CACHE_TTL = 1000; // 1 second
  private fetchingFixtures = false;

  async provideCompletionItems(document: TextDocument, position: Position, _: CancellationToken, _context: CompletionContext): Promise<CompletionList<CompletionItem> | null | undefined> {
    const prefix = document.getText(new Range(0, 0, position.line, position.character));
    if (!prefix.includes("test" + "(")) { return; }

    const fixturesBlock = await this.findFixturesBlock(document, position);
    if (!fixturesBlock) { return new CompletionList(undefined, true); }

    const cacheKey = `${document.uri.toString()}:${fixturesBlock.start.line}-${fixturesBlock.end.line}`;
    const cachedFixtures = this.fixtureCache.get(cacheKey);
    if (cachedFixtures && Date.now() - cachedFixtures.timestamp < this.FIXTURE_CACHE_TTL) {
      return this.createCompletionList(document, fixturesBlock, cachedFixtures.items);
    }

    if (this.fetchingFixtures) { return new CompletionList(undefined, true); }
    this.fetchingFixtures = true;
    const completions = await this.findFixtures(document, fixturesBlock);
    this.fixtureCache.set(cacheKey, { items: completions, timestamp: Date.now() });
    return this.createCompletionList(document, fixturesBlock, completions);
  }

  async findFixturesBlock(document: TextDocument, position: Position): Promise<Range | null> {
    const cacheKey = `${document.uri.toString()}:${position.line}`;
    const cachedBlock = this.fixtureBlockCache.get(cacheKey);
    if (cachedBlock && Date.now() - cachedBlock.timestamp < this.FIXTURE_BLOCK_CACHE_TTL) {
      return cachedBlock.range;
    }

    const lines = document.getText().split("\n");
    let currentLine = position.line;
    let openBraces = 0;
    let start: Position | null = null;
    let end: Position | null = null;

    while (currentLine >= 0) {
      const text = lines[currentLine];
      if (/(?<![a-zA-Z])test\(/gm.test(text)) {
        for (let i = currentLine; i < lines.length; i++) {
          const line = lines[i];
          for (let j = line.lastIndexOf('('); j < line.length; j++) {
            if (line[j] === '{') {
              openBraces++;
              if (openBraces === 1) {
                start = new Position(i, j + 1);
              }
            } else if (line[j] === '}') {
              openBraces--;
            }
            if (start && openBraces === 0) {
              end = new Position(i, j);
              break;
            }
          }
          if (end) {
            break;
          }
        }
        break;
      }
      currentLine--;
    }

    const range = start && end ? new Range(start, end) : null;
    this.fixtureBlockCache.set(cacheKey, { range, timestamp: Date.now() });
    return range;
  }

  async findFixtures(document: TextDocument, range: Range): Promise<CompletionItem[]> {
    const completions = await commands.executeCommand<CompletionList>(
      'vscode.executeCompletionItemProvider',
      document.uri,
      range.start
    );
    return completions.items;
  }

  private createCompletionList(document: TextDocument, fixturesBlock: Range, completions: CompletionItem[]): CompletionList<CompletionItem> {
    const fbText = document.getText(fixturesBlock);
    const isFbMultiline = fbText.includes("\n");
    const fixtureBlockParts = fbText.split(",");
    const alreadyUsedFixtures = new Set(fixtureBlockParts.map((x) => x.trim()));
    const preparedFixtureBlock = fixtureBlockParts.map((x) => x.trimEnd()).filter(Boolean);
    const template = preparedFixtureBlock[0].slice(0, preparedFixtureBlock[0].length - preparedFixtureBlock[0].trim().length);

    return new CompletionList(completions.filter((x) => !alreadyUsedFixtures.has(`${x.label}`)).map((x) => {
      const item = new CompletionItem(`${x.label}`);
      item.detail = "Fixture";
      item.sortText = `!${x.sortText}`;
      item.preselect = true;
      item.insertText = x.insertText;
      item.additionalTextEdits = [
        new TextEdit(fixturesBlock, `${preparedFixtureBlock},${template}${x.insertText}${isFbMultiline ? '\n' : ''}`)
      ];
      return item;
    }));
  }
}
