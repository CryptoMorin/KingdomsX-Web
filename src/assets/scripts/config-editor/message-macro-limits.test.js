import { describe, expect, it } from "vitest";
import { messageMacroContext, resolveMessageMacros } from "./message-macros.js";

describe("message preview limits", () => {
  it("limits repeated variables and message references in either order", () => {
    for (const reverse of [false, true]) {
      const macros = Array.from({ length: 24 }, (_, i) =>
        option(["placeholders", "variables", `m${i}`], i ? `'{$m${i - 1}}{$m${i - 1}}'` : "'x'")
      );
      const references = Array.from({ length: 24 }, (_, i) =>
        option([`r${i}`], i ? `'{$$r${i - 1}}{$$r${i - 1}}'` : "'x'")
      );

      if (reverse) {
        macros.reverse();
        references.reverse();
      }

      const context = messageMacroContext(null, null, references, macros);
      const preview = resolveMessageMacros("{$m23}{$m23}{$$r23}{$$r23}", context);

      for (const value of [context.values.get("m23"), context.references.get("r23")]) {
        expect(value.length).toBeLessThanOrEqual(65_536);
        expect(value).toContain("{$");
      }

      expect(preview.length).toBeLessThanOrEqual(65_536);
      expect(preview).toContain("{$");
    }
  });

  it("limits nested variables and preserves unknown or circular references", () => {
    const macros = Array.from({ length: 150 }, (_, i) =>
      option(["placeholders", "variables", `m${i}`], i === 149 ? "'end'" : `'{$m${i + 1}}'`)
    );

    macros.push(option(["placeholders", "variables", "cycle"], "'{$cycle} {$unknown}'"));

    const context = messageMacroContext(null, null, [], macros);

    expect(context.values.get("m0")).toMatch(/^\{\$m\d+}$/);
    expect(context.values.get("cycle")).toBe("{$cycle} {$unknown}");
    expect(context.definitions.get("m0").value).toBe("{$m1}");
  });

  it("limits the combined text kept for variables and message references", () => {
    const literal = `'${"x".repeat(64_000)}'`;
    const macros = Array.from({ length: 31 }, (_, i) =>
      option(["placeholders", "variables", `m${i}`], literal)
    );
    const references = [option(["message"], literal)];
    const context = messageMacroContext(null, null, references, macros);
    const cachedLength = [...context.values.values(), ...context.references.values()]
      .reduce((total, value) => total + value.length, 0);

    expect(cachedLength).toBeLessThanOrEqual(2_000_000);
    expect(resolveMessageMacros("{$m0}", context)).toBe("x".repeat(64_000));
    expect(resolveMessageMacros("{$$message}", context)).toBe("{$$message}");
  });
});

function option(path, source) {
  return { path, source, container: false };
}
