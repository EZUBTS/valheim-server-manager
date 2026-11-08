export type CaptionGlyphKind = 'minimize' | 'maximize' | 'restore' | 'close';

/**
 * Codepoints from Segoe Fluent Icons / Segoe MDL2 Assets — the exact glyphs
 * Windows draws on native caption buttons.
 */
const WINDOWS_GLYPHS: Record<CaptionGlyphKind, string> = {
  minimize: '\uE921',
  maximize: '\uE922',
  restore: '\uE923',
  close: '\uE8BB',
};

/** Native Windows 11 caption glyph. */
export function CaptionGlyph({ kind }: { kind: CaptionGlyphKind }) {
  return (
    <span aria-hidden="true" className="caption-glyph">
      {WINDOWS_GLYPHS[kind]}
    </span>
  );
}
