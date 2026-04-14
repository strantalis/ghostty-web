/**
 * TypeScript wrapper for libghostty-vt WASM API
 *
 * High-performance terminal emulation using Ghostty's battle-tested VT100 parser.
 * The key optimization is the RenderState API which provides a pre-computed
 * snapshot of all render data in a single update call.
 */

import {
  CellFlags,
  type Cursor,
  DirtyState,
  GHOSTTY_CONFIG_SIZE,
  type GhosttyAbsoluteSelectionRange,
  GhosttyBuildInfoData,
  type GhosttyBuildInfoSnapshot,
  type GhosttyCell,
  type GhosttyDiagnostics,
  GhosttyFormatterFormat,
  type GhosttyFormatterOptions,
  GhosttyKittyImageCompression,
  GhosttyKittyImageFormat,
  type GhosttyKittyImagePlacement,
  GhosttyKittyPlacementLayer,
  GhosttyOptimizeMode,
  GhosttyPointTag,
  GhosttyResult,
  type GhosttyTerminalConfig,
  type GhosttyTypeLayouts,
  type GhosttyWasmExports,
  KeyEncoderOption,
  type KeyEvent,
  type KittyKeyFlags,
  type MouseEncoderSize,
  type MouseEventData,
  type RenderStateColors,
  type RenderStateCursor,
  type RGB,
  type TerminalHandle,
} from './types';

// Re-export types for convenience
export {
  CellFlags,
  type Cursor,
  DirtyState,
  type GhosttyAbsoluteSelectionRange,
  type GhosttyBuildInfoSnapshot,
  type GhosttyCell,
  type GhosttyDiagnostics,
  GhosttyFormatterFormat,
  type GhosttyFormatterOptions,
  GhosttyKittyImageCompression,
  GhosttyKittyImageFormat,
  type GhosttyKittyImagePlacement,
  GhosttyKittyPlacementLayer,
  GhosttyOptimizeMode,
  GhosttyPointTag,
  GhosttyResult,
  type GhosttyTerminalConfig,
  type GhosttyTypeLayouts,
  KeyEncoderOption,
  type RenderStateColors,
  type RenderStateCursor,
  type RGB,
};

/**
 * Main Ghostty WASM wrapper class
 */
export class Ghostty {
  private exports: GhosttyWasmExports;
  private memory: WebAssembly.Memory;
  private typeJsonCache?: string;
  private typeLayoutsCache?: GhosttyTypeLayouts;
  private buildInfoCache?: GhosttyBuildInfoSnapshot;
  private static readonly REQUIRED_EXPORTS: (keyof GhosttyWasmExports)[] = [
    'memory',
    'ghostty_build_info',
    'ghostty_type_json',
    'ghostty_wasm_alloc_u8_array',
    'ghostty_wasm_free_u8_array',
    'ghostty_terminal_new_simple',
    'ghostty_terminal_free_simple',
    'ghostty_key_encoder_setopt_from_terminal_simple',
    'ghostty_mouse_encoder_setopt_from_terminal_simple',
    'ghostty_terminal_resize_with_cell_size_simple',
    'ghostty_terminal_set_kitty_image_storage_limit',
    'ghostty_terminal_write',
    'ghostty_render_state_update',
    'ghostty_render_state_get_viewport',
    'ghostty_terminal_get_kitty_graphics_placements',
    'ghostty_terminal_get_kitty_graphics_placements_in_viewport',
  ];

  constructor(wasmInstance: WebAssembly.Instance) {
    this.exports = wasmInstance.exports as GhosttyWasmExports;
    this.memory = this.exports.memory;
  }

  createKeyEncoder(): KeyEncoder {
    return new KeyEncoder(this.exports);
  }

  createMouseEncoder(): MouseEncoder {
    return new MouseEncoder(this.exports);
  }

  createTerminal(
    cols: number = 80,
    rows: number = 24,
    config?: GhosttyTerminalConfig
  ): GhosttyTerminal {
    return new GhosttyTerminal(
      this.exports,
      this.memory,
      this.getTypeLayouts(),
      cols,
      rows,
      config
    );
  }

  getTypeJson(): string {
    if (!this.typeJsonCache) {
      const ptr = this.exports.ghostty_type_json();
      if (!ptr) {
        throw new Error('ghostty_type_json returned a null pointer');
      }
      this.typeJsonCache = this.readCString(ptr);
    }

    return this.typeJsonCache;
  }

  getTypeLayouts(): GhosttyTypeLayouts {
    if (!this.typeLayoutsCache) {
      this.typeLayoutsCache = JSON.parse(this.getTypeJson()) as GhosttyTypeLayouts;
    }

    return this.typeLayoutsCache;
  }

  getBuildInfo(): GhosttyBuildInfoSnapshot {
    if (!this.buildInfoCache) {
      this.buildInfoCache = {
        simd: this.readBuildInfoBool(GhosttyBuildInfoData.SIMD),
        kittyGraphics: this.readBuildInfoBool(GhosttyBuildInfoData.KITTY_GRAPHICS),
        tmuxControlMode: this.readBuildInfoBool(GhosttyBuildInfoData.TMUX_CONTROL_MODE),
        optimize: this.readBuildInfoOptimize(GhosttyBuildInfoData.OPTIMIZE),
        versionString: this.readBuildInfoString(GhosttyBuildInfoData.VERSION_STRING),
        versionMajor: this.readBuildInfoUsize(GhosttyBuildInfoData.VERSION_MAJOR),
        versionMinor: this.readBuildInfoUsize(GhosttyBuildInfoData.VERSION_MINOR),
        versionPatch: this.readBuildInfoUsize(GhosttyBuildInfoData.VERSION_PATCH),
        versionBuild: this.readBuildInfoString(GhosttyBuildInfoData.VERSION_BUILD),
      };
    }

    return { ...this.buildInfoCache };
  }

  getDiagnostics(): GhosttyDiagnostics {
    return {
      buildInfo: this.getBuildInfo(),
      typeJson: this.getTypeJson(),
      typeLayouts: this.getTypeLayouts(),
    };
  }

  static async load(wasmPath?: string): Promise<Ghostty> {
    // If explicit path provided, use it
    if (wasmPath) {
      return Ghostty.loadFromPath(wasmPath);
    }

    // Resolve path relative to this module
    const moduleUrl = new URL('../ghostty-vt.wasm', import.meta.url);

    // Build paths to try, prioritizing file system paths for Node/Bun
    const defaultPaths: string[] = [];

    // For Node/Bun: try absolute file path first (strip file:// protocol)
    if (moduleUrl.protocol === 'file:') {
      let filePath = moduleUrl.pathname;
      // Remove leading slash on Windows paths (e.g., /C:/ -> C:/)
      if (filePath.match(/^\/[A-Za-z]:\//)) {
        filePath = filePath.slice(1);
      }
      defaultPaths.push(filePath);
    }

    // Also try other common paths
    defaultPaths.push(moduleUrl.href, './ghostty-vt.wasm', '/ghostty-vt.wasm');

    let lastError: Error | null = null;
    for (const path of defaultPaths) {
      try {
        return await Ghostty.loadFromPath(path);
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
      }
    }
    throw lastError || new Error('Failed to load Ghostty WASM');
  }

  private static async loadFromPath(path: string): Promise<Ghostty> {
    let wasmBytes: ArrayBuffer | undefined;

    // Try Bun.file first (for Bun environments)
    if (typeof Bun !== 'undefined' && typeof Bun.file === 'function') {
      try {
        const file = Bun.file(path);
        if (await file.exists()) {
          wasmBytes = await file.arrayBuffer();
        }
      } catch {
        // Bun.file failed, try next method
      }
    }

    // Try Node.js fs module if Bun.file didn't work
    if (!wasmBytes) {
      try {
        const fs = await import('fs/promises');
        const buffer = await fs.readFile(path);
        wasmBytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      } catch {
        // fs failed, try fetch
      }
    }

    // Fall back to fetch (for browser environments)
    if (!wasmBytes) {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error(`Failed to fetch WASM: ${response.status} ${response.statusText}`);
      }
      wasmBytes = await response.arrayBuffer();
      if (wasmBytes.byteLength === 0) {
        throw new Error(`WASM file is empty (0 bytes). Check path: ${path}`);
      }
    }

    if (!wasmBytes) {
      throw new Error(`Could not load WASM from path: ${path}`);
    }

    const wasmModule = await WebAssembly.compile(wasmBytes);
    const wasmInstance = await WebAssembly.instantiate(wasmModule, {
      env: {
        log: (ptr: number, len: number) => {
          const bytes = new Uint8Array(
            (wasmInstance.exports as GhosttyWasmExports).memory.buffer,
            ptr,
            len
          );
          console.log('[ghostty-vt]', new TextDecoder().decode(bytes));
        },
      },
    });
    Ghostty.assertCompatibleWasm(wasmInstance.exports as GhosttyWasmExports);
    return new Ghostty(wasmInstance);
  }

