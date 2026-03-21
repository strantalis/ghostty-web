/**
 * Tests for Canvas Renderer
 *
 * Note: Most renderer tests are visual and require a browser environment.
 * These tests verify non-visual aspects like theme configuration.
 * Full visual tests are in examples/renderer-demo.html
 */

import { describe, expect, test } from 'bun:test';
import {
  CanvasRenderer,
  DEFAULT_THEME,
  type IRenderable,
  type IScrollbackProvider,
} from './renderer';
import type { GhosttyCell } from './types';

function makeCell(char: string): GhosttyCell {
  return {
    codepoint: char.codePointAt(0) ?? 32,
    fg_r: 204,
    fg_g: 204,
    fg_b: 204,
    bg_r: 0,
    bg_g: 0,
    bg_b: 0,
    flags: 0,
    width: 1,
    hyperlink_id: 0,
    grapheme_len: 0,
  };
}

function makeLine(label: string, cols: number): GhosttyCell[] {
  return Array.from({ length: cols }, (_, index) => makeCell(label[index] ?? ' '));
}

describe('CanvasRenderer', () => {
  describe('Default Theme', () => {
    test('has all required ANSI colors', () => {
      expect(DEFAULT_THEME.black).toBe('#000000');
      expect(DEFAULT_THEME.red).toBe('#cd3131');
      expect(DEFAULT_THEME.green).toBe('#0dbc79');
      expect(DEFAULT_THEME.yellow).toBe('#e5e510');
      expect(DEFAULT_THEME.blue).toBe('#2472c8');
      expect(DEFAULT_THEME.magenta).toBe('#bc3fbc');
      expect(DEFAULT_THEME.cyan).toBe('#11a8cd');
      expect(DEFAULT_THEME.white).toBe('#e5e5e5');
    });

    test('has all bright ANSI colors', () => {
      expect(DEFAULT_THEME.brightBlack).toBe('#666666');
      expect(DEFAULT_THEME.brightRed).toBe('#f14c4c');
      expect(DEFAULT_THEME.brightGreen).toBe('#23d18b');
      expect(DEFAULT_THEME.brightYellow).toBe('#f5f543');
      expect(DEFAULT_THEME.brightBlue).toBe('#3b8eea');
      expect(DEFAULT_THEME.brightMagenta).toBe('#d670d6');
      expect(DEFAULT_THEME.brightCyan).toBe('#29b8db');
      expect(DEFAULT_THEME.brightWhite).toBe('#ffffff');
    });

    test('has foreground and background colors', () => {
      expect(DEFAULT_THEME.foreground).toBe('#d4d4d4');
      expect(DEFAULT_THEME.background).toBe('#1e1e1e');
    });

    test('has cursor colors', () => {
      expect(DEFAULT_THEME.cursor).toBe('#ffffff');
      expect(DEFAULT_THEME.cursorAccent).toBe('#1e1e1e');
    });

    test('has selection colors', () => {
      // Selection colors are now solid (not semi-transparent overlay)
      // Ghostty-style: selection bg = foreground color, selection fg = background color
      expect(DEFAULT_THEME.selectionBackground).toBe('#d4d4d4');
      expect(DEFAULT_THEME.selectionForeground).toBe('#1e1e1e');
    });
  });

  describe('Theme Color Format', () => {
    test('all colors are valid hex strings', () => {
      const hexPattern = /^#[0-9a-f]{6}$/i;

      expect(DEFAULT_THEME.black).toMatch(hexPattern);
      expect(DEFAULT_THEME.foreground).toMatch(hexPattern);
      expect(DEFAULT_THEME.background).toMatch(hexPattern);
      expect(DEFAULT_THEME.cursor).toMatch(hexPattern);
    });
  });

  describe('Viewport Mapping', () => {
    test('fractional viewportY should use floor(viewportY) consistently for row mapping', () => {
      const canvas = document.createElement('canvas');
      const renderer = new CanvasRenderer(canvas, { devicePixelRatio: 1 });

      const screenRows: number[] = [];
      const scrollbackOffsets: number[] = [];

      const buffer: IRenderable = {
        getLine(y: number): GhosttyCell[] | null {
          screenRows.push(y);
          return makeLine(`S${y}`, 4);
        },
        getCursor() {
          return { x: 0, y: 0, visible: false };
        },
        getDimensions() {
          return { cols: 4, rows: 4 };
        },
        isRowDirty(): boolean {
          return false;
        },
        clearDirty(): void {},
      };

      const scrollbackProvider: IScrollbackProvider = {
        getScrollbackLine(offset: number): GhosttyCell[] | null {
          scrollbackOffsets.push(offset);
          return makeLine(`B${offset}`, 4);
        },
        getScrollbackLength(): number {
          return 5;
        },
      };

      renderer.render(buffer, true, 1.7, scrollbackProvider, 1);

      expect(scrollbackOffsets).toEqual([4]);
      expect(screenRows).toEqual([0, 1, 2]);

      renderer.dispose();
    });
  });
});
