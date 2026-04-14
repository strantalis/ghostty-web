import { describe, expect, test } from 'bun:test';
import { Ghostty } from './ghostty';
import { getTestWasmPath } from './test-helpers';
import { GhosttyKittyImageFormat, GhosttyOptimizeMode } from './types';

describe('Ghostty diagnostics', () => {
  test('reads build metadata from the upstream wasm exports', async () => {
    const ghostty = await Ghostty.load(getTestWasmPath());
    const info = ghostty.getBuildInfo();

    expect(typeof info.simd).toBe('boolean');
    expect(typeof info.kittyGraphics).toBe('boolean');
    expect(typeof info.tmuxControlMode).toBe('boolean');
    expect([
      GhosttyOptimizeMode.DEBUG,
      GhosttyOptimizeMode.RELEASE_SAFE,
      GhosttyOptimizeMode.RELEASE_SMALL,
      GhosttyOptimizeMode.RELEASE_FAST,
    ]).toContain(info.optimize);
    expect(info.versionString.length).toBeGreaterThan(0);
    expect(info.versionMajor).toBeGreaterThanOrEqual(0);
    expect(info.versionMinor).toBeGreaterThanOrEqual(0);
    expect(info.versionPatch).toBeGreaterThanOrEqual(0);
  });

  test('exposes type metadata for ABI-aware consumers', async () => {
    const ghostty = await Ghostty.load(getTestWasmPath());
    const json = ghostty.getTypeJson();
    const layouts = ghostty.getTypeLayouts();
    const diagnostics = ghostty.getDiagnostics();

    expect(json.startsWith('{')).toBe(true);
    expect(layouts.GhosttyString).toBeDefined();
    expect(layouts.GhosttyString.size).toBeGreaterThan(0);
    expect(layouts.GhosttyString.fields.ptr.offset).toBeGreaterThanOrEqual(0);
    expect(layouts.GhosttyString.fields.len.offset).toBeGreaterThanOrEqual(0);
    expect(diagnostics.typeJson).toBe(json);
    expect(diagnostics.typeLayouts.GhosttyString.size).toBe(layouts.GhosttyString.size);
    expect(diagnostics.buildInfo.versionString).toBe(ghostty.getBuildInfo().versionString);
  });

  test('surfaces visible kitty graphics placements from the wasm bridge', async () => {
    const ghostty = await Ghostty.load(getTestWasmPath());
    const term = ghostty.createTerminal(20, 6);

    try {
      term.resize(20, 6, 9, 18);
      term.write('\x1b_Ga=T,t=d,f=24,i=1,p=1,s=1,v=2,c=4,r=2;////////\x1b\\');
      const placements = term.getKittyGraphicsPlacements();

      expect(placements).toHaveLength(1);
      expect(placements[0].imageId).toBe(1);
      expect(placements[0].placementId).toBe(1);
      expect(placements[0].format).toBe(GhosttyKittyImageFormat.RGB);
      expect(placements[0].pixelWidth).toBeGreaterThan(0);
      expect(placements[0].pixelHeight).toBeGreaterThan(0);
      expect(placements[0].data.length).toBeGreaterThan(0);
    } finally {
      term.free();
    }
  });

  test('surfaces unicode kitty placements and can snapshot them in scrollback viewports', async () => {
    const ghostty = await Ghostty.load(getTestWasmPath());
    const term = ghostty.createTerminal(20, 6);

    try {
      term.resize(20, 6, 9, 18);
      term.write('\x1b_Ga=T,t=d,f=24,i=7,s=2,v=2;////////////////\x1b\\');
      term.write(
        '\x1b[38;5;7m\u{10EEEE}\u{0305}\u{0305}\u{10EEEE}\u{0305}\u{030D}\x1b[39m\r\n' +
          '\x1b[38;5;7m\u{10EEEE}\u{030D}\u{0305}\u{10EEEE}\u{030D}\u{030D}\x1b[39m\r\n'
      );
      term.write('\x1b_Ga=p,i=7,U=1,q=2,c=2,r=2\x1b\\');

      const placements = term.getKittyGraphicsPlacements();
      expect(placements.length).toBeGreaterThan(0);
      expect(placements[0].imageId).toBe(7);
      expect(placements[0].pixelWidth).toBeGreaterThan(0);
      expect(placements[0].pixelHeight).toBeGreaterThan(0);

      term.write('scroll-1\r\nscroll-2\r\nscroll-3\r\nscroll-4\r\nscroll-5\r\nscroll-6\r\n');
      term.prepareRenderState();

      const scrollback = term.getScrollbackLength();
      let foundPlacementInScrollback = false;
      for (let viewportTop = 1; viewportTop <= scrollback; viewportTop++) {
        if (term.getKittyGraphicsPlacementsFromRenderState(viewportTop).length > 0) {
          foundPlacementInScrollback = true;
          break;
        }
      }

      expect(foundPlacementInScrollback).toBe(true);
    } finally {
      term.free();
    }
  });

  test('accepts PNG kitty payloads for browser-side decode when native PNG decode is unavailable', async () => {
    const ghostty = await Ghostty.load(getTestWasmPath());
    const term = ghostty.createTerminal(20, 6);

    try {
      term.resize(20, 6, 9, 18);
      term.write(
        '\x1b_Ga=T,t=d,f=100,i=9,p=9,c=4,r=2;iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==\x1b\\'
      );
      const placements = term.getKittyGraphicsPlacements();

      expect(placements).toHaveLength(1);
      expect(placements[0].imageId).toBe(9);
      expect(placements[0].placementId).toBe(9);
      expect(placements[0].format).toBe(GhosttyKittyImageFormat.PNG);
      expect(placements[0].data.length).toBeGreaterThan(0);
    } finally {
      term.free();
    }
  });
});