  private static assertCompatibleWasm(exports: GhosttyWasmExports): void {
    for (const name of Ghostty.REQUIRED_EXPORTS) {
      if (!(name in exports) || typeof exports[name] === 'undefined') {
        throw new Error(
          `Incompatible ghostty-vt.wasm: missing required export "${String(name)}". ` +
            'Rebuild the WASM with `npm run build:wasm`.'
        );
      }
    }

    const handle = exports.ghostty_terminal_new_simple(2, 2);
    if (!handle) {
      throw new Error(
        'Incompatible ghostty-vt.wasm: failed to create a probe terminal. ' +
          'Rebuild the WASM with `npm run build:wasm`.'
      );
    }

    const probeText = 'A';
    const probeBytes = new TextEncoder().encode(probeText);
    const cellSize = 16;
    let inputPtr = 0;
    let viewportPtr = 0;

    try {
      inputPtr = exports.ghostty_wasm_alloc_u8_array(probeBytes.length);
      new Uint8Array(exports.memory.buffer).set(probeBytes, inputPtr);
      exports.ghostty_terminal_write(handle, inputPtr, probeBytes.length);

      const dirty = exports.ghostty_render_state_update(handle);
      if (dirty !== DirtyState.NONE && dirty !== DirtyState.PARTIAL && dirty !== DirtyState.FULL) {
        throw new Error(
          'Incompatible ghostty-vt.wasm: render_state_update returned an invalid dirty state. ' +
            'This usually means the browser shim ABI does not match the built WASM. ' +
            'Rebuild the WASM with `npm run build:wasm`.'
        );
      }

      viewportPtr = exports.ghostty_wasm_alloc_u8_array(4 * cellSize);
      const cellCount = exports.ghostty_render_state_get_viewport(handle, viewportPtr, 4);
      if (cellCount <= 0) {
        throw new Error(
          'Incompatible ghostty-vt.wasm: probe viewport read returned no cells. ' +
            'Rebuild the WASM with `npm run build:wasm`.'
        );
      }

      const firstCodepoint = new DataView(exports.memory.buffer, viewportPtr, cellSize).getUint32(
        0,
        true
      );
      if (firstCodepoint !== probeText.codePointAt(0)) {
        throw new Error(
          'Incompatible ghostty-vt.wasm: probe write did not update terminal state. ' +
            'Rebuild the WASM with `npm run build:wasm`.'
        );
      }
    } finally {
      if (viewportPtr) {
        exports.ghostty_wasm_free_u8_array(viewportPtr, 4 * cellSize);
      }
      if (inputPtr) {
        exports.ghostty_wasm_free_u8_array(inputPtr, probeBytes.length);
      }
      exports.ghostty_terminal_free_simple(handle);
    }
  }

  private readBuildInfoBool(field: GhosttyBuildInfoData): boolean {
    const ptr = this.exports.ghostty_wasm_alloc_u8();
    try {
      this.expectSuccess(field, this.exports.ghostty_build_info(field, ptr));
      return new DataView(this.memory.buffer).getUint8(ptr) !== 0;
    } finally {
      this.exports.ghostty_wasm_free_u8(ptr);
    }
  }

  private readBuildInfoUsize(field: GhosttyBuildInfoData): number {
    const ptr = this.exports.ghostty_wasm_alloc_usize();
    try {
      this.expectSuccess(field, this.exports.ghostty_build_info(field, ptr));
      return new DataView(this.memory.buffer).getUint32(ptr, true);
    } finally {
      this.exports.ghostty_wasm_free_usize(ptr);
    }
  }

  private readBuildInfoOptimize(field: GhosttyBuildInfoData): GhosttyOptimizeMode {
    const ptr = this.exports.ghostty_wasm_alloc_u8_array(4);
    try {
      this.expectSuccess(field, this.exports.ghostty_build_info(field, ptr));
      return new DataView(this.memory.buffer).getInt32(ptr, true) as GhosttyOptimizeMode;
    } finally {
      this.exports.ghostty_wasm_free_u8_array(ptr, 4);
    }
  }

  private readBuildInfoString(field: GhosttyBuildInfoData): string {
    const layout = this.getTypeLayouts().GhosttyString;
    if (!layout) {
      throw new Error('ghostty_type_json is missing GhosttyString layout metadata');
    }

    const ptrField = layout.fields.ptr;
    const lenField = layout.fields.len;
    if (!ptrField || !lenField) {
      throw new Error('ghostty_type_json is missing GhosttyString.ptr/len field metadata');
    }

    const structPtr = this.exports.ghostty_wasm_alloc_u8_array(layout.size);
    try {
      this.expectSuccess(field, this.exports.ghostty_build_info(field, structPtr));

      const view = new DataView(this.memory.buffer, structPtr, layout.size);
      const dataPtr = view.getUint32(ptrField.offset, true);
      const dataLen = view.getUint32(lenField.offset, true);
      if (dataLen === 0) {
        return '';
      }

      return this.readBytes(dataPtr, dataLen);
    } finally {
      this.exports.ghostty_wasm_free_u8_array(structPtr, layout.size);
    }
  }

  private readBytes(ptr: number, len: number): string {
    return new TextDecoder().decode(new Uint8Array(this.memory.buffer, ptr, len).slice());
  }

  private readCString(ptr: number): string {
    const bytes = new Uint8Array(this.memory.buffer);
    let end = ptr;
    while (end < bytes.length && bytes[end] !== 0) {
      end += 1;
    }

    return new TextDecoder().decode(bytes.slice(ptr, end));
  }

  private expectSuccess(field: GhosttyBuildInfoData, result: number): void {
    if (result !== GhosttyResult.SUCCESS) {
      throw new Error(`ghostty_build_info(${field}) failed with result ${result}`);
    }
  }
}

/**
 * Key Encoder - converts keyboard events into terminal escape sequences
 */
export class KeyEncoder {
  private exports: GhosttyWasmExports;
  private encoder: number = 0;

  constructor(exports: GhosttyWasmExports) {
    this.exports = exports;
    const encoderPtrPtr = this.exports.ghostty_wasm_alloc_opaque();
    const result = this.exports.ghostty_key_encoder_new(0, encoderPtrPtr);
    if (result !== 0) throw new Error(`Failed to create key encoder: ${result}`);
    const view = new DataView(this.exports.memory.buffer);
    this.encoder = view.getUint32(encoderPtrPtr, true);
    this.exports.ghostty_wasm_free_opaque(encoderPtrPtr);
  }

  setOption(option: KeyEncoderOption, value: boolean | number): void {
    const valuePtr = this.exports.ghostty_wasm_alloc_u8();
    const view = new DataView(this.exports.memory.buffer);
    view.setUint8(valuePtr, typeof value === 'boolean' ? (value ? 1 : 0) : value);
    this.exports.ghostty_key_encoder_setopt(this.encoder, option, valuePtr);
    this.exports.ghostty_wasm_free_u8(valuePtr);
  }

  setKittyFlags(flags: KittyKeyFlags): void {
    this.setOption(KeyEncoderOption.KITTY_KEYBOARD_FLAGS, flags);
  }

  syncFromTerminal(handle: TerminalHandle): void {
    this.exports.ghostty_key_encoder_setopt_from_terminal_simple(this.encoder, handle);
  }

