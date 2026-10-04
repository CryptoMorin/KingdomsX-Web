import { Tooltip } from "bootstrap";
import {
  createSkeletonBlock,
  readSocialFormValues,
  readSocialValues,
  SERVER_DESCRIPTION_LIMIT,
  SOCIAL_PLATFORMS,
} from "./ui.js";

export const createSubmitFormKit = ({
  root,
  page: { apiUrl, currentReturnPath, serversUrl, turnstileSiteKey },
  messages,
  render: { setSubmitView, replaceRoot, reload },
}) => {
  let disposeTooltips = () => {};

  const initTooltips = (container) => {
    disposeTooltips();

    const tooltips = Array.from(container.querySelectorAll('[data-bs-toggle="tooltip"]')).map(
      (element) =>
        Tooltip.getOrCreateInstance(element, {
          container: "body",
          customClass: "comparison-tooltip",
          trigger: "hover focus",
        })
    );

    disposeTooltips = () => {
      tooltips.forEach((instance) => instance.dispose());
      disposeTooltips = () => {};
    };
  };

  const statePanel = (title, message, iconClass = "fa-brands fa-discord", kind = "") => {
    const panel = document.createElement("div");
    panel.className = `servers-state d-flex flex-column align-items-center justify-content-center text-center gap-2 p-4 rounded-2 ${kind}`.trim();

    const icon = document.createElement("i");
    icon.className = `servers-state-icon d-inline-flex align-items-center justify-content-center ${iconClass}`;
    icon.setAttribute("aria-hidden", "true");

    const heading = document.createElement("strong");
    heading.textContent = title;
    panel.append(icon, heading);

    if (message) {
      const text = document.createElement("span");
      text.textContent = message;
      panel.append(text);
    }

    return panel;
  };

  const createSubmitLoadingSkeleton = () => {
    const shell = document.createElement("div");
    shell.className = "server-submit-loading d-flex flex-column gap-4";
    shell.setAttribute("aria-hidden", "true");

    const account = document.createElement("section");
    account.className = "server-submit-account surface-lift d-flex align-items-center gap-3 rounded-3";

    const accountText = document.createElement("span");
    accountText.className = "server-skeleton-stack d-grid gap-2 flex-grow-1 min-w-0";
    accountText.append(
      createSkeletonBlock("server-skeleton-line server-skeleton-title"),
      createSkeletonBlock("server-skeleton-line server-skeleton-short")
    );
    account.append(createSkeletonBlock("server-skeleton-avatar flex-shrink-0"), accountText);

    const section = document.createElement("section");
    section.className = "server-submit-section surface-lift d-flex flex-column gap-3 p-3 p-md-4 rounded-3";
    section.append(
      createSkeletonBlock("server-skeleton-line server-skeleton-heading"),
      createSkeletonBlock("server-skeleton-line"),
      createSkeletonBlock("server-skeleton-line"),
      createSkeletonBlock("server-skeleton-box")
    );

    shell.append(account, section);

    return shell;
  };

  const renderSubmitLoading = () => {
    root.setAttribute("aria-busy", "true");
    root.replaceChildren(createSubmitLoadingSkeleton());
  };

  const createAccountBar = (user) => {
    const bar = document.createElement("div");
    bar.className = "server-submit-account surface-lift d-flex flex-column flex-sm-row align-items-sm-center justify-content-between gap-3 rounded-3";

    const identity = document.createElement("div");
    identity.className = "d-flex align-items-center gap-3 min-w-0";

    const avatar = document.createElement("span");
    avatar.className = "server-submit-avatar d-inline-flex align-items-center justify-content-center flex-shrink-0 rounded-2 overflow-hidden";

    if (user?.avatarUrl) {
      const image = document.createElement("img");
      image.className = "w-100 h-100 object-fit-cover";
      image.src = user.avatarUrl;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      avatar.append(image);
    } else {
      const icon = document.createElement("i");
      icon.className = "fa-brands fa-discord";
      icon.setAttribute("aria-hidden", "true");
      avatar.append(icon);
    }

    const text = document.createElement("div");
    text.className = "d-grid gap-1 min-w-0";

    const label = document.createElement("span");
    label.className = "server-stat-label";
    label.textContent = "Signed in with Discord";

    const name = document.createElement("strong");
    name.className = "server-submit-account-name text-truncate";
    const username = user?.username ? String(user.username) : "";
    const displayName = user?.displayName || username || "Discord member";

    name.textContent = username ? `${displayName} \u00B7 ` : displayName;
    name.title = username ? `${displayName} \u00B7 @${username}` : displayName;

    if (username) {
      const usernameNode = document.createElement("small");
      usernameNode.className = "text-body-secondary fw-bold";
      usernameNode.textContent = `@${username}`;
      name.append(usernameNode);
    }

    text.append(label, name);
    identity.append(avatar, text);

    const logout = document.createElement("button");
    logout.className = "btn btn-site d-inline-flex align-items-center justify-content-center gap-2 fw-bold";
    logout.type = "button";
    logout.innerHTML = '<i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i> Sign Out';
    logout.addEventListener("click", async () => {
      logout.disabled = true;
      await fetch(apiUrl("/api/auth/logout"), {
        method: "POST",
        credentials: "include",
        headers: { accept: "application/json" },
      }).catch(() => null);
      reload();
    });

    bar.append(identity, logout);

    return bar;
  };

  const renderLoggedOut = () => {
    setSubmitView("logged-out");

    const panel = document.createElement("div");
    panel.className = "server-submit-login text-center";

    const process = document.createElement("div");
    process.className = "server-submit-process feature-band";

    messages.submit.loggedOutSteps.forEach((step) => {
      const column = document.createElement("article");
      column.className = "server-submit-process-column";

      const card = document.createElement("div");
      card.className = "feature surface-panel surface-lift server-submit-process-step text-center h-100 rounded-3";
      card.style.minHeight = "auto";

      const icon = document.createElement("i");
      icon.className = `feature-icon ${step.icon}`;
      icon.setAttribute("aria-hidden", "true");

      const title = document.createElement("h2");
      title.className = "server-submit-process-title mb-0";
      title.textContent = step.title;

      const text = document.createElement("p");
      text.textContent = step.text;

      card.append(icon, title, text);
      column.append(card);
      process.append(column);
    });

    const actions = document.createElement("div");
    actions.className = "error-actions d-flex flex-wrap justify-content-center gap-3";

    const login = document.createElement("a");
    login.className = "btn btn-site btn-discord d-inline-flex align-items-center justify-content-center gap-2 fw-bold";
    const loginUrl = apiUrl("/api/auth/discord/login");

    loginUrl.searchParams.set("returnTo", currentReturnPath());
    login.href = loginUrl.toString();
    login.innerHTML = '<i class="fa-brands fa-discord" aria-hidden="true"></i> Continue with Discord';

    const back = document.createElement("a");
    back.className = "btn btn-site d-inline-flex align-items-center justify-content-center gap-2 fw-bold";
    back.href = serversUrl;
    back.innerHTML = '<i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Back to Servers';

    const notice = document.createElement("small");
    notice.className = "d-block mx-auto mt-4 text-secondary-emphasis";
    notice.textContent = "Signing in with Discord doesn't give us access to your messages or other private account activity. It only lets us see your user ID, name, and avatar, and confirm that you're a member of the KingdomsX Discord server. We use this information only to create your account on the KingdomsX website and keep it secure.";

    actions.append(login, back);
    panel.append(process, actions, notice);
    replaceRoot(panel);
  };

  const ownerHost = (item) => item?.host || String(item?.address || "").split(":")[0] || "";
  const ownerPort = (item) =>
    Number(
      item?.port ||
        (String(item?.address || "").includes(":")
          ? String(item.address).split(":").at(-1)
          : 25565)
    ) || 25565;

  const comparableValue = (value) => String(value ?? "").trim();

  const publicSnapshot = (item) => ({
    description: comparableValue(item?.description),
    websiteUrl: comparableValue(item?.websiteUrl),
    ...readSocialValues(item),
  });

  const identitySnapshot = (item) => ({
    name: comparableValue(item?.name),
    address: comparableValue(ownerHost(item)).toLowerCase(),
    port: String(ownerPort(item) || 25565),
  });

  const field = (name, label, options = {}) => {
    const wrap = document.createElement("div");
    wrap.className = options.column || "col-md-6";

    const floating = document.createElement("div");
    floating.className = `form-floating server-submit-floating ${options.icon ? "server-submit-floating-icon" : ""} ${options.counter ? "server-submit-floating-counted" : ""}`.trim();

    if (options.icon) {
      const iconWrap = document.createElement("span");
      iconWrap.className = "server-submit-field-icon d-inline-flex align-items-center justify-content-center";
      const icon = document.createElement("i");
      icon.className = options.icon;
      icon.setAttribute("aria-hidden", "true");
      iconWrap.append(icon);
      floating.append(iconWrap);
    }

    const control = options.textarea
      ? document.createElement("textarea")
      : document.createElement("input");

    if (!options.textarea) {
      control.type = options.type || "text";
    }

    control.className = `form-control ${options.className || ""}`.trim();
    control.id = `server-${name}`;
    control.name = name;
    const maxLength = Number(options.maxLength || 255);

    if (!options.allowOverLimit) {
      control.maxLength = maxLength;
    }

    control.required = Boolean(options.required);
    control.value = options.value || "";

    control.placeholder = options.placeholder || label;

    if (options.minLength) {
      control.minLength = options.minLength;
    }

    if (options.rows) {
      control.rows = options.rows;
    }

    if (options.inputMode) {
      control.inputMode = options.inputMode;
    }

    if (options.autocomplete) {
      control.autocomplete = options.autocomplete;
    }

    if (options.disabled) {
      control.disabled = true;
    }

    const labelNode = document.createElement("label");
    labelNode.htmlFor = `server-${name}`;
    labelNode.textContent = label;

    floating.append(control, labelNode);

    if (options.counter) {
      const counter = document.createElement("span");
      counter.className = "server-submit-counter pe-none";
      counter.id = `${control.id}-counter`;
      control.setAttribute("aria-describedby", counter.id);

      const updateCounter = () => {
        counter.textContent = `${control.value.length}/${maxLength}`;
        const overLimit = control.value.length > maxLength;

        counter.style.color = overLimit ? "#ff463d" : "";
        control.setAttribute("aria-invalid", String(overLimit));
      };

      control.addEventListener("input", updateCounter);
      updateCounter();
      floating.append(counter);
    }

    wrap.append(floating);

    if (options.help) {
      const help = document.createElement("p");
      help.className = "form-text";
      help.textContent = options.help;
      wrap.append(help);
    }

    return wrap;
  };

  const parseAddressPort = (value) => {
    const trimmed = String(value ?? "").trim();

    if (!trimmed.includes(":")) {
      return null;
    }

    try {
      if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)) {
        const parsed = new URL(trimmed);
        const port = Number(parsed.port || "25565");

        return parsed.hostname && Number.isInteger(port) && port >= 1 && port <= 65535
          ? { host: parsed.hostname, port: String(port) }
          : null;
      }
    } catch {
      return null;
    }

    const match = trimmed.match(/^\[?([^\]]+)\]?:([0-9]{1,5})$/);

    if (!match) {
      return null;
    }

    const port = Number(match[2]);

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return null;
    }

    return { host: match[1], port: String(port) };
  };

  const isValidPublicServerAddress = (value) => {
    // The Worker handles final address validation
    const host = String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/\.$/, "");
    const blockedSuffixes = [".localhost", ".local", ".internal", ".invalid", ".test", ".example"];
    const blockedIpv4Ranges = [
      /^10\./,
      /^127\./,
      /^169\.254\./,
      /^172\.(1[6-9]|2\d|3[01])\./,
      /^192\.168\./,
      /^0\./,
      /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
      /^192\.0\.(0|2)\./,
      /^198\.(18|19|51\.100)\./,
      /^203\.0\.113\./,
      /^224\./,
      /^240\./,
    ];

    if (!host || host.length > 253 || /[\s/:@?#\[\]]/.test(host)) {
      return false;
    }

    if (
      ["localhost", "localhost.localdomain", "internal", "invalid", "test", "example"].includes(
        host
      ) ||
      blockedSuffixes.some((suffix) => host.endsWith(suffix))
    ) {
      return false;
    }

    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
      return (
        host.split(".").every((part) => Number(part) >= 0 && Number(part) <= 255) &&
        !blockedIpv4Ranges.some((pattern) => pattern.test(host))
      );
    }

    return (
      host.includes(".") &&
      /^(?!-)[a-z0-9-]{1,63}(?<!-)(?:\.(?!-)[a-z0-9-]{1,63}(?<!-))*$/.test(host)
    );
  };

  const createAddressPortGroup = (item = null) => {
    const wrap = document.createElement("div");
    wrap.className = "col-md-6";

    const group = document.createElement("div");
    group.className = "input-group server-submit-address-group";

    const hostFloating = document.createElement("div");
    hostFloating.className = "form-floating server-submit-floating server-submit-address-host";
    const host = document.createElement("input");
    host.className = "form-control";
    host.id = "server-address";
    host.name = "address";
    host.required = true;
    host.maxLength = 255;
    host.autocomplete = "off";
    host.placeholder = "play.example.com";
    host.value = ownerHost(item);
    const hostLabel = document.createElement("label");
    hostLabel.htmlFor = "server-address";
    hostLabel.textContent = "Server address";
    hostFloating.append(host, hostLabel);

    const separator = document.createElement("span");
    separator.className = "input-group-text server-submit-address-separator";
    separator.textContent = ":";

    const portFloating = document.createElement("div");
    portFloating.className = "form-floating server-submit-floating server-submit-address-port";
    const port = document.createElement("input");
    port.className = "form-control";
    port.id = "server-port";
    port.name = "port";
    port.type = "number";
    port.inputMode = "numeric";
    port.min = "1";
    port.max = "65535";
    port.maxLength = 5;
    port.placeholder = "25565";
    port.value = item ? String(ownerPort(item)) : "";
    const portLabel = document.createElement("label");
    portLabel.htmlFor = "server-port";
    portLabel.textContent = "Port";
    portFloating.append(port, portLabel);

    const movePort = () => {
      const parsed = parseAddressPort(host.value);

      if (!parsed) {
        return;
      }

      host.value = parsed.host;
      port.value = parsed.port;
      host.dispatchEvent(new Event("input", { bubbles: true }));
      port.dispatchEvent(new Event("input", { bubbles: true }));
    };

    host.addEventListener("paste", () => window.setTimeout(movePort, 0));
    host.addEventListener("change", movePort);

    group.append(hostFloating, separator, portFloating);
    wrap.append(group);

    return wrap;
  };

  const createSubmitSection = (title, ...children) => {
    const section = document.createElement("section");
    section.className = "server-submit-section surface-lift d-flex flex-column gap-3 p-3 p-md-4 rounded-3";

    const heading = document.createElement("h2");
    heading.className = "server-submit-section-title mb-0";
    heading.textContent = title;

    const row = document.createElement("div");
    row.className = "row g-3";
    row.append(...children);

    section.append(heading, row);

    return section;
  };

  const appendPublicFields = (row, item = null) => {
    const social = readSocialValues(item);

    row.append(
      field("websiteUrl", "Website", {
        maxLength: 255,
        inputMode: "url",
        value: item?.websiteUrl,
        placeholder: "kingdomsx.example.com",
        icon: "fa-solid fa-globe",
      }),
      ...SOCIAL_PLATFORMS.map(({ key, label, icon, placeholder }) =>
        field(key, label, {
          maxLength: 255,
          value: social[key],
          placeholder,
          icon,
        })
      )
    );
  };

  const publicDetailsPayload = (form) => {
    const formData = new FormData(form);

    return {
      description: String(formData.get("description") ?? ""),
      websiteUrl: String(formData.get("websiteUrl") ?? ""),
      socialLinks: readSocialFormValues(formData),
    };
  };

  const approvedDetailsPayload = (form) => {
    const formData = new FormData(form);

    return {
      name: String(formData.get("name") ?? ""),
      ...publicDetailsPayload(form),
    };
  };

  const submissionPayload = (form, verificationChallengeId) => {
    const formData = new FormData(form);

    return {
      name: String(formData.get("name") ?? ""),
      address: String(formData.get("address") ?? ""),
      port: String(formData.get("port") ?? ""),
      ...publicDetailsPayload(form),
      verificationChallengeId,
      turnstileToken: String(formData.get("cf-turnstile-response") ?? ""),
    };
  };

  const renderTurnstile = (form) => {
    const widget = form.querySelector("[data-submit-turnstile]");

    if (!widget || widget.dataset.rendered === "true" || !window.turnstile?.render) {
      if (widget && widget.dataset.rendered !== "true") {
        window.setTimeout(() => renderTurnstile(form), 250);
      }

      return;
    }

    window.turnstile.render(widget, {
      sitekey: turnstileSiteKey,
      action: "server-submit",
      theme: "dark",
    });
    widget.dataset.rendered = "true";
  };

  const renderTurnstileField = () => {
    const wrap = document.createElement("div");
    wrap.className = "server-submit-verification d-flex justify-content-center";

    if (turnstileSiteKey) {
      const widget = document.createElement("div");
      widget.dataset.submitTurnstile = "";
      wrap.append(widget);

      return wrap;
    }

    const alert = document.createElement("div");
    alert.className = "w-100";
    const message = document.createElement("p");
    message.className = "servers-alert mb-0";
    message.textContent = messages.submit.protectionMissing;
    alert.append(message);
    wrap.append(alert);

    return wrap;
  };

  const submitButtonLabel = (mode) => {
    if (mode === "new") {
      return "Submit for Review";
    }

    if (mode === "resubmit") {
      return "Resubmit for Review";
    }

    return "Save Changes";
  };

  return {
    initTooltips,
    disposeTooltips,
    statePanel,
    createSubmitLoadingSkeleton,
    renderSubmitLoading,
    createAccountBar,
    renderLoggedOut,
    ownerHost,
    ownerPort,
    comparableValue,
    publicSnapshot,
    identitySnapshot,
    field,
    parseAddressPort,
    isValidPublicServerAddress,
    createAddressPortGroup,
    createSubmitSection,
    appendPublicFields,
    publicDetailsPayload,
    approvedDetailsPayload,
    submissionPayload,
    renderTurnstile,
    renderTurnstileField,
    submitButtonLabel,
  };
};
