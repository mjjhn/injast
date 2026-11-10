import { describe, expect, it } from "vitest";

// Read authored CSS, never the vendor stylesheet or generated build output.
const styles = import.meta.glob<string>("../**/*.css", {
  query: "?raw",
  import: "default",
  eager: true,
});
const layoutProperty =
  /^(?:(?:scroll-)?(?:margin|padding)(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?|(?:row-|column-)?gap|outline-offset)$/;
const radiusProperty =
  /^border(?:-(?:top-left|top-right|bottom-left|bottom-right|start-start|start-end|end-start|end-end))?-radius$/;

function inspectCSS(files: Record<string, string>): string[] {
  const declarations = Object.entries(files).flatMap(([file, source]) =>
    [
      ...source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .matchAll(/([\w-]+)\s*:\s*([^;{}]+)(?:;|(?=\}))/g),
    ].map((match) => ({
      file,
      property: match[1],
      value: match[2].trim().replace(/\s*!important\s*$/, ""),
    })),
  );
  const issues: string[] = [];
  const spaces = new Map<string, string>();
  const radii = declarations.filter(({ property }) =>
    property.startsWith("--radius"),
  );
  if (
    radii.length !== 1 ||
    radii[0]?.property !== "--radius" ||
    radii[0]?.value !== "12px"
  ) {
    issues.push("Exactly one radius token, --radius:12px, is required");
  }
  for (const { file, property, value } of declarations) {
    if (!property.startsWith("--space-")) continue;
    const match = /^--space-(\d+)$/.exec(property);
    if (
      !match ||
      Number(match[1]) % 4 !== 0 ||
      value !== `${Number(match[1])}px`
    ) {
      issues.push(`${file}: invalid spacing token ${property}:${value}`);
    }
    if (spaces.has(property))
      issues.push(`${file}: duplicate spacing token ${property}`);
    spaces.set(property, value);
  }
  for (const { file, property, value } of declarations) {
    for (const [, reference] of value.matchAll(
      /var\(\s*(--space-[\w-]+|--radius(?:-[\w-]+)?)\b/g,
    )) {
      if (
        reference.startsWith("--space-")
          ? !spaces.has(reference)
          : reference !== "--radius"
      ) {
        issues.push(`${file}: undefined/obsolete reference ${reference}`);
      }
    }
    if (
      radiusProperty.test(property) ||
      /^--rdp-.*border-radius$/.test(property)
    ) {
      if (value !== "var(--radius)")
        issues.push(`${file}: noncanonical ${property}:${value}`);
    }
    if (!layoutProperty.test(property)) continue;
    // A narrow value grammar: tokens, zero, margin auto, arithmetic and safe-area.
    // Typography, icon sizes, border/outline thickness and geometry aren't spacing.
    const remainder = value
      .replace(/var\(\s*--space-\d+\s*\)/g, " ")
      .replace(/env\(safe-area-inset-(?:top|right|bottom|left)\)/g, " ")
      .replace(/\b(?:min|max|calc|clamp)\s*\(/g, "(")
      .replace(property.includes("margin") ? /\bauto\b/g : /$^/g, " ")
      .replace(/(^|[\s(,+*/-])0(?=$|[\s),+*/-])/g, "$1 ")
      .replace(/[\s(),+*/-]/g, "");
    if (remainder)
      issues.push(`${file}: raw/unsupported spacing ${property}:${value}`);
  }
  return issues;
}

const base =
  ":root { --space-0:0px; --space-4:4px; --space-8:8px; --radius:12px; }";

describe("brief appearance contract", () => {
  it("keeps every authored stylesheet on the spacing and radius contract", () => {
    expect(Object.keys(styles).length).toBeGreaterThan(1);
    expect(
      Object.values(styles).every((source) => source.trim().length > 0),
    ).toBe(true);
    expect(inspectCSS(styles)).toEqual([]);
  });
  it.each([
    "a { gap:6px }",
    "a { gap:var(--space-6); }",
    "a { padding-inline:3px; }",
    "a { outline-offset:2px; }",
    "a { border-radius:50%; }",
    "a { border-top-left-radius:8px; }",
    ":root { --radius-8:8px; }",
    ":root { --space-6:8px; }",
    ":root { --space-4:8px; }",
    "a { --rdp-day_button-border-radius:100%; }",
  ])("rejects a contract violation: %s", (source) => {
    expect(inspectCSS({ fixture: base + source }).length).toBeGreaterThan(0);
  });
  it("accepts permitted geometry, native insets and typography without false positives", () => {
    expect(
      inspectCSS({
        fixture:
          base +
          `
      a { margin:0 auto; padding:var(--space-4) 0; gap:var(--space-8);
      outline-offset:var(--space-4); border-radius:var(--radius);
      padding-bottom:max(var(--space-8), env(safe-area-inset-bottom));
      font-size:14px; width:18px; border:1px solid; outline-width:3px;
      top:50%; transform:translateY(-50%); }
    `,
      }),
    ).toEqual([]);
  });
});