  encode(event: KeyEvent): Uint8Array {
    const eventPtrPtr = this.exports.ghostty_wasm_alloc_opaque();
    const createResult = this.exports.ghostty_key_event_new(0, eventPtrPtr);
    if (createResult !== 0) throw new Error(`Failed to create key event: ${createResult}`);

    const view = new DataView(this.exports.memory.buffer);
    const eventPtr = view.getUint32(eventPtrPtr, true);
    this.exports.ghostty_wasm_free_opaque(eventPtrPtr);

    this.exports.ghostty_key_event_set_action(eventPtr, event.action);
    this.exports.ghostty_key_event_set_key(eventPtr, event.key);
    this.exports.ghostty_key_event_set_mods(eventPtr, event.mods);

    if (event.utf8) {
      const encoder = new TextEncoder();
      const utf8Bytes = encoder.encode(event.utf8);
      const utf8Ptr = this.exports.ghostty_wasm_alloc_u8_array(utf8Bytes.length);
      new Uint8Array(this.exports.memory.buffer).set(utf8Bytes, utf8Ptr);
      this.exports.ghostty_key_event_set_utf8(eventPtr, utf8Ptr, utf8Bytes.length);
      this.exports.ghostty_wasm_free_u8_array(utf8Ptr, utf8Bytes.length);
    }

    const bufferSize = 32;
    const bufPtr = this.exports.ghostty_wasm_alloc_u8_array(bufferSize);
    const writtenPtr = this.exports.ghostty_wasm_alloc_usize();

    const encodeResult = this.exports.ghostty_key_encoder_encode(
      this.encoder,
      eventPtr,
      bufPtr,
      bufferSize,
      writtenPtr
    );

    if (encodeResult !== 0) {
      this.exports.ghostty_wasm_free_u8_array(bufPtr, bufferSize);
      this.exports.ghostty_wasm_free_usize(writtenPtr);
      this.exports.ghostty_key_event_free(eventPtr);
      throw new Error(`Failed to encode key: ${encodeResult}`);
    }

    const bytesWritten = view.getUint32(writtenPtr, true);
    const encoded = new Uint8Array(this.exports.memory.buffer, bufPtr, bytesWritten).slice();

    this.exports.ghostty_wasm_free_u8_array(bufPtr, bufferSize);
    this.exports.ghostty_wasm_free_usize(writtenPtr);
    this.exports.ghostty_key_event_free(eventPtr);

    return encoded;
  }

  dispose(): void {
    if (this.encoder) {
      this.exports.ghostty_key_encoder_free(this.encoder);
      this.encoder = 0;
    }
  }
}

export class MouseEncoder {
  private static readonly SIZE_STRUCT_BYTES = 36;

  private exports: GhosttyWasmExports;
  private encoder: number = 0;
  private event: number = 0;
  private bufferPtr: number = 0;
  private bufferSize: number = 128;
  private writtenPtr: number = 0;

  constructor(exports: GhosttyWasmExports) {
    this.exports = exports;

    const encoderPtrPtr = this.exports.ghostty_wasm_alloc_opaque();
    const encoderResult = this.exports.ghostty_mouse_encoder_new(0, encoderPtrPtr);
    if (encoderResult !== GhosttyResult.SUCCESS) {
      throw new Error(`Failed to create mouse encoder: ${encoderResult}`);
    }

    const eventPtrPtr = this.exports.ghostty_wasm_alloc_opaque();
    const eventResult = this.exports.ghostty_mouse_event_new(0, eventPtrPtr);
    if (eventResult !== GhosttyResult.SUCCESS) {
      this.exports.ghostty_wasm_free_opaque(encoderPtrPtr);
      throw new Error(`Failed to create mouse event: ${eventResult}`);
    }

    const view = new DataView(this.exports.memory.buffer);
    this.encoder = view.getUint32(encoderPtrPtr, true);
    this.event = view.getUint32(eventPtrPtr, true);
    this.exports.ghostty_wasm_free_opaque(encoderPtrPtr);
    this.exports.ghostty_wasm_free_opaque(eventPtrPtr);

    this.bufferPtr = this.exports.ghostty_wasm_alloc_u8_array(this.bufferSize);
    this.writtenPtr = this.exports.ghostty_wasm_alloc_usize();
  }

  syncFromTerminal(handle: TerminalHandle): void {
    this.exports.ghostty_mouse_encoder_setopt_from_terminal_simple(this.encoder, handle);
  }

  reset(): void {
    this.exports.ghostty_mouse_encoder_reset(this.encoder);
  }

  setSize(size: MouseEncoderSize): void {
    const sizePtr = this.exports.ghostty_wasm_alloc_u8_array(MouseEncoder.SIZE_STRUCT_BYTES);
    try {
      const view = new DataView(this.exports.memory.buffer);
      view.setUint32(sizePtr + 0, MouseEncoder.SIZE_STRUCT_BYTES, true);
      view.setUint32(sizePtr + 4, Math.max(1, Math.round(size.screenWidth)), true);
      view.setUint32(sizePtr + 8, Math.max(1, Math.round(size.screenHeight)), true);
      view.setUint32(sizePtr + 12, Math.max(1, Math.round(size.cellWidth)), true);
      view.setUint32(sizePtr + 16, Math.max(1, Math.round(size.cellHeight)), true);
      view.setUint32(sizePtr + 20, Math.max(0, Math.round(size.paddingTop ?? 0)), true);
      view.setUint32(sizePtr + 24, Math.max(0, Math.round(size.paddingBottom ?? 0)), true);
      view.setUint32(sizePtr + 28, Math.max(0, Math.round(size.paddingRight ?? 0)), true);
      view.setUint32(sizePtr + 32, Math.max(0, Math.round(size.paddingLeft ?? 0)), true);
      this.exports.ghostty_mouse_encoder_setopt(this.encoder, 2, sizePtr);
    } finally {
      this.exports.ghostty_wasm_free_u8_array(sizePtr, MouseEncoder.SIZE_STRUCT_BYTES);
    }
  }

  setAnyButtonPressed(value: boolean): void {
    const ptr = this.exports.ghostty_wasm_alloc_u8();
    try {
      new Uint8Array(this.exports.memory.buffer)[ptr] = value ? 1 : 0;
      this.exports.ghostty_mouse_encoder_setopt(this.encoder, 3, ptr);
    } finally {
      this.exports.ghostty_wasm_free_u8(ptr);
    }
  }

  encode(event: MouseEventData): Uint8Array {
    this.exports.ghostty_mouse_event_set_action(this.event, event.action);
    if (event.button === undefined) {
      this.exports.ghostty_mouse_event_clear_button(this.event);
    } else {
      this.exports.ghostty_mouse_event_set_button(this.event, event.button);
    }
    this.exports.ghostty_mouse_event_set_mods(this.event, event.mods);
    this.exports.ghostty_mouse_event_set_position_xy(this.event, event.x, event.y);

    let result = this.exports.ghostty_mouse_encoder_encode(
      this.encoder,
      this.event,
      this.bufferPtr,
      this.bufferSize,
      this.writtenPtr
    );

    if (result === GhosttyResult.OUT_OF_SPACE) {
      const neededSize = new DataView(this.exports.memory.buffer).getUint32(this.writtenPtr, true);
      this.resizeBuffer(neededSize);
      result = this.exports.ghostty_mouse_encoder_encode(
        this.encoder,
        this.event,
        this.bufferPtr,
        this.bufferSize,
        this.writtenPtr
      );
    }

    if (result !== GhosttyResult.SUCCESS) {
      throw new Error(`Failed to encode mouse event: ${result}`);
    }

    const bytesWritten = new DataView(this.exports.memory.buffer).getUint32(this.writtenPtr, true);
    return new Uint8Array(this.exports.memory.buffer, this.bufferPtr, bytesWritten).slice();
  }

  dispose(): void {
    if (this.bufferPtr) {
      this.exports.ghostty_wasm_free_u8_array(this.bufferPtr, this.bufferSize);
      this.bufferPtr = 0;
    }
    if (this.writtenPtr) {
      this.exports.ghostty_wasm_free_usize(this.writtenPtr);
      this.writtenPtr = 0;
    }
    if (this.event) {
      this.exports.ghostty_mouse_event_free(this.event);
      this.event = 0;
    }
    if (this.encoder) {
      this.exports.ghostty_mouse_encoder_free(this.encoder);
      this.encoder = 0;
    }
  }

  private resizeBuffer(nextSize: number): void {
    if (this.bufferPtr) {
      this.exports.ghostty_wasm_free_u8_array(this.bufferPtr, this.bufferSize);
    }
    this.bufferSize = Math.max(this.bufferSize * 2, nextSize);
    this.bufferPtr = this.exports.ghostty_wasm_alloc_u8_array(this.bufferSize);
  }
}

/**
 * GhosttyTerminal - High-performance terminal emulator
 *
 * Uses Ghostty's native RenderState for optimal performance:
 * - ONE call to update all state (renderStateUpdate)
 * - ONE call to get all cells (getViewport)
 * - No per-row WASM boundary crossings!
 */
export class GhosttyTerminal {
  private exports: GhosttyWasmExports;
  private memory: WebAssembly.Memory;
  private typeLayouts: GhosttyTypeLayouts;
  private handle: TerminalHandle;
  private _cols: number;
  private _rows: number;

  /** Size of GhosttyCell in WASM (16 bytes) */
  private static readonly CELL_SIZE = 16;
  private static readonly KITTY_PLACEMENT_SIZE = 72;
  private static readonly KITTY_PLACEMENT_FIELDS = {
    image_id: 0,
    placement_id: 4,
    z: 8,
    viewport_x: 12,
    viewport_y: 16,
    x_offset: 20,
    y_offset: 24,
    pixel_width: 28,
    pixel_height: 32,
    source_x: 36,
    source_y: 40,
    source_width: 44,
    source_height: 48,
    image_width: 52,
    image_height: 56,
    format: 60,
    compression: 61,
    data_ptr: 64,
    data_len: 68,
  } as const;

