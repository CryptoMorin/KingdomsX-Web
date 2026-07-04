export type ServerDirectoryReviewDisplayStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "suspended"
  | "hidden_offline"
  | "deleted";

export interface ServerDirectoryEmbedSocialLink {
  label: string;
  url: string;
}

export interface ServerDirectoryEmbedListing {
  name: string;
  description: string;
  normalizedHost: string;
  port: number;
  websiteUrl: string | null;
  socialLinks: readonly ServerDirectoryEmbedSocialLink[];
  ownerDiscordUserId: string | null;
}

export interface ServerDirectoryReviewEmbedListing extends ServerDirectoryEmbedListing {
  status: Exclude<ServerDirectoryReviewDisplayStatus, "deleted">;
  updatedAt: string;
  submissionCreatedAt: string;
  submissionVerificationEvidence: string | null;
  submissionModerationNotes: string | null;
  publicDiscordMessageId: string | null;
  publicDiscordGuildId: string | null;
  publicDiscordChannelId: string | null;
}

interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

interface DiscordLinkButton {
  type: 2;
  style: 5;
  label: string;
  url: string;
}

interface DiscordListingMessageOptions {
  author: {
    name: string;
    url: string;
    icon_url: string;
  };
  color: number;
  footer: string;
  timestamp: string;
  additionalFields?: readonly DiscordEmbedField[];
  actionButtons?: readonly DiscordLinkButton[];
}

const KINGDOMS_LOGO_URL = "https://i.imgur.com/yJI3kra.png";
const PUBLIC_DIRECTORY_URL = "https://servers.kingdomsx.com/";
const ADMIN_DASHBOARD_URL = "https://servers.kingdomsx.com/admin";

export function buildDiscordServerEmbedPayload(
  server: ServerDirectoryEmbedListing,
  embed: { updated: boolean; timestamp: string }
): Record<string, unknown> {
  return buildDiscordListingMessage(server, {
    author: {
      name: "KingdomsX Servers",
      url: PUBLIC_DIRECTORY_URL,
      icon_url: KINGDOMS_LOGO_URL
    },
    color: 0xfbb03b,
    footer: embed.updated ? "Updated" : "Listed",
    timestamp: embed.timestamp
  });
}

export function buildDiscordReviewEmbedPayload(
  server: ServerDirectoryReviewEmbedListing,
  notificationType: "submitted" | "resubmitted",
  displayStatus: ServerDirectoryReviewDisplayStatus = server.status
): Record<string, unknown> {
  const additionalFields: DiscordEmbedField[] = [];

  if (server.submissionVerificationEvidence) {
    const verification = formatDiscordVerificationEvidence(server.submissionVerificationEvidence)
      .replace(/`/g, "ˋ")
      .slice(0, 1000);
    additionalFields.push({
      name: "Verification",
      value: `\`\`\`\n${verification}\n\`\`\``
    });
  }

  const moderationReason = server.submissionModerationNotes?.trim();
  if ((displayStatus === "rejected" || displayStatus === "suspended") && moderationReason) {
    additionalFields.push({
      name: displayStatus === "rejected" ? "Rejection reason" : "Suspension reason",
      value: escapeDiscordMarkdown(moderationReason).slice(0, 1024)
    });
  }

  const actionButtons: DiscordLinkButton[] = [{
    type: 2,
    style: 5,
    label: "Open admin dashboard",
    url: ADMIN_DASHBOARD_URL
  }];
  const publicMessageUrl = discordPublicMessageUrl(server);
  if (displayStatus === "approved" && publicMessageUrl) {
    actionButtons.push({
      type: 2,
      style: 5,
      label: "View public embed",
      url: publicMessageUrl
    });
  }

  const reviewState = discordReviewState(displayStatus, notificationType);
  return buildDiscordListingMessage(server, {
    author: {
      name: "KingdomsX Server Review",
      url: ADMIN_DASHBOARD_URL,
      icon_url: KINGDOMS_LOGO_URL
    },
    color: reviewState.color,
    footer: reviewState.label,
    timestamp: displayStatus === "pending" ? server.submissionCreatedAt : server.updatedAt,
    additionalFields,
    actionButtons
  });
}

