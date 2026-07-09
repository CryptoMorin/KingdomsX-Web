import { SERVER_DESCRIPTION_LIMIT } from "./ui.js";

export const VERIFICATION_POLL_DELAYS = [30_000, 30_000, 45_000, 60_000];
export const VERIFICATION_STORAGE_KEY = "server-submission-verification";

export const createVerificationController = ({
  form,
  reviewRow,
  reviewAction,
  state: { canKeepPreviousVerification, currentState, timers },
  page: { apiUrl, messages, showToast },
  render: {
    isValidPublicServerAddress,
    createIdentityChangedNotice,
    createVerificationComplete,
    currentVerificationTarget,
    onStateChange = () => {},
  },
}) => {
  let verificationRequired = !canKeepPreviousVerification;
  let activeVerification = null;
  let activeVerificationIdentity = null;
  let verificationPollCount = 0;
  let verificationPollScheduledAt = 0;
  let verificationNextPollAt = 0;
  let verificationCheckInFlightId = "";
  let verificationBusy = false;
  const verificationOwnerId = String(currentState?.user?.id ?? "");
  const verificationStorageKey = verificationOwnerId
    ? `${VERIFICATION_STORAGE_KEY}:${verificationOwnerId}`
    : VERIFICATION_STORAGE_KEY;

  const verificationIdentityMatches = () => {
    const current = currentVerificationTarget();

    return (
      Boolean(activeVerificationIdentity) &&
      Object.keys(current).every((key) => current[key] === activeVerificationIdentity[key])
    );
  };

  const verificationHasExpired = () => {
    const expiresAt = activeVerification?.expiresAt
      ? new Date(activeVerification.expiresAt).getTime()
      : Number.NaN;

    return Number.isFinite(expiresAt) && expiresAt <= Date.now();
  };

  const verificationIsComplete = () =>
    activeVerification?.status === "verified" &&
    !verificationHasExpired() &&
    verificationIdentityMatches();

  const saveActiveVerification = () => {
    if (!activeVerification || !activeVerificationIdentity || !verificationIdentityMatches()) {
      return;
    }

    try {
      window.sessionStorage?.setItem(
        verificationStorageKey,
        JSON.stringify({
          ownerId: verificationOwnerId,
          verification: activeVerification,
          identity: activeVerificationIdentity,
          pollCount: verificationPollCount,
          nextPollAt: verificationNextPollAt,
        })
      );
    } catch {
      // Session storage only preserves the copyable command while editing in this tab
    }
  };

  const clearStoredVerification = () => {
    try {
      window.sessionStorage?.removeItem(verificationStorageKey);
      window.sessionStorage?.removeItem(VERIFICATION_STORAGE_KEY);
    } catch {
      // Ignore storage cleanup failures
    }
  };

  const restoreActiveVerification = () => {
    try {
      window.sessionStorage?.removeItem(VERIFICATION_STORAGE_KEY);
      const stored = window.sessionStorage?.getItem(verificationStorageKey);

      if (!stored) {
        return;
      }

      const parsed = JSON.parse(stored);

      if (
        !parsed?.verification?.id ||
        !parsed?.identity ||
        parsed.ownerId !== verificationOwnerId
      ) {
        clearStoredVerification();

        return;
      }

      activeVerification = parsed.verification;
      activeVerificationIdentity = parsed.identity;
      verificationPollCount = Number.isInteger(parsed.pollCount)
        ? Math.max(0, parsed.pollCount)
        : 0;
      verificationNextPollAt = Number.isFinite(parsed.nextPollAt)
        ? Math.max(0, parsed.nextPollAt)
        : 0;

      const currentTarget = currentVerificationTarget();
      const address = form.elements.namedItem("address");
      const port = form.elements.namedItem("port");

      if (!currentTarget.address && address instanceof HTMLInputElement) {
        address.value = activeVerificationIdentity.address;

        if (port instanceof HTMLInputElement) {
          port.value = activeVerificationIdentity.port;
        }
      }

      if (!verificationIdentityMatches()) {
        activeVerification = null;
        activeVerificationIdentity = null;
        verificationPollCount = 0;
        verificationNextPollAt = 0;
        clearStoredVerification();

        return;
      }

      if (
        activeVerification?.expiresAt &&
        ["pending", "verified"].includes(activeVerification.status) &&
        verificationHasExpired()
      ) {
        activeVerification = {
          ...activeVerification,
          status: "expired",
        };
        clearStoredVerification();
      }
    } catch {
      activeVerification = null;
      activeVerificationIdentity = null;
      verificationPollCount = 0;
      verificationNextPollAt = 0;
      clearStoredVerification();
    }
  };

  const updateExpiredVerification = () => {
    if (
      !activeVerification?.expiresAt ||
      !["pending", "verified"].includes(activeVerification.status)
    ) {
      return false;
    }

    if (new Date(activeVerification.expiresAt).getTime() > Date.now()) {
      return false;
    }

    activeVerification = {
      ...activeVerification,
      status: "expired",
    };
    clearStoredVerification();
    renderVerification(verificationRequired);
    onStateChange();

    return true;
  };

  const scheduleVerificationExpiry = () => {
    window.clearTimeout(timers.expiry);

    if (
      !activeVerification?.expiresAt ||
      !["pending", "verified"].includes(activeVerification.status)
    ) {
      return;
    }

    const expiresAt = new Date(activeVerification.expiresAt).getTime();

    if (!Number.isFinite(expiresAt)) {
      return;
    }

    const delay = Math.max(0, expiresAt - Date.now() + 50);

    timers.expiry = window.setTimeout(
      updateExpiredVerification,
      Math.min(delay, 2_147_483_647)
    );
  };

  const scheduleVerificationPoll = (delayOverride = null) => {
    window.clearTimeout(timers.poll);

    if (!activeVerification?.id || activeVerification.status !== "pending") {
      return;
    }

    if (updateExpiredVerification()) {
      return;
    }

    const expiresAt = activeVerification.expiresAt
      ? new Date(activeVerification.expiresAt).getTime()
      : 0;
    const remainingMs =
      Number.isFinite(expiresAt) && expiresAt > 0
        ? expiresAt - Date.now()
        : VERIFICATION_POLL_DELAYS[VERIFICATION_POLL_DELAYS.length - 1];
    const defaultDelay = document.hidden
      ? 30_000
      : VERIFICATION_POLL_DELAYS[
        Math.min(verificationPollCount, VERIFICATION_POLL_DELAYS.length - 1)
      ];
    const baseDelay = Number.isFinite(delayOverride) ? Math.max(0, delayOverride) : defaultDelay;
    const delay = Math.max(1000, Math.min(baseDelay, remainingMs + 250));

    verificationPollScheduledAt = Date.now();
    verificationNextPollAt = verificationPollScheduledAt + delay;
    saveActiveVerification();
    timers.poll = window.setTimeout(pollVerification, delay);
  };

  // Poll Minecraft for MOTD proof
  const pollVerification = async () => {
    if (!activeVerification?.id || verificationCheckInFlightId === activeVerification.id) {
      return;
    }

    if (document.hidden) {
      scheduleVerificationPoll();

      return;
    }

    if (updateExpiredVerification()) {
      return;
    }

    const challengeId = activeVerification.id;

    verificationCheckInFlightId = challengeId;
    verificationPollCount += 1;
    verificationPollScheduledAt = 0;
    verificationNextPollAt = 0;
    saveActiveVerification();
    renderVerification(verificationRequired);

    try {
      const response = await fetch(
        apiUrl(`/api/servers/verification-challenges/${encodeURIComponent(challengeId)}`),
        {
          credentials: "include",
          headers: { accept: "application/json" },
        }
      );
      const data = await response.json().catch(() => ({}));

      if (response.status === 401 || response.status === 404) {
        activeVerification = null;
        activeVerificationIdentity = null;
        verificationPollCount = 0;
        verificationNextPollAt = 0;
        clearStoredVerification();
        renderVerification(verificationRequired);
        onStateChange();
        showToast({
          title: messages.submit.verification.expiredTitle,
          message: messages.submit.verification.staleMessage,
          kind: "is-error",
        });

        return;
      }

      if (!response.ok) {
        throw new Error(data.error || messages.submit.verification.unavailableMessage);
      }

      if (activeVerification?.id !== challengeId) {
        return;
      }

      activeVerification = {
        ...activeVerification,
        ...data.challenge,
      };

      if (activeVerification.status === "expired" || activeVerification.status === "consumed") {
        clearStoredVerification();
      } else {
        saveActiveVerification();
      }
    } catch {
      // A transient status failure shouldn't stop the polling cycle
    } finally {
      if (verificationCheckInFlightId === challengeId) {
        verificationCheckInFlightId = "";
      }

      if (activeVerification?.id === challengeId) {
        renderVerification(verificationRequired);
        onStateChange();
        scheduleVerificationPoll();
      }
    }
  };

  // Queue a new proof challenge
  const generateVerification = async () => {
    const address = form.elements.namedItem("address");
    const port = form.elements.namedItem("port");
    const name = form.elements.namedItem("name");
    const description = form.elements.namedItem("description");
    const issues = [];
    let firstInvalidControl = null;

    const addIssue = (control, message) => {
      issues.push(message);
      firstInvalidControl ||= control instanceof HTMLElement ? control : null;
    };

    const nameValue = name instanceof HTMLInputElement ? name.value.trim() : "";
    const addressValue = address instanceof HTMLInputElement ? address.value.trim() : "";
    const descriptionRawValue = description instanceof HTMLTextAreaElement ? description.value : "";
    const descriptionValue = descriptionRawValue.trim();

    if (nameValue.length < 3) {
      addIssue(name, messages.submit.verification.requirements.name);
    }

    if (!isValidPublicServerAddress(addressValue)) {
      addIssue(address, messages.submit.verification.requirements.address);
    }

    if (port instanceof HTMLInputElement && port.value && !port.checkValidity()) {
      addIssue(port, messages.submit.verification.requirements.port);
    }

    if (descriptionValue.length < 40) {
      addIssue(
        description,
        messages.submit.verification.requirements.descriptionMinimum(
          descriptionValue.length
        )
      );
    } else if (descriptionRawValue.length > SERVER_DESCRIPTION_LIMIT) {
      addIssue(description, messages.submit.verification.requirements.descriptionMaximum);
    }

    if (issues.length > 0) {
      showToast({
        title: messages.submit.verification.incompleteTitle,
        message: issues.join(" "),
        kind: "is-warning",
        delay: 6500,
      });
      firstInvalidControl?.focus();

      return;
    }

    clearStoredVerification();
    window.clearTimeout(timers.poll);
    window.clearTimeout(timers.expiry);
    window.clearInterval(timers.countdown);
    activeVerification = null;
    activeVerificationIdentity = currentVerificationTarget();
    verificationPollCount = 0;
    verificationPollScheduledAt = 0;
    verificationNextPollAt = 0;
    verificationBusy = true;
    renderVerification(verificationRequired);
    onStateChange();

    try {
      const formData = new FormData(form);
      const response = await fetch(apiUrl("/api/servers/verification-challenges"), {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          name: String(formData.get("name") ?? ""),
          address: String(formData.get("address") ?? ""),
          port: String(formData.get("port") ?? ""),
          description: String(formData.get("description") ?? ""),
        })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || messages.submit.verification.unavailableMessage);
      }

      activeVerification = {
        id: data.id,
        code: data.code,
        command: data.command,
        status: data.status,
        createdAt: data.createdAt,
        expiresAt: data.expiresAt,
        previouslyVerified: data.reused === true && data.status === "verified",
      };
      activeVerificationIdentity = currentVerificationTarget();
      verificationPollCount = 0;
      verificationPollScheduledAt = 0;
      verificationNextPollAt = 0;
      saveActiveVerification();

      if (activeVerification.status === "pending") {
        const createdAt = new Date(activeVerification.createdAt).getTime();
        const firstCheckDelay = Number.isFinite(createdAt)
          ? Math.max(0, createdAt + VERIFICATION_POLL_DELAYS[0] - Date.now())
          : VERIFICATION_POLL_DELAYS[0];

        scheduleVerificationPoll(firstCheckDelay);
      }
    } catch (error) {
      activeVerification = null;
      activeVerificationIdentity = null;
      showToast({
        title: messages.submit.verification.unavailableTitle,
        message:
          error instanceof Error
            ? error.message
            : messages.submit.verification.unavailableMessage,
        kind: "is-error",
      });
    } finally {
      verificationBusy = false;
      renderVerification(verificationRequired);
      onStateChange();
    }
  };

  const fallbackCopyText = (text) => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-1000px";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    try {
      return document.execCommand("copy");
    } finally {
      textarea.remove();
    }
  };

  const copyVerificationCommand = async (button, command) => {
    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(command).catch(() => {
          if (!fallbackCopyText(command)) {
            throw new Error("Clipboard fallback failed.");
          }
        });
      } else if (!fallbackCopyText(command)) {
        throw new Error("Clipboard fallback failed.");
      }

      window.clearTimeout(Number(button.dataset.copyResetTimer || 0));
      button.classList.add("is-copied");
      button.setAttribute("aria-label", `Copied verification command ${command}`);
      const status = button.querySelector("[data-copy-status]");

      if (status) {
        status.textContent = messages.submit.verification.copied;
      }

      showToast({
        title: messages.submit.verification.copiedTitle,
        message: messages.submit.verification.copiedMessage,
        kind: "is-success",
        delay: 3600,
      });
      const resetTimer = window.setTimeout(() => {
        button.classList.remove("is-copied");
        button.setAttribute("aria-label", `Copy verification command ${command}`);

        if (status) {
          status.textContent = "";
        }

        delete button.dataset.copyResetTimer;
      }, 1800);

      button.dataset.copyResetTimer = String(resetTimer);
    } catch {
      showToast({
        title: messages.submit.verification.copyFailureTitle,
        message: messages.submit.verification.copyFailureMessage,
        kind: "is-error",
      });
    }
  };

  const startVerificationCountdown = (indicator, value) => {
    window.clearInterval(timers.countdown);

    const update = () => {
      if (
        !activeVerification?.id ||
        activeVerification.status !== "pending" ||
        !verificationNextPollAt
      ) {
        indicator.classList.add("is-paused");
        value.textContent = "0s";
        indicator.style.setProperty("--poll-progress", "0deg");

        return;
      }

      if (document.hidden) {
        indicator.classList.add("is-paused");
        value.textContent = "-";
        indicator.style.setProperty("--poll-progress", "0deg");

        return;
      }

      indicator.classList.remove("is-paused");
      const remainingMs = Math.max(0, verificationNextPollAt - Date.now());
      const totalMs = Math.max(
        1000,
        verificationNextPollAt - (verificationPollScheduledAt || Date.now())
      );
      const progress = Math.max(0, Math.min(1, remainingMs / totalMs));

      value.textContent = `${Math.ceil(remainingMs / 1000)}s`;
      indicator.style.setProperty("--poll-progress", `${Math.round(progress * 360)}deg`);
    };

    update();
    timers.countdown = window.setInterval(update, 250);
  };

  const verificationStatusCopy = (status) => {
    if (status === "verified") {
      return {
        title: messages.submit.verification.verifiedTitle,
        message: activeVerification.previouslyVerified
          ? messages.submit.verificationComplete.message
          : canKeepPreviousVerification
            ? messages.submit.verification.verifiedUpdateMessage
            : messages.submit.verification.verifiedMessage,
      };
    }

    if (status === "expired") {
      return {
        title: messages.submit.verification.expiredTitle,
        message: messages.submit.verification.expiredMessage,
      };
    }

    return {
      title: messages.submit.verification.pendingTitle,
      message: messages.submit.verification.pendingMessage,
    };
  };

  const createVerificationPanel = () => {
    if (!activeVerification) {
      return null;
    }

    const column = document.createElement("div");
    column.className = "col-12";

    const panel = document.createElement("div");
    panel.className = "server-submit-verification-panel d-grid gap-3";

    if (activeVerification) {
      const status = activeVerification.status;
      const notice = document.createElement("div");
      notice.className = `server-submit-notice d-flex flex-column flex-md-row align-items-md-center gap-3 p-3 rounded-3 ${status === "verified" ? "is-success" : status === "expired" ? "is-error" : "is-warning"}`.trim();

      const noticeMain = document.createElement("div");
      noticeMain.className = "d-flex align-items-start align-items-md-center gap-3 flex-grow-1 min-w-0";

      const icon = document.createElement("i");
      icon.className = `${status === "verified" ? "fa-solid fa-circle-check" : status === "expired" ? "fa-solid fa-triangle-exclamation" : "fa-solid fa-clock"} align-self-center`;
      icon.setAttribute("aria-hidden", "true");

      const content = document.createElement("div");
      content.className = "d-grid gap-1 min-w-0 flex-grow-1";
      const copy = verificationStatusCopy(status);
      const title = document.createElement("strong");
      title.textContent = copy.title;
      const message = document.createElement("p");
      message.className = "mb-0";
      message.textContent = copy.message;
      content.append(title, message);
      noticeMain.append(icon, content);
      notice.append(noticeMain);

      if (status === "pending") {
        const pollStatus = document.createElement("div");
        pollStatus.className = "server-verification-poll d-flex flex-row flex-md-column align-items-center justify-content-end justify-content-md-center gap-2 ms-md-auto flex-shrink-0 text-center";

        const label = document.createElement("span");
        label.className = "server-verification-poll-label text-uppercase text-nowrap";
        label.textContent = messages.submit.verification.nextCheck;

        const indicator = document.createElement("span");
        indicator.className = "server-verification-poll-ring d-inline-flex align-items-center justify-content-center rounded-circle";
        indicator.setAttribute("aria-hidden", "true");

        const value = document.createElement("span");
        value.className = "server-verification-poll-value";
        indicator.append(value);

        pollStatus.append(label, indicator);
        notice.append(pollStatus);
        startVerificationCountdown(indicator, value);
      }

      panel.append(notice);

      if (activeVerification.command && status === "pending") {
        const command = document.createElement("div");
        command.className = "server-verification-command d-flex flex-column flex-md-row align-items-md-center gap-2 p-3 border rounded-3";

        const commandText = document.createElement("button");
        commandText.className = "server-verification-command-text flex-grow-1 text-start p-3 border rounded-2";
        commandText.type = "button";
        commandText.setAttribute(
          "aria-label",
          `Copy verification command ${activeVerification.command}`
        );
        const code = document.createElement("code");
        code.textContent = activeVerification.command;
        commandText.append(code);

        const copy = document.createElement("button");
        copy.className = "btn btn-site copy-action server-verification-copy d-inline-flex align-items-center justify-content-center gap-2 fw-bold position-relative overflow-hidden";
        copy.type = "button";
        copy.dataset.copySuccessLabel = "Copied!";
        copy.setAttribute(
          "aria-label",
          `Copy verification command ${activeVerification.command}`
        );
        copy.innerHTML = `<span class="position-relative z-1">${messages.submit.verification.copy}</span><i class="copy-action-icon fa-regular fa-copy flex-shrink-0 position-relative z-1" aria-hidden="true"></i><span class="visually-hidden" data-copy-status aria-live="polite"></span>`;
        copy.addEventListener("click", () =>
          copyVerificationCommand(copy, activeVerification.command)
        );
        commandText.addEventListener("click", () =>
          copyVerificationCommand(copy, activeVerification.command)
        );

        command.append(commandText, copy);
        panel.append(command);
      }
    }

    column.append(panel);

    return column;
  };

  const renderVerificationHeader = (requiresVerification) => {
    reviewAction.replaceChildren();
    const canGenerate =
      requiresVerification &&
      (!activeVerification ||
        activeVerification.status === "expired" ||
        !verificationIdentityMatches());

    if (!canGenerate) {
      return;
    }

    const generate = document.createElement("button");
    generate.className = "btn btn-site server-verification-start d-inline-flex align-items-center justify-content-center gap-2 fw-bold mx-auto mx-md-0 mw-100";
    generate.type = "button";
    generate.disabled = verificationBusy;
    generate.innerHTML = verificationBusy
      ? `<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> ${messages.submit.verification.generating}`
      : `<i class="fa-solid fa-key" aria-hidden="true"></i> ${messages.submit.verification.generate}`;
    generate.addEventListener("click", generateVerification);
    reviewAction.append(generate);
  };

  const renderVerification = (requiresVerification) => {
    if (!(reviewRow instanceof HTMLElement)) {
      return;
    }

    window.clearInterval(timers.countdown);
    verificationRequired = requiresVerification;
    scheduleVerificationExpiry();
    renderVerificationHeader(requiresVerification);
    reviewRow.replaceChildren();

    if (canKeepPreviousVerification && !requiresVerification) {
      reviewRow.append(createVerificationComplete());

      return;
    }

    const verificationPanel = createVerificationPanel();

    reviewRow.append(
      ...(canKeepPreviousVerification ? [createIdentityChangedNotice()] : []),
      ...(verificationPanel ? [verificationPanel] : [])
    );
  };

  return {
    get verificationRequired() {
      return verificationRequired;
    },
    set verificationRequired(value) {
      verificationRequired = value;
    },
    get activeVerification() {
      return activeVerification;
    },
    get nextPollAt() {
      return verificationNextPollAt;
    },
    verificationIsComplete,
    verificationIdentityMatches,
    restoreActiveVerification,
    renderVerification,
    scheduleVerificationPoll,
    clearStoredVerification,
    resetIdentityMismatch: () => {
      activeVerification = null;
      activeVerificationIdentity = null;
      verificationPollCount = 0;
      verificationNextPollAt = 0;
      window.clearTimeout(timers.poll);
      window.clearTimeout(timers.expiry);
      window.clearInterval(timers.countdown);
    },
    clearTimers: () => {
      window.clearTimeout(timers.poll);
      window.clearTimeout(timers.expiry);
      window.clearInterval(timers.countdown);
    },
  };
};