  /** Reusable buffer for viewport operations */
  private viewportBufferPtr: number = 0;
  private viewportBufferSize: number = 0;

  /** Cell pool for zero-allocation rendering */
  private cellPool: GhosttyCell[] = [];
  private lastDirtyState: DirtyState = DirtyState.NONE;
  private kittyGraphicsPlacements: GhosttyKittyImagePlacement[] = [];
  private kittyGraphicsPlacementsViewportTop: number = 0;
  private kittyGraphicsPlacementsDirty: boolean = true;
  private kittyPlacementBufferPtr: number = 0;
  private kittyPlacementBufferSize: number = 0;

  constructor(
    exports: GhosttyWasmExports,
    memory: WebAssembly.Memory,
    typeLayouts: GhosttyTypeLayouts,
    cols: number = 80,
    rows: number = 24,
    config?: GhosttyTerminalConfig
  ) {
    this.exports = exports;
    this.memory = memory;
    this.typeLayouts = typeLayouts;
    this._cols = cols;
    this._rows = rows;

    if (config) {
      // Allocate config struct in WASM memory
      const configPtr = this.exports.ghostty_wasm_alloc_u8_array(GHOSTTY_CONFIG_SIZE);
      if (configPtr === 0) {
        throw new Error('Failed to allocate config (out of memory)');
      }

      try {
        // Write config to WASM memory
        const view = new DataView(this.memory.buffer);
        let offset = configPtr;

        // scrollback_limit (u32)
        view.setUint32(offset, config.scrollbackLimit ?? 10000, true);
        offset += 4;

        // fg_color (u32)
        view.setUint32(offset, config.fgColor ?? 0, true);
        offset += 4;

        // bg_color (u32)
        view.setUint32(offset, config.bgColor ?? 0, true);
        offset += 4;

        // cursor_color (u32)
        view.setUint32(offset, config.cursorColor ?? 0, true);
        offset += 4;

        // palette[16] (u32 * 16)
        for (let i = 0; i < 16; i++) {
          view.setUint32(offset, config.palette?.[i] ?? 0, true);
          offset += 4;
        }

        this.handle = this.exports.ghostty_terminal_new_with_config(cols, rows, configPtr);
      } finally {
        // Free the config memory
        this.exports.ghostty_wasm_free_u8_array(configPtr, GHOSTTY_CONFIG_SIZE);
      }
    } else {
      this.handle = this.exports.ghostty_terminal_new_simple(cols, rows);
    }

    if (!this.handle) throw new Error('Failed to create terminal');

    if (config?.kittyImageStorageLimit !== undefined) {
      this.setKittyImageStorageLimit(config.kittyImageStorageLimit);
    }

    this.initCellPool();
  }

