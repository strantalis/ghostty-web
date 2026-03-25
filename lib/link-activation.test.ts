import { afterEach, describe, expect, mock, test } from 'bun:test';
import { OSC8LinkProvider } from './providers/osc8-link-provider';
import { UrlRegexProvider } from './providers/url-regex-provider';

const createMouseEvent = (input?: Partial<MouseEvent>): MouseEvent =>
  ({
    ctrlKey: false,
    metaKey: false,
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
    ...input,
  }) as MouseEvent;

const createRegexTerminal = (
  lineText: string,
  openLink?: (url: string, event: MouseEvent) => void | Promise<void>
) => ({
  options: {
    openLink,
  },
  buffer: {
    active: {
      getLine: (y: number) => {
        if (y !== 0) return undefined;
        return {
          length: lineText.length,
          getCell: (x: number) => {
            const char = lineText[x];
            if (char === undefined) return undefined;
            return {
              getCodepoint: () => char.codePointAt(0) || 0,
            };
          },
        };
      },
    },
  },
});

const createOsc8Terminal = (
  uri: string,
  openLink?: (url: string, event: MouseEvent) => void | Promise<void>
) => ({
  options: {
    openLink,
  },
  buffer: {
    active: {
      length: 1,
      getLine: (y: number) => {
        if (y !== 0) return undefined;
        return {
          length: 1,
          getCell: (x: number) => {
            if (x !== 0) return undefined;
            return {
              getHyperlinkId: () => 1,
            };
          },
        };
      },
    },
  },
  wasmTerm: {
    getHyperlinkUri: (row: number, col: number) => (row === 0 && col === 0 ? uri : null),
    getScrollbackHyperlinkUri: () => null,
    getScrollbackLength: () => 0,
  },
});

const getRegexLink = async (
  lineText: string,
  openLink?: (url: string, event: MouseEvent) => void | Promise<void>
) => {
  const provider = new UrlRegexProvider(createRegexTerminal(lineText, openLink));
  return await new Promise<ReturnType<typeof Array.prototype.at>>((resolve) => {
    provider.provideLinks(0, (links) => resolve(links?.at(0)));
  });
};

const getOsc8Link = async (
  uri: string,
  openLink?: (url: string, event: MouseEvent) => void | Promise<void>
) => {
  const provider = new OSC8LinkProvider(createOsc8Terminal(uri, openLink));
  return await new Promise<ReturnType<typeof Array.prototype.at>>((resolve) => {
    provider.provideLinks(0, (links) => resolve(links?.at(0)));
  });
};

const originalWindowOpen = window.open;

afterEach(() => {
  window.open = originalWindowOpen;
});

describe('Link activation', () => {
  test('regex links call the injected openLink hook without requiring modifiers', async () => {
    const openLink = mock((_url: string, _event: MouseEvent) => undefined);
    const link = await getRegexLink('Visit https://example.com', openLink);

    link?.activate(createMouseEvent());

    expect(openLink).toHaveBeenCalledTimes(1);
    expect(openLink).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ metaKey: false, ctrlKey: false })
    );
  });

  test('OSC8 links call the injected openLink hook without requiring modifiers', async () => {
    const openLink = mock((_url: string, _event: MouseEvent) => undefined);
    const link = await getOsc8Link('https://osc8.example.com', openLink);

    link?.activate(createMouseEvent());

    expect(openLink).toHaveBeenCalledTimes(1);
    expect(openLink).toHaveBeenCalledWith(
      'https://osc8.example.com',
      expect.objectContaining({ metaKey: false, ctrlKey: false })
    );
  });

  test('fallback does not open without Cmd/Ctrl modifiers', async () => {
    const windowOpen = mock(() => null);
    window.open = windowOpen as typeof window.open;
    const link = await getRegexLink('Visit https://example.com');

    link?.activate(createMouseEvent());

    expect(windowOpen).not.toHaveBeenCalled();
  });

  test('regex links fall back to window.open when no hook is supplied', async () => {
    const windowOpen = mock(() => null);
    window.open = windowOpen as typeof window.open;
    const link = await getRegexLink('Visit https://fallback.example.com');

    link?.activate(createMouseEvent({ metaKey: true }));

    expect(windowOpen).toHaveBeenCalledTimes(1);
    expect(windowOpen).toHaveBeenCalledWith(
      'https://fallback.example.com',
      '_blank',
      'noopener,noreferrer'
    );
  });
});