function buildDiscordListingMessage(
  server: ServerDirectoryEmbedListing,
  options: DiscordListingMessageOptions
): Record<string, unknown> {
  const address = server.port === 25565 ? server.normalizedHost : `${server.normalizedHost}:${server.port}`;
  const ownerId = server.ownerDiscordUserId && /^\d{10,32}$/.test(server.ownerDiscordUserId)
    ? server.ownerDiscordUserId
    : null;
  const fields: DiscordEmbedField[] = [
    { name: "Server address", value: `\`\`\`\n${address.replace(/[\\`]/g, "\\$&").slice(0, 1000)}\n\`\`\`` },
    { name: "Owner", value: ownerId ? `<@${ownerId}>` : "Not available", inline: true }
  ];

  if (server.websiteUrl) {
    fields.push({ name: "Website", value: `<${server.websiteUrl}>`, inline: true });
  }

  const socialLinks: string[] = [];
  for (const link of server.socialLinks) {
    const candidate = discordMarkdownLink(link.label, link.url);
    if ([...socialLinks, candidate].join(" • ").length > 1024) break;
    socialLinks.push(candidate);
  }
  if (socialLinks.length) {
    fields.push({ name: "Socials", value: socialLinks.join(" • ") });
  }

  fields.push(...(options.additionalFields ?? []));
  const timestamp = discordEmbedTimestamp(options.timestamp);
  const iconUrl = `https://api.mcstatus.io/v2/icon/${encodeURIComponent(address)}?timeout=5`;

  return {
    allowed_mentions: ownerId
      ? { parse: [], users: [ownerId] }
      : { parse: [] },
    ...(options.actionButtons?.length
      ? { components: [{ type: 1, components: options.actionButtons }] }
      : {}),
    embeds: [{
      author: options.author,
      title: escapeDiscordMarkdown(server.name).slice(0, 256),
      description: escapeDiscordMarkdown(server.description).slice(0, 4096),
      color: options.color,
      fields,
      thumbnail: {
        url: iconUrl,
        description: `${server.name.slice(0, 200)} server icon`
      },
      footer: { text: options.footer },
      ...(timestamp ? { timestamp } : {})
    }]
  };
}

function discordPublicMessageUrl(server: ServerDirectoryReviewEmbedListing): string | null {
  const ids = [
    server.publicDiscordGuildId,
    server.publicDiscordChannelId,
    server.publicDiscordMessageId
  ];
  return ids.every((id) => typeof id === "string" && /^\d{10,32}$/.test(id))
    ? `https://discord.com/channels/${ids.join("/")}`
    : null;
}

function discordReviewState(
  status: ServerDirectoryReviewDisplayStatus,
  notificationType: "submitted" | "resubmitted"
): { label: string; color: number } {
  if (status === "approved") return { label: "Approved", color: 0x57f287 };
  if (status === "rejected") return { label: "Rejected", color: 0xed4245 };
  if (status === "suspended") return { label: "Suspended", color: 0xc53030 };
  if (status === "deleted") return { label: "Deleted", color: 0xb22222 };
  if (status === "hidden_offline") return { label: "Hidden offline", color: 0x95a5a6 };
  return {
    label: notificationType === "resubmitted" ? "Resubmitted for review" : "Submitted for review",
    color: 0xfbb03b
  };
}

function formatDiscordVerificationEvidence(value: string): string {
  return value.split("\n").map((line) => {
    const match = line.match(/^Verified:\s*(.+)$/);
    if (!match) return line;
    const date = new Date(match[1]);
    if (Number.isNaN(date.getTime())) return line;
    const pad = (part: number) => String(part).padStart(2, "0");
    return `Verified (UTC): ${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
  }).join("\n");
}

function discordEmbedTimestamp(value: string): string | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function escapeDiscordMarkdown(value: string): string {
  return value.replace(/([\\`*_{}\[\]()<>#+\-.!|~])/g, "\\$1");
}

function discordMarkdownLink(label: string, url: string): string {
  const safeUrl = url.replace(/\(/g, "%28").replace(/\)/g, "%29");
  return `[${escapeDiscordMarkdown(label)}](${safeUrl})`;
}