  get cols(): number {
    return this._cols;
  }
  get rows(): number {
    return this._rows;
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  write(data: string | Uint8Array): void {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const ptr = this.exports.ghostty_wasm_alloc_u8_array(bytes.length);
    new Uint8Array(this.memory.buffer).set(bytes, ptr);
    this.exports.ghostty_terminal_write(this.handle, ptr, bytes.length);
    this.exports.ghostty_wasm_free_u8_array(ptr, bytes.length);
  }

  encodePaste(data: string, bracketed: boolean): string {
    const bytes = new TextEncoder().encode(data);
    const inputPtr = this.exports.ghostty_wasm_alloc_u8_array(bytes.length);
    const writtenPtr = this.exports.ghostty_wasm_alloc_usize();
    let outputPtr = 0;
    let outputLen = 0;

    try {
      if (bytes.length > 0) {
        new Uint8Array(this.memory.buffer).set(bytes, inputPtr);
      }

      let result = this.exports.ghostty_paste_encode(
        inputPtr,
        bytes.length,
        bracketed,
        0,
        0,
        writtenPtr
      );
      outputLen = new DataView(this.memory.buffer).getUint32(writtenPtr, true);

      if (result !== GhosttyResult.SUCCESS && result !== GhosttyResult.OUT_OF_SPACE) {
        throw new Error(`Failed to size paste payload: ${result}`);
      }

      if (outputLen === 0) {
        return '';
      }

      outputPtr = this.exports.ghostty_wasm_alloc_u8_array(outputLen);
      result = this.exports.ghostty_paste_encode(
        inputPtr,
        bytes.length,
        bracketed,
        outputPtr,
        outputLen,
        writtenPtr
      );

      if (result !== GhosttyResult.SUCCESS) {
        throw new Error(`Failed to encode paste payload: ${result}`);
      }

      const bytesWritten = new DataView(this.memory.buffer).getUint32(writtenPtr, true);
      const encoded = new Uint8Array(this.memory.buffer, outputPtr, bytesWritten);
      return new TextDecoder().decode(encoded.slice());
    } finally {
      if (outputPtr) {
        this.exports.ghostty_wasm_free_u8_array(outputPtr, outputLen);
      }
      this.exports.ghostty_wasm_free_usize(writtenPtr);
      this.exports.ghostty_wasm_free_u8_array(inputPtr, bytes.length);
    }
  }

  resize(cols: number, rows: number, cellWidthPx?: number, cellHeightPx?: number): void {
    const normalizedCellWidth = this.normalizeCellSize(cellWidthPx);
    const normalizedCellHeight = this.normalizeCellSize(cellHeightPx);
    const dimensionsChanged = cols !== this._cols || rows !== this._rows;
    const canSyncCellSize = normalizedCellWidth !== null && normalizedCellHeight !== null;
    if (!dimensionsChanged && !canSyncCellSize) return;
    this._cols = cols;
    this._rows = rows;
    if (canSyncCellSize) {
      this.exports.ghostty_terminal_resize_with_cell_size_simple(
        this.handle,
        cols,
        rows,
        normalizedCellWidth,
        normalizedCellHeight
      );
    } else {
      this.exports.ghostty_terminal_resize_simple(this.handle, cols, rows);
    }
    this.invalidateBuffers();
    this.initCellPool();
  }

  free(): void {
    if (this.viewportBufferPtr) {
      this.exports.ghostty_wasm_free_u8_array(this.viewportBufferPtr, this.viewportBufferSize);
      this.viewportBufferPtr = 0;
    }
    this.exports.ghostty_terminal_free_simple(this.handle);
  }

  syncKeyEncoder(encoder: KeyEncoder): void {
    encoder.syncFromTerminal(this.handle);
  }

  syncMouseEncoder(encoder: MouseEncoder): void {
    encoder.syncFromTerminal(this.handle);
  }

  setKittyImageStorageLimit(limit: number): void {
    const normalized = Math.max(0, Math.floor(limit));
    const ptr = this.exports.ghostty_wasm_alloc_u8_array(8);

    try {
      new DataView(this.memory.buffer).setBigUint64(ptr, BigInt(normalized), true);
      this.expectResult(
        'ghostty_terminal_set_kitty_image_storage_limit',
        this.exports.ghostty_terminal_set_kitty_image_storage_limit(this.handle, ptr)
      );
    } finally {
      this.exports.ghostty_wasm_free_u8_array(ptr, 8);
    }
  }

  format(options: GhosttyFormatterOptions): string {
    const formatterOptionsLayout = this.getStructLayout('GhosttyFormatterTerminalOptions');
    const formatterExtraLayout = this.getStructLayout('GhosttyFormatterTerminalExtra');
    const screenExtraLayout = this.getStructLayout('GhosttyFormatterScreenExtra');
    const selectionLayout = this.getStructLayout('GhosttySelection');
    const gridRefLayout = this.getStructLayout('GhosttyGridRef');
    const pointLayout = this.getStructLayout('GhosttyPoint');
    const formatterOptionsPtr = this.exports.ghostty_wasm_alloc_u8_array(
      formatterOptionsLayout.size
    );
    const selectionPtr = options.selection
      ? this.exports.ghostty_wasm_alloc_u8_array(selectionLayout.size)
      : 0;
    const startPointPtr = options.selection
      ? this.exports.ghostty_wasm_alloc_u8_array(pointLayout.size)
      : 0;
    const endPointPtr = options.selection
      ? this.exports.ghostty_wasm_alloc_u8_array(pointLayout.size)
      : 0;
    const startRefPtr = options.selection
      ? this.exports.ghostty_wasm_alloc_u8_array(gridRefLayout.size)
      : 0;
    const endRefPtr = options.selection
      ? this.exports.ghostty_wasm_alloc_u8_array(gridRefLayout.size)
      : 0;

    try {
      this.zeroMemory(formatterOptionsPtr, formatterOptionsLayout.size);

      const optionsView = new DataView(
        this.memory.buffer,
        formatterOptionsPtr,
        formatterOptionsLayout.size
      );
      const extraPtr = formatterOptionsPtr + formatterOptionsLayout.fields.extra.offset;
      const extraView = new DataView(this.memory.buffer, extraPtr, formatterExtraLayout.size);
      const screenExtraPtr = extraPtr + formatterExtraLayout.fields.screen.offset;
      const screenView = new DataView(this.memory.buffer, screenExtraPtr, screenExtraLayout.size);

      optionsView.setUint32(
        formatterOptionsLayout.fields.size.offset,
        formatterOptionsLayout.size,
        true
      );
      optionsView.setInt32(formatterOptionsLayout.fields.emit.offset, options.format, true);
      optionsView.setUint8(formatterOptionsLayout.fields.unwrap.offset, options.unwrap ? 1 : 0);
      optionsView.setUint8(
        formatterOptionsLayout.fields.trim.offset,
        (options.trim ?? true) ? 1 : 0
      );

      extraView.setUint32(formatterExtraLayout.fields.size.offset, formatterExtraLayout.size, true);
      screenView.setUint32(screenExtraLayout.fields.size.offset, screenExtraLayout.size, true);

      if (options.includeTerminalState && options.format !== GhosttyFormatterFormat.PLAIN) {
        extraView.setUint8(formatterExtraLayout.fields.palette.offset, 1);
        extraView.setUint8(formatterExtraLayout.fields.modes.offset, 1);
        extraView.setUint8(formatterExtraLayout.fields.scrolling_region.offset, 1);
        extraView.setUint8(formatterExtraLayout.fields.tabstops.offset, 1);
        extraView.setUint8(formatterExtraLayout.fields.pwd.offset, 1);
        extraView.setUint8(formatterExtraLayout.fields.keyboard.offset, 1);
        screenView.setUint8(screenExtraLayout.fields.cursor.offset, 1);
        screenView.setUint8(screenExtraLayout.fields.style.offset, 1);
        screenView.setUint8(screenExtraLayout.fields.hyperlink.offset, 1);
        screenView.setUint8(screenExtraLayout.fields.protection.offset, 1);
        screenView.setUint8(screenExtraLayout.fields.kitty_keyboard.offset, 1);
        screenView.setUint8(screenExtraLayout.fields.charsets.offset, 1);
      }

      if (
        options.selection &&
        selectionPtr &&
        startPointPtr &&
        endPointPtr &&
        startRefPtr &&
        endRefPtr
      ) {
        this.writePoint(
          startPointPtr,
          GhosttyPointTag.SCREEN,
          options.selection.start.x,
          options.selection.start.y
        );
        this.writePoint(
          endPointPtr,
          GhosttyPointTag.SCREEN,
          options.selection.end.x,
          options.selection.end.y
        );
        this.expectResult(
          'ghostty_terminal_grid_ref_ptr(start)',
          this.exports.ghostty_terminal_grid_ref_ptr(this.handle, startPointPtr, startRefPtr)
        );
        this.expectResult(
          'ghostty_terminal_grid_ref_ptr(end)',
          this.exports.ghostty_terminal_grid_ref_ptr(this.handle, endPointPtr, endRefPtr)
        );

        this.zeroMemory(selectionPtr, selectionLayout.size);
        const selectionView = new DataView(this.memory.buffer, selectionPtr, selectionLayout.size);
        selectionView.setUint32(selectionLayout.fields.size.offset, selectionLayout.size, true);
        this.copyMemory(
          selectionPtr + selectionLayout.fields.start.offset,
          startRefPtr,
          gridRefLayout.size
        );
        this.copyMemory(
          selectionPtr + selectionLayout.fields.end.offset,
          endRefPtr,
          gridRefLayout.size
        );
        selectionView.setUint8(
          selectionLayout.fields.rectangle.offset,
          options.selection.rectangle ? 1 : 0
        );
        this.writePointer(
          optionsView,
          formatterOptionsLayout.fields.selection.offset,
          selectionPtr
        );
      }

      return this.readFormattedTerminalOutput(formatterOptionsPtr);
    } finally {
      if (endRefPtr) this.exports.ghostty_wasm_free_u8_array(endRefPtr, gridRefLayout.size);
      if (startRefPtr) this.exports.ghostty_wasm_free_u8_array(startRefPtr, gridRefLayout.size);
      if (endPointPtr) this.exports.ghostty_wasm_free_u8_array(endPointPtr, pointLayout.size);
      if (startPointPtr) this.exports.ghostty_wasm_free_u8_array(startPointPtr, pointLayout.size);
      if (selectionPtr) this.exports.ghostty_wasm_free_u8_array(selectionPtr, selectionLayout.size);
      this.exports.ghostty_wasm_free_u8_array(formatterOptionsPtr, formatterOptionsLayout.size);
    }
  }

  // ==========================================================================
  // RenderState API - The key performance optimization
  // ==========================================================================

  /**
   * Update render state from terminal.
   *
   * This syncs the RenderState with the current Terminal state.
   * The dirty state (full/partial/none) is stored in the WASM RenderState
   * and can be queried via isRowDirty(). When dirty==full, isRowDirty()
   * returns true for ALL rows.
   *
   * The WASM layer automatically detects screen switches (normal <-> alternate)
   * and returns FULL dirty state when switching screens (e.g., vim exit).
   *
   * Safe to call multiple times - dirty state persists until markClean().
   */
  update(): DirtyState {
    this.lastDirtyState = this.exports.ghostty_render_state_update(this.handle) as DirtyState;
    return this.lastDirtyState;
  }

  /**
   * Refresh render state once at the start of a render frame.
   */
  prepareRenderState(): void {
    this.update();
    if (this.lastDirtyState !== DirtyState.NONE) {
      this.kittyGraphicsPlacementsDirty = true;
    }
  }

  /**
   * Get cursor state from render state.
   * Ensures render state is fresh by calling update().
   */
  getCursor(): RenderStateCursor {
    // Call update() to ensure render state is fresh.
    // This is safe to call multiple times - dirty state persists until markClean().
    this.update();
    return this.getCursorFromRenderState();
  }

  /**
   * Get cursor state from the most recently refreshed render state.
   * Call update() first to guarantee freshness.
   */
  getCursorFromRenderState(): RenderStateCursor {
    return {
      x: this.exports.ghostty_render_state_get_cursor_x(this.handle),
      y: this.exports.ghostty_render_state_get_cursor_y(this.handle),
      viewportX: this.exports.ghostty_render_state_get_cursor_x(this.handle),
      viewportY: this.exports.ghostty_render_state_get_cursor_y(this.handle),
      visible: this.exports.ghostty_render_state_get_cursor_visible(this.handle),
      blinking: false, // TODO: Add blinking support
      style: 'block', // TODO: Add style support
    };
  }

  /**
   * Get default colors from render state
   */
  getColors(): RenderStateColors {
    this.update();
    const bg = this.exports.ghostty_render_state_get_bg_color(this.handle);
    const fg = this.exports.ghostty_render_state_get_fg_color(this.handle);
    return {
      background: {
        r: (bg >> 16) & 0xff,
        g: (bg >> 8) & 0xff,
        b: bg & 0xff,
      },
      foreground: {
        r: (fg >> 16) & 0xff,
        g: (fg >> 8) & 0xff,
        b: fg & 0xff,
      },
      cursor: (() => {
        const c = this.exports.ghostty_render_state_get_cursor_color(this.handle);
        if (c === 0) return null;
        return { r: (c >> 16) & 0xff, g: (c >> 8) & 0xff, b: c & 0xff };
      })(),
    };
  }

  /**
   * Get dynamic cursor color set by OSC 12, or null for theme default.
   */
  getDynamicCursorColor(): string | null {
    const c = this.exports.ghostty_render_state_get_cursor_color(this.handle);
    if (c === 0) return null;
    const r = (c >> 16) & 0xff;
    const g = (c >> 8) & 0xff;
    const b = c & 0xff;
    return `rgb(${r},${g},${b})`;
  }

  /**
   * Check if a specific row is dirty
   */
  isRowDirty(y: number): boolean {
    return this.exports.ghostty_render_state_is_row_dirty(this.handle, y);
  }

  /**
   * Mark render state as clean (call after rendering)
   */
  markClean(): void {
    this.exports.ghostty_render_state_mark_clean(this.handle);
  }

  /**
   * Get ALL viewport cells in ONE WASM call - the key performance optimization!
   * Returns a reusable cell array (zero allocation after warmup).
   */
  getViewport(): GhosttyCell[] {
    this.update();
    return this.getViewportFromRenderState();
  }

  /**
   * Get all viewport cells from the most recently refreshed render state.
   * Call update() first to guarantee freshness.
   */
  getViewportFromRenderState(): GhosttyCell[] {
    const totalCells = this._cols * this._rows;
    const neededSize = totalCells * GhosttyTerminal.CELL_SIZE;

    // Ensure buffer is allocated
    if (!this.viewportBufferPtr || this.viewportBufferSize < neededSize) {
      if (this.viewportBufferPtr) {
        this.exports.ghostty_wasm_free_u8_array(this.viewportBufferPtr, this.viewportBufferSize);
      }
      this.viewportBufferPtr = this.exports.ghostty_wasm_alloc_u8_array(neededSize);
      this.viewportBufferSize = neededSize;
    }

    // Get all cells in one call
    const count = this.exports.ghostty_render_state_get_viewport(
      this.handle,
      this.viewportBufferPtr,
      totalCells
    );

    if (count < 0) return this.cellPool;

    // Parse cells into pool (reuses existing objects)
    this.parseCellsIntoPool(this.viewportBufferPtr, totalCells);
    return this.cellPool;
  }

  getKittyGraphicsPlacements(): readonly GhosttyKittyImagePlacement[] {
    this.update();
    if (this.lastDirtyState !== DirtyState.NONE) {
      this.kittyGraphicsPlacementsDirty = true;
    }
    return this.getKittyGraphicsPlacementsFromRenderState(0);
  }

  getKittyGraphicsPlacementsFromRenderState(
    viewportTop: number = 0
  ): readonly GhosttyKittyImagePlacement[] {
    const normalizedViewportTop = Math.max(0, Math.floor(viewportTop));
    if (
      this.kittyGraphicsPlacementsDirty ||
      this.kittyGraphicsPlacementsViewportTop !== normalizedViewportTop
    ) {
      this.refreshKittyGraphicsPlacements(normalizedViewportTop);
    }
    return this.kittyGraphicsPlacements;
  }

  // ==========================================================================
  // Compatibility methods (delegate to render state)
  // ==========================================================================

  /**
   * Get line - for compatibility, extracts from viewport.
   * Ensures render state is fresh by calling update().
   * Returns a COPY of the cells to avoid pool reference issues.
   */
  getLine(y: number): GhosttyCell[] | null {
    if (y < 0 || y >= this._rows) return null;
    // Call update() to ensure render state is fresh.
    // This is safe to call multiple times - dirty state persists until markClean().
    this.update();
    return this.getLineFromRenderState(y);
  }

  /**
   * Get line data from the most recently refreshed render state.
   * Call update() first to guarantee freshness.
   */
  getLineFromRenderState(y: number): GhosttyCell[] | null {
    if (y < 0 || y >= this._rows) return null;
    const viewport = this.getViewportFromRenderState();
    const start = y * this._cols;
    // Return deep copies to avoid cell pool reference issues
    return viewport.slice(start, start + this._cols).map((cell) => ({ ...cell }));
  }

  /** For compatibility with old API */
  isDirty(): boolean {
    return this.update() !== DirtyState.NONE;
  }

  /**
   * Check if a full redraw is needed (screen change, resize, etc.)
   * Note: This calls update() to ensure fresh state. Safe to call multiple times.
   */
  needsFullRedraw(): boolean {
    return this.update() === DirtyState.FULL;
  }

  /**
   * Check if the last render-state refresh requested a full redraw.
   */
  needsFullRedrawFromRenderState(): boolean {
    return this.lastDirtyState === DirtyState.FULL;
  }

  /** Mark render state as clean after rendering */
  clearDirty(): void {
    this.markClean();
  }

  // ==========================================================================
  // Terminal modes
  // ==========================================================================

  isAlternateScreen(): boolean {
    return !!this.exports.ghostty_terminal_is_alternate_screen(this.handle);
  }

  hasBracketedPaste(): boolean {
    // Mode 2004 = bracketed paste (DEC mode)
    return this.getMode(2004, false);
  }

  hasFocusEvents(): boolean {
    // Mode 1004 = focus events (DEC mode)
    return this.getMode(1004, false);
  }

  hasMouseTracking(): boolean {
    return this.exports.ghostty_terminal_has_mouse_tracking(this.handle) !== 0;
  }

  // ==========================================================================
  // Extended API (scrollback, modes, etc.)
  // ==========================================================================

  /** Get dimensions - for compatibility */
  getDimensions(): { cols: number; rows: number } {
    return { cols: this._cols, rows: this._rows };
  }

  /** Get number of scrollback lines (history, not including active screen) */
  getScrollbackLength(): number {
    return this.exports.ghostty_terminal_get_scrollback_length(this.handle);
  }

  /**
   * Get a line from the scrollback buffer.
   * Ensures render state is fresh by calling update().
   * @param offset 0 = oldest line, (length-1) = most recent scrollback line
   */
  getScrollbackLine(offset: number): GhosttyCell[] | null {
    // Call update() to ensure render state is fresh (needed for colors).
    // This is safe to call multiple times - dirty state persists until markClean().
    this.update();
    return this.getScrollbackLineFromRenderState(offset);
  }

  /**
   * Get a scrollback line without refreshing render state again.
   * Call update() first to guarantee freshness.
   */
  getScrollbackLineFromRenderState(offset: number): GhosttyCell[] | null {
    const neededSize = this._cols * GhosttyTerminal.CELL_SIZE;

    // Ensure buffer is allocated
    if (!this.viewportBufferPtr || this.viewportBufferSize < neededSize) {
      if (this.viewportBufferPtr) {
        this.exports.ghostty_wasm_free_u8_array(this.viewportBufferPtr, this.viewportBufferSize);
      }
      this.viewportBufferPtr = this.exports.ghostty_wasm_alloc_u8_array(neededSize);
      this.viewportBufferSize = neededSize;
    }

    const count = this.exports.ghostty_terminal_get_scrollback_line(
      this.handle,
      offset,
      this.viewportBufferPtr,
      this._cols
    );

    if (count < 0) return null;

    // Parse cells
    const cells: GhosttyCell[] = [];
    const buffer = this.memory.buffer;
    const u8 = new Uint8Array(buffer, this.viewportBufferPtr, count * GhosttyTerminal.CELL_SIZE);
    const view = new DataView(buffer, this.viewportBufferPtr, count * GhosttyTerminal.CELL_SIZE);

    for (let i = 0; i < count; i++) {
      const cellOffset = i * GhosttyTerminal.CELL_SIZE;
      cells.push({
        codepoint: view.getUint32(cellOffset, true),
        fg_r: u8[cellOffset + 4],
        fg_g: u8[cellOffset + 5],
        fg_b: u8[cellOffset + 6],
        bg_r: u8[cellOffset + 7],
        bg_g: u8[cellOffset + 8],
        bg_b: u8[cellOffset + 9],
        flags: u8[cellOffset + 10],
        width: u8[cellOffset + 11],
        hyperlink_id: view.getUint16(cellOffset + 12, true),
        grapheme_len: u8[cellOffset + 14],
      });
    }

    return cells;
  }

  /** Check if a row in the active screen is wrapped (soft-wrapped to next line) */
  isRowWrapped(row: number): boolean {
    return this.exports.ghostty_terminal_is_row_wrapped(this.handle, row) !== 0;
  }

  /**
   * Get the hyperlink URI for a cell at the given position.
   * @param row Row index (0-based, in active viewport)
   * @param col Column index (0-based)
   * @returns The URI string, or null if no hyperlink at that position
   */
  getHyperlinkUri(row: number, col: number): string | null {
    // Check if WASM has this function (requires rebuilt WASM with hyperlink support)
    if (!this.exports.ghostty_terminal_get_hyperlink_uri) {
      return null;
    }

    // Try with initial buffer, retry with larger if needed (for very long URLs)
    const bufferSizes = [2048, 8192, 32768];

    for (const bufSize of bufferSizes) {
      const bufPtr = this.exports.ghostty_wasm_alloc_u8_array(bufSize);

      try {
        const bytesWritten = this.exports.ghostty_terminal_get_hyperlink_uri(
          this.handle,
          row,
          col,
          bufPtr,
          bufSize
        );

        // 0 means no hyperlink at this position
        if (bytesWritten === 0) return null;

        // -1 means buffer too small, try next size
        if (bytesWritten === -1) continue;

        // Negative values other than -1 are errors
        if (bytesWritten < 0) return null;

        const bytes = new Uint8Array(this.memory.buffer, bufPtr, bytesWritten);
        return new TextDecoder().decode(bytes.slice());
      } finally {
        this.exports.ghostty_wasm_free_u8_array(bufPtr, bufSize);
      }
    }

    // URI too long even for largest buffer
    return null;
  }

  /**
   * Get the hyperlink URI for a cell in the scrollback buffer.
   * @param offset Scrollback line offset (0 = oldest, scrollback_len-1 = newest)
   * @param col Column index (0-based)
   * @returns The URI string, or null if no hyperlink at that position
   */
  getScrollbackHyperlinkUri(offset: number, col: number): string | null {
    // Check if WASM has this function
    if (!this.exports.ghostty_terminal_get_scrollback_hyperlink_uri) {
      return null;
    }

    // Try with initial buffer, retry with larger if needed (for very long URLs)
    const bufferSizes = [2048, 8192, 32768];

    for (const bufSize of bufferSizes) {
      const bufPtr = this.exports.ghostty_wasm_alloc_u8_array(bufSize);

      try {
        const bytesWritten = this.exports.ghostty_terminal_get_scrollback_hyperlink_uri(
          this.handle,
          offset,
          col,
          bufPtr,
          bufSize
        );

        // 0 means no hyperlink at this position
        if (bytesWritten === 0) return null;

        // -1 means buffer too small, try next size
        if (bytesWritten === -1) continue;

        // Negative values other than -1 are errors
        if (bytesWritten < 0) return null;

        const bytes = new Uint8Array(this.memory.buffer, bufPtr, bytesWritten);
        return new TextDecoder().decode(bytes.slice());
      } finally {
        this.exports.ghostty_wasm_free_u8_array(bufPtr, bufSize);
      }
    }

    // URI too long even for largest buffer
    return null;
  }

  /**
   * Check if there are pending responses from the terminal.
   * Responses are generated by escape sequences like DSR (Device Status Report).
   */
  hasResponse(): boolean {
    return this.exports.ghostty_terminal_has_response(this.handle);
  }

  /**
   * Read pending responses from the terminal.
   * Returns the response string, or null if no responses pending.
   *
   * Responses are generated by escape sequences that require replies:
   * - DSR 6 (cursor position): Returns \x1b[row;colR
   * - DSR 5 (operating status): Returns \x1b[0n
   */
  readResponse(): string | null {
    if (!this.hasResponse()) return null;

    const bufSize = 256; // Most responses are small
    const bufPtr = this.exports.ghostty_wasm_alloc_u8_array(bufSize);

    try {
      const bytesRead = this.exports.ghostty_terminal_read_response(this.handle, bufPtr, bufSize);

      if (bytesRead <= 0) return null;

      const bytes = new Uint8Array(this.memory.buffer, bufPtr, bytesRead);
      return new TextDecoder().decode(bytes.slice());
    } finally {
      this.exports.ghostty_wasm_free_u8_array(bufPtr, bufSize);
    }
  }

  readBellCount(): number {
    return this.exports.ghostty_terminal_read_bell_count(this.handle);
  }

  hasTitleChange(): boolean {
    return this.exports.ghostty_terminal_has_title_change(this.handle);
  }

  readTitleChange(): string | null {
    if (!this.hasTitleChange()) return null;

    const bufferSizes = [256, 1024, 4096];

    for (const bufSize of bufferSizes) {
      const bufPtr = this.exports.ghostty_wasm_alloc_u8_array(bufSize);

      try {
        const bytesRead = this.exports.ghostty_terminal_read_title_change(
          this.handle,
          bufPtr,
          bufSize
        );

        if (bytesRead === -1) continue;
        if (bytesRead < 0) return null;
        if (bytesRead === 0) return '';

        const bytes = new Uint8Array(this.memory.buffer, bufPtr, bytesRead);
        return new TextDecoder().decode(bytes.slice());
      } finally {
        this.exports.ghostty_wasm_free_u8_array(bufPtr, bufSize);
      }
    }

    return null;
  }

  /**
   * Query arbitrary terminal mode by number
   * @param mode Mode number (e.g., 25 for cursor visibility, 2004 for bracketed paste)
   * @param isAnsi True for ANSI modes, false for DEC modes (default: false)
   */
  getMode(mode: number, isAnsi: boolean = false): boolean {
    return this.exports.ghostty_terminal_get_mode(this.handle, mode, isAnsi) !== 0;
  }

  private refreshKittyGraphicsPlacements(viewportTop: number = 0): void {
    const count = this.exports.ghostty_terminal_get_kitty_graphics_placements_in_viewport(
      this.handle,
      viewportTop,
      0,
      0
    );
    if (count <= 0) {
      this.kittyGraphicsPlacements = [];
      this.kittyGraphicsPlacementsViewportTop = viewportTop;
      this.kittyGraphicsPlacementsDirty = false;
      return;
    }

    const placementSize = GhosttyTerminal.KITTY_PLACEMENT_SIZE;
    const neededSize = count * placementSize;
    if (!this.kittyPlacementBufferPtr || this.kittyPlacementBufferSize < neededSize) {
      if (this.kittyPlacementBufferPtr) {
        this.exports.ghostty_wasm_free_u8_array(
          this.kittyPlacementBufferPtr,
          this.kittyPlacementBufferSize
        );
      }
      this.kittyPlacementBufferPtr = this.exports.ghostty_wasm_alloc_u8_array(neededSize);
      this.kittyPlacementBufferSize = neededSize;
    }

    const written = this.exports.ghostty_terminal_get_kitty_graphics_placements_in_viewport(
      this.handle,
      viewportTop,
      this.kittyPlacementBufferPtr,
      count
    );
    if (written <= 0) {
      this.kittyGraphicsPlacements = [];
      this.kittyGraphicsPlacementsViewportTop = viewportTop;
      this.kittyGraphicsPlacementsDirty = false;
      return;
    }

    const view = new DataView(
      this.memory.buffer,
      this.kittyPlacementBufferPtr,
      written * placementSize
    );
    const field = GhosttyTerminal.KITTY_PLACEMENT_FIELDS;
    const placements: GhosttyKittyImagePlacement[] = [];

    for (let i = 0; i < written; i++) {
      const offset = i * placementSize;
      const dataPtr = view.getUint32(offset + field.data_ptr, true);
      const dataLen = view.getUint32(offset + field.data_len, true);
      const data = dataLen
        ? new Uint8ClampedArray(new Uint8Array(this.memory.buffer, dataPtr, dataLen).slice().buffer)
        : new Uint8ClampedArray();
      const z = view.getInt32(offset + field.z, true);
      placements.push({
        imageId: view.getUint32(offset + field.image_id, true),
        placementId: view.getUint32(offset + field.placement_id, true),
        z,
        layer: this.getKittyPlacementLayer(z),
        viewportX: view.getInt32(offset + field.viewport_x, true),
        viewportY: view.getInt32(offset + field.viewport_y, true),
        xOffset: view.getUint32(offset + field.x_offset, true),
        yOffset: view.getUint32(offset + field.y_offset, true),
        pixelWidth: view.getUint32(offset + field.pixel_width, true),
        pixelHeight: view.getUint32(offset + field.pixel_height, true),
        sourceX: view.getUint32(offset + field.source_x, true),
        sourceY: view.getUint32(offset + field.source_y, true),
        sourceWidth: view.getUint32(offset + field.source_width, true),
        sourceHeight: view.getUint32(offset + field.source_height, true),
        imageWidth: view.getUint32(offset + field.image_width, true),
        imageHeight: view.getUint32(offset + field.image_height, true),
        format: view.getUint8(offset + field.format) as GhosttyKittyImageFormat,
        compression: view.getUint8(offset + field.compression) as GhosttyKittyImageCompression,
        dataPtr,
        dataLen,
        data,
      });
    }

    placements.sort((a, b) => a.z - b.z || a.imageId - b.imageId || a.placementId - b.placementId);
    this.kittyGraphicsPlacements = placements;
    this.kittyGraphicsPlacementsViewportTop = viewportTop;
    this.kittyGraphicsPlacementsDirty = false;
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  private initCellPool(): void {
    const total = this._cols * this._rows;
    if (this.cellPool.length < total) {
      for (let i = this.cellPool.length; i < total; i++) {
        this.cellPool.push({
          codepoint: 0,
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
        });
      }
    }
  }

  private parseCellsIntoPool(ptr: number, count: number): void {
    const buffer = this.memory.buffer;
    const u8 = new Uint8Array(buffer, ptr, count * GhosttyTerminal.CELL_SIZE);
    const view = new DataView(buffer, ptr, count * GhosttyTerminal.CELL_SIZE);

    for (let i = 0; i < count; i++) {
      const offset = i * GhosttyTerminal.CELL_SIZE;
      const cell = this.cellPool[i];
      cell.codepoint = view.getUint32(offset, true);
      cell.fg_r = u8[offset + 4];
      cell.fg_g = u8[offset + 5];
      cell.fg_b = u8[offset + 6];
      cell.bg_r = u8[offset + 7];
      cell.bg_g = u8[offset + 8];
      cell.bg_b = u8[offset + 9];
      cell.flags = u8[offset + 10];
      cell.width = u8[offset + 11];
      cell.hyperlink_id = view.getUint16(offset + 12, true);
      cell.grapheme_len = u8[offset + 14]; // grapheme_len is at byte 14
    }
  }

  /** Small buffer for grapheme lookups (reused to avoid allocation) */
  private graphemeBuffer: Uint32Array | null = null;
  private graphemeBufferPtr: number = 0;

  /**
   * Get all codepoints for a grapheme cluster at the given position.
   * For most cells this returns a single codepoint, but for complex scripts
   * (Hindi, emoji with ZWJ, etc.) it returns multiple codepoints.
   * @returns Array of codepoints, or null on error
   */
  getGrapheme(row: number, col: number): number[] | null {
    this.update();
    return this.getGraphemeFromRenderState(row, col);
  }

  /**
   * Get all codepoints for a grapheme cluster from the most recently refreshed render state.
   * Call update() first to guarantee freshness.
   */
  getGraphemeFromRenderState(row: number, col: number): number[] | null {
    // Allocate buffer on first use (16 codepoints should be enough for any grapheme)
    if (!this.graphemeBuffer) {
      this.graphemeBufferPtr = this.exports.ghostty_wasm_alloc_u8_array(16 * 4);
      this.graphemeBuffer = new Uint32Array(this.memory.buffer, this.graphemeBufferPtr, 16);
    }

    const count = this.exports.ghostty_render_state_get_grapheme(
      this.handle,
      row,
      col,
      this.graphemeBufferPtr,
      16
    );

    if (count < 0) return null;

    // Re-create view in case memory grew
    const view = new Uint32Array(this.memory.buffer, this.graphemeBufferPtr, count);
    return Array.from(view);
  }

  /**
   * Get a string representation of the grapheme at the given position.
   * This properly handles complex scripts like Hindi, emoji with ZWJ, etc.
   */
  getGraphemeString(row: number, col: number): string {
    const codepoints = this.getGrapheme(row, col);
    if (!codepoints || codepoints.length === 0) return ' ';
    return String.fromCodePoint(...codepoints);
  }

  /**
   * Get a grapheme string from the most recently refreshed render state.
   * Call update() first to guarantee freshness.
   */
  getGraphemeStringFromRenderState(row: number, col: number): string {
    const codepoints = this.getGraphemeFromRenderState(row, col);
    if (!codepoints || codepoints.length === 0) return ' ';
    return String.fromCodePoint(...codepoints);
  }

  /**
   * Get all codepoints for a grapheme cluster in the scrollback buffer.
   * @param offset Scrollback line offset (0 = oldest)
   * @param col Column index
   * @returns Array of codepoints, or null on error
   */
  getScrollbackGrapheme(offset: number, col: number): number[] | null {
    // Reuse the same buffer as getGrapheme
    if (!this.graphemeBuffer) {
      this.graphemeBufferPtr = this.exports.ghostty_wasm_alloc_u8_array(16 * 4);
      this.graphemeBuffer = new Uint32Array(this.memory.buffer, this.graphemeBufferPtr, 16);
    }

    const count = this.exports.ghostty_terminal_get_scrollback_grapheme(
      this.handle,
      offset,
      col,
      this.graphemeBufferPtr,
      16
    );

    if (count < 0) return null;

    // Re-create view in case memory grew
    const view = new Uint32Array(this.memory.buffer, this.graphemeBufferPtr, count);
    return Array.from(view);
  }

  /**
   * Get a string representation of a grapheme in the scrollback buffer.
   */
  getScrollbackGraphemeString(offset: number, col: number): string {
    const codepoints = this.getScrollbackGrapheme(offset, col);
    if (!codepoints || codepoints.length === 0) return ' ';
    return String.fromCodePoint(...codepoints);
  }

  private readFormattedTerminalOutput(optionsPtr: number): string {
    const writtenPtr = this.exports.ghostty_wasm_alloc_usize();
    let outputPtr = 0;
    let outputLen = 0;

    try {
      let result = this.exports.ghostty_terminal_format_buf(
        this.handle,
        optionsPtr,
        0,
        0,
        writtenPtr
      );
      outputLen = new DataView(this.memory.buffer).getUint32(writtenPtr, true);
      if (result !== GhosttyResult.OUT_OF_SPACE && result !== GhosttyResult.SUCCESS) {
        throw new Error(`ghostty_terminal_format_buf sizing failed: ${result}`);
      }

      if (outputLen === 0) {
        return '';
      }

      outputPtr = this.exports.ghostty_wasm_alloc_u8_array(outputLen);
      result = this.exports.ghostty_terminal_format_buf(
        this.handle,
        optionsPtr,
        outputPtr,
        outputLen,
        writtenPtr
      );
      if (result !== GhosttyResult.SUCCESS) {
        throw new Error(`ghostty_terminal_format_buf failed: ${result}`);
      }

      const bytesWritten = new DataView(this.memory.buffer).getUint32(writtenPtr, true);
      return new TextDecoder().decode(
        new Uint8Array(this.memory.buffer, outputPtr, bytesWritten).slice()
      );
    } finally {
      if (outputPtr) {
        this.exports.ghostty_wasm_free_u8_array(outputPtr, outputLen);
      }
      this.exports.ghostty_wasm_free_usize(writtenPtr);
    }
  }

  private getStructLayout(name: string) {
    const layout = this.typeLayouts[name];
    if (!layout) {
      throw new Error(`ghostty_type_json is missing ${name} layout metadata`);
    }
    return layout;
  }

  private getKittyPlacementLayer(z: number): GhosttyKittyPlacementLayer {
    if (z < -(2 ** 30)) {
      return GhosttyKittyPlacementLayer.BELOW_BG;
    }
    if (z < 0) {
      return GhosttyKittyPlacementLayer.BELOW_TEXT;
    }
    return GhosttyKittyPlacementLayer.ABOVE_TEXT;
  }

  private writePoint(ptr: number, tag: GhosttyPointTag, x: number, y: number): void {
    const pointLayout = this.getStructLayout('GhosttyPoint');
    const coordinateLayout = this.getStructLayout('GhosttyPointCoordinate');
    const valueField = pointLayout.fields.value;
    const view = new DataView(this.memory.buffer, ptr, pointLayout.size);
    this.zeroMemory(ptr, pointLayout.size);
    view.setInt32(pointLayout.fields.tag.offset, tag, true);
    view.setUint16(valueField.offset + coordinateLayout.fields.x.offset, x, true);
    view.setUint32(valueField.offset + coordinateLayout.fields.y.offset, y, true);
  }

  private writePointer(view: DataView, offset: number, ptr: number): void {
    view.setUint32(offset, ptr, true);
  }

  private copyMemory(destPtr: number, srcPtr: number, len: number): void {
    new Uint8Array(this.memory.buffer, destPtr, len).set(
      new Uint8Array(this.memory.buffer, srcPtr, len)
    );
  }

  private zeroMemory(ptr: number, len: number): void {
    new Uint8Array(this.memory.buffer, ptr, len).fill(0);
  }

  private expectResult(operation: string, result: number): void {
    if (result !== GhosttyResult.SUCCESS) {
      throw new Error(`${operation} failed with result ${result}`);
    }
  }

  private invalidateBuffers(): void {
    if (this.viewportBufferPtr) {
      this.exports.ghostty_wasm_free_u8_array(this.viewportBufferPtr, this.viewportBufferSize);
      this.viewportBufferPtr = 0;
      this.viewportBufferSize = 0;
    }
    if (this.kittyPlacementBufferPtr) {
      this.exports.ghostty_wasm_free_u8_array(
        this.kittyPlacementBufferPtr,
        this.kittyPlacementBufferSize
      );
      this.kittyPlacementBufferPtr = 0;
      this.kittyPlacementBufferSize = 0;
    }
    if (this.graphemeBufferPtr) {
      this.exports.ghostty_wasm_free_u8_array(this.graphemeBufferPtr, 16 * 4);
      this.graphemeBufferPtr = 0;
    }
    this.graphemeBuffer = null;
    this.kittyGraphicsPlacements = [];
    this.kittyGraphicsPlacementsViewportTop = 0;
    this.kittyGraphicsPlacementsDirty = true;
  }

  private normalizeCellSize(value: number | undefined): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return Math.max(0, Math.round(value));
  }
}
