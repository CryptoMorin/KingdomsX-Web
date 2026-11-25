const urlWithSchemeAndSlashes = /\b[a-z][a-z\d+.-]*:\/\/[^\s<>]/i;

const domain = String.raw`(?:[\p{L}\p{N}][\p{L}\p{N}\p{M}-]*\.)+(?:xn--[a-z\d-]+|\p{L}[\p{L}\p{M}]+)`;
const ipAddress = String.raw`(?:\d{1,3}(?:\.\d{1,3}){3}|\[[\da-f:.]+\])`;
const host = String.raw`(?:${domain}|${ipAddress})`;
const hostBoundary = String.raw`(?<![\p{L}\p{N}\p{M}_.@-])`;
const wwwUrl = new RegExp(String.raw`${hostBoundary}www\.${domain}`, "iu");

const protocolRelativeUrl = new RegExp(String.raw`${hostBoundary}//${host}`, "iu");

const hostWithUrlSuffix = new RegExp(
  String.raw`${hostBoundary}${host}\.?(?::\d+)?(?:[/\\]|[?#][^\s)\]}>,.!?])`,
  "iu"
);

export function listingDescriptionLinkError(description: string): string {
  const hasLink =
    urlWithSchemeAndSlashes.test(description) ||
    protocolRelativeUrl.test(description) ||
    wwwUrl.test(description) ||
    hostWithUrlSuffix.test(description);

  return hasLink ? "Remove links from the description and add them under Website & Socials." : "";
}
