import { isRecord } from "./http";
import { optionalUrl } from "./network-validation";

export function safeParseSocialLinks(
  value: string
): Array<{ key?: string; label: string; url: string; host: string }> {
  try {
    const parsed: unknown = JSON.parse(value);

    return Array.isArray(parsed)
      ? parsed.filter(isRecord).flatMap((item) => {
        const url = optionalUrl(typeof item.url === "string" ? item.url : "");

        if (!url)
          return [];

        return [
          {
            key: typeof item.key === "string" ? item.key.slice(0, 24) : undefined,
            label: String(item.label ?? "Link").slice(0, 24),
            url,
            host: new URL(url).hostname.replace(/^www\./, "")
          }
        ];
      })
      : [];
  } catch {
    return [];
  }
}
