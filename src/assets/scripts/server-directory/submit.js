import { Toast } from "bootstrap";
import {
  appendServerLink,
  createOwnerStat,
  createReviewDateStat,
  createReviewStatus,
  createServerCardShell,
  createServerStat,
  createServerStatus,
  formatDate,
  playerCountLabel,
  readSocialFormValues,
  SERVER_DESCRIPTION_LIMIT,
  versionLabel,
} from "./ui.js";
import {
  VERIFICATION_POLL_DELAYS,
  createVerificationController,
} from "./submit-verification.js";
import { createSubmitFormKit } from "./submit-forms.js";

const SERVER_MESSAGES = {
  submit: {
    loggedOutSteps: [
      {
        icon: "fa-brands fa-discord",
        title: "Sign in with Discord",
        text: "Log in with your Discord account so you can manage your submission later.",
      },
      {
        icon: "fa-solid fa-list-check",
        title: "Add server details",
        text: "Enter the public address, description, website, and social links you want shown on your listing.",
      },
      {
        icon: "fa-solid fa-stamp",
        title: "Wait for review",
        text: "Staff checks the listing before it appears. If it is rejected, you can update it and resubmit.",
      },
    ],
    protectionMissing: "Submission protection is not configured for this build. Set PUBLIC_TURNSTILE_SITE_KEY before enabling production submissions.",
    verification: {
      help: "Confirm that your server is running KingdomsX.",
      generate: "Start Verification",
      generating: "Starting Verification",
      pendingTitle: "Waiting for your server",
      pendingMessage: "Run the command below in-game or from your server console. This page will update automatically once your server responds and verification is complete.",
      verifiedTitle: "Server verified",
      verifiedMessage: "Your server responded successfully, confirming that you are running KingdomsX. You can now submit your listing for review.",
      verifiedUpdateMessage: "Your server responded successfully, confirming that you are running KingdomsX. You can now save your changes.",
      expiredTitle: "Verification failed",
      expiredMessage: "Your server did not respond before the verification code expired, so we couldn't confirm that you are running KingdomsX. Start verification again to try once more.",
      unavailableTitle: "Couldn't start verification",
      unavailableMessage: "Verification could not be started.",
      staleMessage: "This verification session is no longer available. Start verification again.",
      incompleteTitle: "Complete your server details",
      copy: "Copy Command",
      copied: "Copied!",
      copiedTitle: "Command Copied",
      copiedMessage: "Paste the command into your Minecraft server to continue verification.",
      copyFailureTitle: "Couldn't Copy Command",
      copyFailureMessage: "Unable to copy the command.",
      nextCheck: "Next check",
      requiredMessage: "Complete the plugin verification before submitting.",
      requirements: {
        name: "Enter a server name with at least 3 characters.",
        address: "Enter a valid public Minecraft server address.",
        port: "The port must be between 1 and 65535.",
        descriptionMinimum: (length) => `Write at least 40 characters in the description (${length}/40).`,
        descriptionMaximum: `Keep the description within ${SERVER_DESCRIPTION_LIMIT} characters.`,
      },
    },
    verificationExpired: {
      title: "Verification expired",
      message: "Since you changed your server address or port, you will need to verify your server again. This is used to confirm that your server is still running KingdomsX.",
    },
    verificationComplete: {
      title: "Verification complete",
      message: "Your previous verification is still valid. Your server is confirmed to be running KingdomsX.",
    },
    unchangedResubmit: "Please correct the issues mentioned in the staff review feedback before resubmitting for new review.",
    reviewFeedback: {
      title: "Review feedback",
      suspended: "Staff suspended this listing. It cannot be edited or resubmitted again. You need to contact staff on Discord and try to resolve the issue.",
      hiddenOffline: "Your server listing was hidden after extended downtime. Update the details once the server is reachable, then resubmit for review.",
      fallback: "Staff needs changes before this listing can be approved.",
    },
    status: {
      pending: "Your server is waiting for staff review.",
      approved: "Your server is approved and visible on the public server list.",
      rejected: "This listing needs changes before staff can approve it.",
      suspended: "This listing is suspended. Contact staff if you believe it should be reviewed again.",
      hidden_offline: "This approved listing is hidden because it has been offline for an extended period. You can submit corrected details for a new staff review.",
      fallback: "This listing is tied to your Discord account.",
    },
    notifications: {
      approvedTitle: "Listing approved",
      pendingTitle: "Review pending",
      feedbackTitle: "Review feedback",
    },
    toasts: {
      noChangesMade: {
        title: "No Changes Made",
        message: "Please correct the issues mentioned in the staff review feedback before resubmitting for a new review.",
      },
      noChangesToSave: {
        title: "No Changes to Save",
        message: "Your server details are already up to date.",
      },
      noPublicChangesToSave: {
        title: "No Changes to Save",
        message: "Your server details are already up to date.",
      },
      submitting: {
        reviewTitle: "Submitting for Review",
        saveTitle: "Saving Changes",
        reviewMessage: "Sending your server listing to staff review...",
        saveMessage: "Saving your public server details...",
      },
      success: {
        suspendedTitle: "Submission Suspended",
        submittedTitle: "Submitted for Review",
        savedTitle: "Changes Saved",
        suspendedMessage: "This server address is suspended and cannot be sent to staff for review.",
        submittedMessage: "Staff will review your submission before it appears on the public server list.",
        savedMessage: "Your public server details were saved.",
      },
      failure: {
        submissionTitle: "Submission Failed",
        saveTitle: "Save Failed",
        submissionMessage: "Submission failed.",
        saveMessage: "Unable to save changes.",
        deleteTitle: "Delete failed",
        deleteMessage: "Unable to delete submission.",
      },
    },
    disabledReasons: {
      suspended: "Suspended submissions cannot be edited or resubmitted.",
      pending: "Server details can't be edited while the submission is on staff review.",
    },
    deleteConfirm: "Are you sure you want to delete your server submission? This cannot be undone.",
    dashboardUnavailableTitle: "Submission dashboard is unavailable.",
    dashboardUnavailableMessage: "Please try again soon.",
    loadStatusError: "Unable to check submission status.",
  }
};

const initServerSubmit = () => {
  const root = document.querySelector("[data-server-submit-dashboard]");

  if (!(root instanceof HTMLElement)) {
    return;
  }

  const apiBase = root.dataset.serverApiBase || window.location.origin;
  const turnstileSiteKey = root.dataset.turnstileSiteKey || "";
  const isLocalBuild = root.dataset.localBuild === "true";
  const serversUrl = root.dataset.serversUrl || "/servers";
  const submitSection = root.closest(".servers-submit");
  let currentState = null;

  const apiUrl = (path) => new URL(path, apiBase);
  const currentReturnPath = () => `${window.location.pathname}${window.location.search}`;

  const ensureToastContainer = () => {
    let container = document.querySelector("[data-server-submit-toast-container]");

    if (container instanceof HTMLElement) {
      return container;
    }

    container = document.createElement("div");
    container.className = "toast-container position-fixed bottom-0 end-0 p-3 server-submit-toast-container";
    container.dataset.serverSubmitToastContainer = "";
    document.body.append(container);

    return container;
  };

  const toastIconClass = (kind) =>
    ({
      "is-success": "fa-solid fa-circle-check",
      "is-error": "fa-solid fa-triangle-exclamation",
      "is-warning": "fa-solid fa-clock",
    })[kind] || "fa-solid fa-circle-info";

  const showToast = ({ title, message, kind = "", autohide = true, delay = 6000 }) => {
    const container = ensureToastContainer();
    const toastNode = document.createElement("div");
    toastNode.className = `toast server-submit-toast ${kind}`.trim();
    toastNode.style.setProperty("--server-submit-toast-delay", `${delay}ms`);
    toastNode.setAttribute("role", kind === "is-error" ? "alert" : "status");
    toastNode.setAttribute("aria-live", kind === "is-error" ? "assertive" : "polite");
    toastNode.setAttribute("aria-atomic", "true");

    if (autohide) {
      toastNode.classList.add("is-autohide");
    }

    const header = document.createElement("div");
    header.className = "toast-header server-submit-toast-header";

    const icon = document.createElement("i");
    icon.className = `${toastIconClass(kind)} me-2`;
    icon.setAttribute("aria-hidden", "true");

    const heading = document.createElement("strong");
    heading.className = "me-auto";
    heading.textContent = title;

    const close = document.createElement("button");
    close.type = "button";
    close.className = "btn-close btn-close-white";
    close.dataset.bsDismiss = "toast";
    close.setAttribute("aria-label", "Close");

    const body = document.createElement("div");
    body.className = "toast-body";
    body.textContent = message;

    const progress = document.createElement("div");
    progress.className = "server-submit-toast-progress";
    progress.setAttribute("aria-hidden", "true");
    ["top", "right", "bottom"].forEach((edge) => {
      const segment = document.createElement("span");
      segment.className = `server-submit-toast-progress-edge is-${edge}`;
      progress.append(segment);
    });

    header.append(icon, heading, close);
    toastNode.append(header, body, progress);
    container.append(toastNode);

    const toast = Toast.getOrCreateInstance(toastNode, { autohide, delay });

    if (autohide) {
      const pauseProgress = () => toastNode.classList.add("is-progress-paused");
      const resumeProgress = () => toastNode.classList.remove("is-progress-paused");

      toastNode.addEventListener("mouseover", pauseProgress);
      toastNode.addEventListener("mouseout", resumeProgress);
      toastNode.addEventListener("focusin", pauseProgress);
      toastNode.addEventListener("focusout", resumeProgress);
    }

    toastNode.addEventListener(
      "hidden.bs.toast",
      () => {
        toast.dispose();
        toastNode.remove();
      },
      { once: true }
    );
    toast.show();

    return { node: toastNode, toast };
  };

  const dismissToast = (handle) => {
    if (handle?.node?.isConnected) {
      handle.toast.hide();
    }
  };

  const setSubmitView = (view) => {
    submitSection?.classList.toggle("is-logged-out", view === "logged-out");
  };

  const verificationTimers = { poll: 0, countdown: 0, expiry: 0 };
  let load = async () => {};
  let replaceRoot = () => {};

  const forms = createSubmitFormKit({
    root,
    page: { apiUrl, currentReturnPath, serversUrl, turnstileSiteKey },
    messages: SERVER_MESSAGES,
    render: {
      setSubmitView,
      replaceRoot: (...nodes) => replaceRoot(...nodes),
      reload: () => load(),
    },
  });

  const {
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
  } = forms;

  replaceRoot = (...nodes) => {
    disposeTooltips();
    window.clearTimeout(verificationTimers.poll);
    window.clearTimeout(verificationTimers.expiry);
    window.clearInterval(verificationTimers.countdown);
    root.removeAttribute("aria-busy");
    root.replaceChildren(...nodes);
  };

  const renderForm = (mode, item = null) => {
    setSubmitView("authenticated");
    const panel = document.createElement("div");
    panel.className = "server-submit-form-shell d-flex flex-column gap-4";

    if (currentState?.user) {
      panel.append(createAccountBar(currentState.user));
    }

    if (item?.rejectionReason) {
      panel.append(createNotificationArea([notificationFromItem(item)]));
    }

    const form = document.createElement("form");
    form.className = "server-submit-form d-flex flex-column gap-4";
    form.noValidate = false;
    const baselineIdentity = item ? identitySnapshot(item) : null;
    const baselinePublic = item ? publicSnapshot(item) : null;

    const identity = createSubmitSection(
      "Server Information",
      field("name", "Server name", {
        required: true,
        maxLength: 80,
        autocomplete: "organization",
        value: item?.name,
        placeholder: "KingdomsX Realm",
      }),
      createAddressPortGroup(item),
      field("description", "Description", {
        column: "col-12",
        textarea: true,
        rows: 4,
        required: true,
        minLength: 40,
        maxLength: SERVER_DESCRIPTION_LIMIT,
        allowOverLimit: true,
        value: item?.description,
        placeholder: `Describe the server experience in ${SERVER_DESCRIPTION_LIMIT} characters or less.`,
        counter: true,
      })
    );

    const publicFields = document.createElement("div");
    publicFields.className = "row g-3";
    appendPublicFields(publicFields, item);

    const publicSection = document.createElement("section");
    publicSection.className = "server-submit-section surface-lift d-flex flex-column gap-3 p-3 p-md-4 rounded-3";
    const publicTitle = document.createElement("h2");
    publicTitle.className = "server-submit-section-title mb-0";
    publicTitle.textContent = "Website & Socials";
    publicSection.append(publicTitle, publicFields);

    const createIdentityChangedNotice = () => {
      const column = document.createElement("div");
      column.className = "col-12";

      const notice = document.createElement("div");
      notice.className = "server-submit-notice is-error d-flex align-items-center gap-3 p-3 rounded-3";

      const icon = document.createElement("i");
      icon.className = "fa-solid fa-triangle-exclamation d-inline-flex align-items-center justify-content-center flex-shrink-0";
      icon.setAttribute("aria-hidden", "true");

      const content = document.createElement("div");
      content.className = "d-grid gap-1 min-w-0";

      const title = document.createElement("strong");
      title.textContent = SERVER_MESSAGES.submit.verificationExpired.title;

      const message = document.createElement("p");
      message.className = "mb-0";
      message.textContent = SERVER_MESSAGES.submit.verificationExpired.message;

      content.append(title, message);
      notice.append(icon, content);
      column.append(notice);

      return column;
    };

    const createVerificationComplete = () => {
      const column = document.createElement("div");
      column.className = "col-12";

      const notice = document.createElement("div");
      notice.className = "server-submit-notice is-success d-flex align-items-center gap-3 p-3 rounded-3";

      const icon = document.createElement("i");
      icon.className = "fa-solid fa-circle-check d-inline-flex align-items-center justify-content-center flex-shrink-0";
      icon.setAttribute("aria-hidden", "true");

      const content = document.createElement("div");
      content.className = "d-grid gap-1 min-w-0";

      const title = document.createElement("strong");
      title.textContent = SERVER_MESSAGES.submit.verificationComplete.title;

      const message = document.createElement("p");
      message.className = "mb-0";
      message.textContent = SERVER_MESSAGES.submit.verificationComplete.message;

      content.append(title, message);
      notice.append(icon, content);
      column.append(notice);

      return column;
    };

    const currentIdentitySnapshot = () => {
      const formData = new FormData(form);

      return {
        name: comparableValue(formData.get("name")),
        address: comparableValue(formData.get("address")).toLowerCase(),
        port: comparableValue(formData.get("port") || "25565") || "25565",
      };
    };

    const currentVerificationTarget = () => {
      const formData = new FormData(form);

      return {
        address: comparableValue(formData.get("address")).toLowerCase(),
        port: comparableValue(formData.get("port") || "25565") || "25565",
      };
    };

    const currentPublicSnapshot = () => {
      const formData = new FormData(form);

      return {
        description: comparableValue(formData.get("description")),
        websiteUrl: comparableValue(formData.get("websiteUrl")),
        ...readSocialFormValues(formData, comparableValue),
      };
    };

    const review = createSubmitSection("Server Verification");
    const reviewRow = review.querySelector(".row");
    const reviewHeading = review.querySelector(".server-submit-section-title");
    const reviewHeader = document.createElement("div");
    reviewHeader.className = "d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3";

    const reviewIntro = document.createElement("div");
    reviewIntro.className = "d-grid gap-1 min-w-0";

    const reviewHelp = document.createElement("p");
    reviewHelp.className = "server-submit-proof-help mb-0";
    reviewHelp.textContent = SERVER_MESSAGES.submit.verification.help;

    const reviewAction = document.createElement("div");
    reviewAction.className = "d-flex flex-shrink-0";

    if (reviewHeading instanceof HTMLElement) {
      reviewHeading.replaceWith(reviewHeader);
      reviewIntro.append(reviewHeading, reviewHelp);
      reviewHeader.append(reviewIntro, reviewAction);
    }

    const canKeepPreviousVerification =
      (mode === "edit" && item?.reviewStatus === "approved") ||
      (mode === "resubmit" &&
        item?.reviewStatus === "rejected" &&
        item?.reverificationRequired === false);
    const submitHooks = { updateSubmitState: () => {} };

    const verification = createVerificationController({
      form,
      reviewRow,
      reviewAction,
      state: { canKeepPreviousVerification, currentState, timers: verificationTimers },
      page: { apiUrl, messages: SERVER_MESSAGES, showToast },
      render: {
        isValidPublicServerAddress,
        createIdentityChangedNotice,
        createVerificationComplete,
        currentVerificationTarget,
        onStateChange: () => submitHooks.updateSubmitState(),
      },
    });

    verification.restoreActiveVerification();

    const actions = document.createElement("div");
    actions.className = "server-submit-actions d-flex flex-column flex-sm-row align-items-center justify-content-center gap-3";

    const submit = document.createElement("button");
    submit.className = "btn btn-site btn-site-primary d-inline-flex align-items-center justify-content-center gap-2 fw-bold";
    submit.type = "submit";
    submit.innerHTML = `<i class="fa-solid fa-paper-plane" aria-hidden="true"></i> ${submitButtonLabel(mode)}`;

    const view = document.createElement("a");
    view.className = "btn btn-site d-inline-flex align-items-center justify-content-center gap-2 fw-bold";
    view.href = serversUrl;
    view.innerHTML = '<i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Back to Servers';

    if (item) {
      const cancel = document.createElement("button");
      cancel.className = "btn btn-site d-inline-flex align-items-center justify-content-center gap-2 fw-bold";
      cancel.type = "button";
      cancel.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i> Cancel';
      cancel.addEventListener("click", () => renderOwnedState(item));
      actions.append(submit, cancel);
    } else {
      actions.append(submit, view);
    }

    form.append(identity, publicSection, review, renderTurnstileField(), actions);
    panel.append(form);
    replaceRoot(panel);

    if (turnstileSiteKey) {
      renderTurnstile(form);
    }

    verification.renderVerification(verification.verificationRequired);

    const hasObjectChanges = (current, baseline) =>
      Boolean(baseline) && Object.keys(current).some((key) => current[key] !== baseline[key]);

    const formHasChanges = () => {
      const verificationChanged = verification.verificationRequired && verification.verificationIsComplete();

      return (
        hasObjectChanges(currentIdentitySnapshot(), baselineIdentity) ||
        hasObjectChanges(currentPublicSnapshot(), baselinePublic) ||
        verificationChanged
      );
    };

    const hasResubmitChanges = () => mode !== "resubmit" || formHasChanges();

    submitHooks.updateSubmitState = () => {
      const blockedByProtection = !turnstileSiteKey && !isLocalBuild;
      const blockedByUnchangedResubmit = mode === "resubmit" && !hasResubmitChanges();
      const blockedByVerification = verification.verificationRequired && !verification.verificationIsComplete();

      submit.disabled = blockedByProtection || blockedByVerification;
      submit.title = blockedByUnchangedResubmit
        ? SERVER_MESSAGES.submit.unchangedResubmit
        : blockedByVerification
          ? SERVER_MESSAGES.submit.verification.requiredMessage
          : "";
    };

    const updateProofRequirement = () => {
      if (verification.activeVerification && !verification.verificationIdentityMatches()) {
        verification.clearStoredVerification();
        verification.resetIdentityMismatch();
        verification.renderVerification(verification.verificationRequired);
      }

      if (!baselineIdentity || !canKeepPreviousVerification) {
        submitHooks.updateSubmitState();

        return;
      }

      const currentIdentity = currentIdentitySnapshot();
      const requiresVerification =
        currentIdentity.address !== baselineIdentity.address ||
        currentIdentity.port !== baselineIdentity.port;

      if (requiresVerification !== verification.verificationRequired) {
        verification.verificationRequired = requiresVerification;
        verification.renderVerification(requiresVerification);
      } else if (requiresVerification) {
        verification.renderVerification(requiresVerification);
      }

      submit.innerHTML = `<i class="fa-solid fa-paper-plane" aria-hidden="true"></i> ${submitButtonLabel(mode)}`;
      submitHooks.updateSubmitState();
    };

    ["address", "port"].forEach((fieldName) => {
      const control = form.elements.namedItem(fieldName);

      if (control instanceof HTMLElement) {
        control.addEventListener("input", updateProofRequirement);
      }
    });
    updateProofRequirement();
    form.addEventListener("input", () => submitHooks.updateSubmitState());
    form.addEventListener("change", () => submitHooks.updateSubmitState());
    submitHooks.updateSubmitState();

    if (verification.activeVerification?.status === "pending") {
      const createdAt = new Date(verification.activeVerification.createdAt).getTime();
      const fallbackFirstCheckAt = Number.isFinite(createdAt)
        ? createdAt + VERIFICATION_POLL_DELAYS[0]
        : Date.now() + VERIFICATION_POLL_DELAYS[0];
      const scheduledAt = verification.nextPollAt || fallbackFirstCheckAt;

      verification.scheduleVerificationPoll(Math.max(0, scheduledAt - Date.now()));
      verification.renderVerification(verification.verificationRequired);
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      const description = form.elements.namedItem("description");

      if (
        description instanceof HTMLTextAreaElement &&
        description.value.length > SERVER_DESCRIPTION_LIMIT
      ) {
        showToast({
          title: SERVER_MESSAGES.submit.verification.incompleteTitle,
          message: SERVER_MESSAGES.submit.verification.requirements.descriptionMaximum,
          kind: "is-warning",
          delay: 6500,
        });
        description.focus();

        return;
      }

      if (!form.reportValidity()) {
        return;
      }

      if (mode === "resubmit" && !hasResubmitChanges()) {
        showToast({
          title: SERVER_MESSAGES.submit.toasts.noChangesMade.title,
          message: SERVER_MESSAGES.submit.toasts.noChangesMade.message,
          kind: "is-warning",
        });
        submitHooks.updateSubmitState();

        return;
      }

      if (mode === "edit" && !formHasChanges()) {
        showToast({
          title: SERVER_MESSAGES.submit.toasts.noChangesToSave.title,
          message: SERVER_MESSAGES.submit.toasts.noChangesToSave.message,
          kind: "is-success",
        });
        renderOwnedState(item);

        return;
      }

      const needsStaffReview = mode !== "edit";
      const requiresVerification = verification.verificationRequired;

      if (requiresVerification && !verification.verificationIsComplete()) {
        showToast({
          title: SERVER_MESSAGES.submit.verification.pendingTitle,
          message: SERVER_MESSAGES.submit.verification.requiredMessage,
          kind: "is-warning",
        });
        submitHooks.updateSubmitState();

        return;
      }

      const payload = submissionPayload(form, verification.activeVerification?.id ?? "");

      submit.disabled = true;
      const progressToast = showToast({
        title: needsStaffReview
          ? SERVER_MESSAGES.submit.toasts.submitting.reviewTitle
          : SERVER_MESSAGES.submit.toasts.submitting.saveTitle,
        message: needsStaffReview
          ? SERVER_MESSAGES.submit.toasts.submitting.reviewMessage
          : SERVER_MESSAGES.submit.toasts.submitting.saveMessage,
        kind: "is-warning",
        autohide: false,
      });

      try {
        const endpoint = needsStaffReview
          ? mode === "new"
            ? "/api/servers/submit"
            : "/api/servers/me/resubmit"
          : requiresVerification
            ? "/api/servers/me/resubmit"
            : "/api/servers/me/details";
        const response = await fetch(apiUrl(endpoint), {
          method: needsStaffReview || requiresVerification ? "POST" : "PATCH",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(
            needsStaffReview || requiresVerification ? payload : approvedDetailsPayload(form)
          )
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            data.error ||
              (needsStaffReview
                ? SERVER_MESSAGES.submit.toasts.failure.submissionMessage
                : SERVER_MESSAGES.submit.toasts.failure.saveMessage)
          );
        }

        if (requiresVerification) {
          verification.clearStoredVerification();
        }

        window.turnstile?.reset?.();
        dismissToast(progressToast);
        const autoSuspended = data.status === "suspended" || data.item?.reviewStatus === "suspended";

        showToast({
          title: autoSuspended
            ? SERVER_MESSAGES.submit.toasts.success.suspendedTitle
            : needsStaffReview
              ? SERVER_MESSAGES.submit.toasts.success.submittedTitle
              : SERVER_MESSAGES.submit.toasts.success.savedTitle,
          message: autoSuspended
            ? SERVER_MESSAGES.submit.toasts.success.suspendedMessage
            : needsStaffReview
              ? SERVER_MESSAGES.submit.toasts.success.submittedMessage
              : SERVER_MESSAGES.submit.toasts.success.savedMessage,
          kind: autoSuspended ? "is-error" : "is-success",
        });
        load();
      } catch (error) {
        window.turnstile?.reset?.();
        dismissToast(progressToast);
        showToast({
          title: needsStaffReview
            ? SERVER_MESSAGES.submit.toasts.failure.submissionTitle
            : SERVER_MESSAGES.submit.toasts.failure.saveTitle,
          message:
            error instanceof Error
              ? error.message
              : needsStaffReview
                ? SERVER_MESSAGES.submit.toasts.failure.submissionMessage
                : SERVER_MESSAGES.submit.toasts.failure.saveMessage,
          kind: "is-error",
          delay: 6200,
        });
      } finally {
        submitHooks.updateSubmitState();
      }
    });
  };

  const createReviewFeedback = (item) => {
    const reason = document.createElement("section");
    reason.className = "server-submit-reason surface-lift d-flex gap-3 p-3 rounded-3";
    reason.innerHTML = '<i class="fa-solid fa-circle-exclamation flex-shrink-0" aria-hidden="true"></i>';

    const content = document.createElement("div");
    content.className = "d-grid gap-2";
    const title = document.createElement("strong");
    title.textContent = SERVER_MESSAGES.submit.reviewFeedback.title;
    const text = document.createElement("p");
    text.className = "mb-0";
    text.textContent =
      item?.rejectionReason ||
      ({
        suspended: SERVER_MESSAGES.submit.reviewFeedback.suspended,
        hidden_offline: SERVER_MESSAGES.submit.reviewFeedback.hiddenOffline,
      })[item?.reviewStatus] ||
      SERVER_MESSAGES.submit.reviewFeedback.fallback;
    content.append(title, text);
    reason.append(content);

    return reason;
  };

  const notificationFromItem = (item) => ({
    kind:
      item.reviewStatus === "approved"
        ? "is-success"
        : item.reviewStatus === "pending"
          ? "is-warning"
          : "is-error",
    icon:
      item.reviewStatus === "approved"
        ? "fa-solid fa-circle-check"
        : item.reviewStatus === "pending"
          ? "fa-solid fa-clock"
          : "fa-solid fa-circle-exclamation",
    title:
      item.reviewStatus === "approved"
        ? SERVER_MESSAGES.submit.notifications.approvedTitle
        : item.reviewStatus === "pending"
          ? SERVER_MESSAGES.submit.notifications.pendingTitle
          : SERVER_MESSAGES.submit.notifications.feedbackTitle,
    message: item.rejectionReason || statusMessage(item),
  });

  const createNotificationArea = (items) => {
    const area = document.createElement("div");
    area.className = "server-submit-notifications d-flex flex-column gap-3";

    items.filter(Boolean).forEach((item) => {
      const notice = document.createElement("section");
      notice.className = `server-submit-notice surface-lift d-flex align-items-center gap-3 p-3 rounded-3 ${item.kind || ""}`.trim();

      const icon = document.createElement("i");
      icon.className = `${item.icon || "fa-solid fa-circle-info"} d-inline-flex align-items-center justify-content-center flex-shrink-0`;
      icon.setAttribute("aria-hidden", "true");

      const content = document.createElement("div");
      content.className = "d-grid gap-1 min-w-0";
      const title = document.createElement("strong");
      title.textContent = item.title;
      const message = document.createElement("p");
      message.className = "mb-0";
      message.textContent = item.message;
      content.append(title, message);
      notice.append(icon, content);
      area.append(notice);
    });

    return area;
  };

  const createServerSummary = (item, actions = null) => {
    const chips = document.createElement("div");
    chips.className = "server-card-tags d-flex flex-wrap align-items-start justify-content-end gap-2 flex-shrink-0";
    chips.append(createServerStatus(item.status, { shrink: true }), createReviewStatus(item));

    const stats = document.createElement("div");
    stats.className = "server-stats row row-cols-1 row-cols-sm-2 g-2";
    stats.append(
      createOwnerStat(item.owner, "col-12 w-100"),
      createServerStat("Players", playerCountLabel(item.status), "fa-solid fa-user-group"),
      createServerStat("Version", versionLabel(item.status), "fa-solid fa-code-branch"),
      createServerStat(
        "Submitted",
        formatDate(item.submission?.createdAt ?? item.createdAt),
        "fa-solid fa-clock",
      ),
      createReviewDateStat(item)
    );

    const links = document.createElement("div");
    links.className = "server-links d-flex flex-wrap gap-2";
    appendServerLink(links, item.websiteUrl, "Website", "website");
    (item.socialLinks ?? []).forEach((link) => {
      appendServerLink(
        links,
        link.url,
        link.host ? `${link.label}: ${link.host}` : link.label,
        link.key,
        link.label
      );
    });

    const footer = document.createElement("div");
    footer.className = "server-card-bottom d-flex flex-wrap align-items-center justify-content-between gap-2 mt-auto min-w-0";

    const hasLinks = links.childElementCount > 0;

    if (hasLinks) {
      footer.append(links);
    }

    if (actions instanceof HTMLElement && actions.childElementCount > 0) {
      footer.append(actions);
    }

    if (!hasLinks) {
      footer.classList.remove("justify-content-between");
      footer.classList.add("justify-content-end");
    }

    const summary = createServerCardShell({
      server: item,
      headingTag: "h2",
      cardClassName:
        "server-card surface-panel surface-lift server-submit-summary d-flex flex-column gap-3 w-100 p-3 overflow-hidden rounded-3",
      chips,
      description: item.description,
      descriptionClassName: "server-description mb-0",
      afterDescription: [stats],
      footer: footer.childElementCount > 0 ? footer : null,
    });

    return summary;
  };

  const statusMessage = (item) =>
    SERVER_MESSAGES.submit.status[item.reviewStatus] || SERVER_MESSAGES.submit.status.fallback;

  const renderPublicDetailsForm = (item) => {
    setSubmitView("authenticated");
    const panel = document.createElement("div");
    panel.className = "server-submit-form-shell d-flex flex-column gap-4";
    panel.append(createAccountBar(currentState.user), createServerSummary(item));

    const form = document.createElement("form");
    form.className = "server-submit-form d-flex flex-column gap-4";
    form.noValidate = false;

    const publicFields = document.createElement("div");
    publicFields.className = "row g-3";
    appendPublicFields(publicFields, item);

    const section = document.createElement("section");
    section.className = "server-submit-section surface-lift d-flex flex-column gap-3 p-3 p-md-4 rounded-3";
    const title = document.createElement("h2");
    title.className = "server-submit-section-title mb-0";
    title.textContent = "Public Details";
    section.append(title, publicFields);

    const actions = document.createElement("div");
    actions.className = "server-submit-actions d-flex flex-column flex-sm-row align-items-center gap-3";

    const save = document.createElement("button");
    save.className = "btn btn-site btn-site-primary d-inline-flex align-items-center justify-content-center gap-2 fw-bold";
    save.type = "submit";
    save.innerHTML = '<i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Save Changes';

    const back = document.createElement("button");
    back.className = "btn btn-site d-inline-flex align-items-center justify-content-center gap-2 fw-bold";
    back.type = "button";
    back.innerHTML = '<i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Back';
    back.addEventListener("click", () => renderOwnedState(item));

    actions.append(save, back);
    form.append(section, actions);
    panel.append(form);
    replaceRoot(panel);

    const baselinePublic = publicSnapshot(item);
    const currentPublicSnapshot = () => {
      const formData = new FormData(form);

      return {
        description: comparableValue(formData.get("description")),
        websiteUrl: comparableValue(formData.get("websiteUrl")),
        ...readSocialFormValues(formData, comparableValue),
      };
    };
    const hasPublicChanges = () =>
      Object.keys(baselinePublic).some(
        (key) => currentPublicSnapshot()[key] !== baselinePublic[key]
      );
    const updateSaveState = () => {
      save.title = "";
    };

    form.addEventListener("input", updateSaveState);
    form.addEventListener("change", updateSaveState);
    updateSaveState();

    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      if (!form.reportValidity()) {
        return;
      }

      if (!hasPublicChanges()) {
        showToast({
          title: SERVER_MESSAGES.submit.toasts.noPublicChangesToSave.title,
          message: SERVER_MESSAGES.submit.toasts.noPublicChangesToSave.message,
          kind: "is-success",
        });
        renderOwnedState(item);

        return;
      }

      save.disabled = true;
      const progressToast = showToast({
        title: SERVER_MESSAGES.submit.toasts.submitting.saveTitle,
        message: SERVER_MESSAGES.submit.toasts.submitting.saveMessage,
        kind: "is-warning",
        autohide: false,
      });

      try {
        const response = await fetch(apiUrl("/api/servers/me/details"), {
          method: "PATCH",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(publicDetailsPayload(form)),
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data.error || SERVER_MESSAGES.submit.toasts.failure.saveMessage);
        }

        currentState = { ...currentState, item: data.item };
        dismissToast(progressToast);
        showToast({
          title: SERVER_MESSAGES.submit.toasts.success.savedTitle,
          message: SERVER_MESSAGES.submit.toasts.success.savedMessage,
          kind: "is-success",
        });
        window.setTimeout(() => renderOwnedState(data.item), 650);
      } catch (error) {
        dismissToast(progressToast);
        showToast({
          title: SERVER_MESSAGES.submit.toasts.failure.saveTitle,
          message:
            error instanceof Error
              ? error.message
              : SERVER_MESSAGES.submit.toasts.failure.saveMessage,
          kind: "is-error",
          delay: 6200,
        });
      } finally {
        save.disabled = false;
      }
    });
  };

  // Owner dashboard after approval
  const renderOwnedState = (item) => {
    setSubmitView("authenticated");
    const panel = document.createElement("div");
    panel.className = "server-submit-owned d-flex flex-column gap-4";
    panel.append(createAccountBar(currentState.user));

    panel.append(createNotificationArea([notificationFromItem(item)]));
    let summary = null;
    const cardActions = document.createElement("div");
    cardActions.className = "server-card-actions d-flex flex-wrap gap-2 ms-sm-auto";

    if (item.canEditPublicDetails) {
      const edit = document.createElement("button");
      edit.className = "btn btn-site btn-site-primary btn-site-sm d-inline-flex align-items-center justify-content-center gap-2 fw-bold";
      edit.type = "button";
      edit.innerHTML = '<i class="fa-solid fa-pen-to-square" aria-hidden="true"></i> Edit Server Details';
      edit.addEventListener("click", () => renderForm("edit", item));
      cardActions.append(edit);
    } else if (item.canRequestReview) {
      const edit = document.createElement("button");
      edit.className = "btn btn-site btn-site-primary btn-site-sm d-inline-flex align-items-center justify-content-center gap-2 fw-bold";
      edit.type = "button";
      edit.innerHTML = `<i class="fa-solid fa-pen-to-square" aria-hidden="true"></i> ${item.reviewStatus === "rejected" ? "Update Details and Resubmit" : "Update Details"}`;
      edit.addEventListener("click", () => renderForm("resubmit", item));
      cardActions.append(edit);
    } else if (item.reviewStatus === "suspended") {
      const tooltipWrap = document.createElement("span");
      tooltipWrap.className = "server-submit-disabled-action d-inline-flex";
      tooltipWrap.tabIndex = 0;
      tooltipWrap.dataset.bsToggle = "tooltip";
      tooltipWrap.dataset.bsPlacement = "top";
      tooltipWrap.dataset.bsTitle = SERVER_MESSAGES.submit.disabledReasons.suspended;

      const edit = document.createElement("button");
      edit.className = "btn btn-site btn-site-primary btn-site-sm d-inline-flex align-items-center justify-content-center gap-2 fw-bold";
      edit.type = "button";
      edit.disabled = true;
      edit.innerHTML = '<i class="fa-solid fa-lock" aria-hidden="true"></i> Update Details and Resubmit';
      tooltipWrap.append(edit);
      cardActions.append(tooltipWrap);
    } else if (item.reviewStatus === "pending") {
      const tooltipWrap = document.createElement("span");
      tooltipWrap.className = "server-submit-disabled-action d-inline-flex";
      tooltipWrap.tabIndex = 0;
      tooltipWrap.dataset.bsToggle = "tooltip";
      tooltipWrap.dataset.bsPlacement = "top";
      tooltipWrap.dataset.bsTitle = SERVER_MESSAGES.submit.disabledReasons.pending;

      const edit = document.createElement("button");
      edit.className = "btn btn-site btn-site-primary btn-site-sm d-inline-flex align-items-center justify-content-center gap-2 fw-bold";
      edit.type = "button";
      edit.disabled = true;
      edit.innerHTML = '<i class="fa-solid fa-pen-to-square" aria-hidden="true"></i> Edit Server Details';
      tooltipWrap.append(edit);
      cardActions.append(tooltipWrap);
    }

    const deleteButton = document.createElement("button");
    deleteButton.className = "btn btn-site btn-site-sm action-danger d-inline-flex align-items-center justify-content-center gap-2 fw-bold";
    deleteButton.type = "button";
    deleteButton.innerHTML = '<i class="fa-solid fa-trash" aria-hidden="true"></i> Delete Submission';
    deleteButton.addEventListener("click", async () => {
      if (!window.confirm(SERVER_MESSAGES.submit.deleteConfirm)) {
        return;
      }

      deleteButton.disabled = true;

      try {
        const response = await fetch(apiUrl("/api/servers/me"), {
          method: "DELETE",
          credentials: "include",
          headers: { accept: "application/json" },
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data.error || SERVER_MESSAGES.submit.toasts.failure.deleteMessage);
        }

        load();
      } catch (error) {
        panel.insertBefore(
          createNotificationArea([
            {
              kind: "is-error",
              icon: "fa-solid fa-triangle-exclamation",
              title: SERVER_MESSAGES.submit.toasts.failure.deleteTitle,
              message:
                error instanceof Error
                  ? error.message
                  : SERVER_MESSAGES.submit.toasts.failure.deleteMessage,
            },
          ]),
          summary
        );
        deleteButton.disabled = false;
      }
    });
    cardActions.append(deleteButton);

    summary = createServerSummary(item, cardActions);
    panel.append(summary);

    const view = document.createElement("a");
    view.className = "btn btn-site d-inline-flex align-items-center justify-content-center gap-2 fw-bold";
    view.href = serversUrl;
    view.innerHTML = '<i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Back to Servers';
    const actions = document.createElement("div");
    actions.className = "server-submit-actions d-flex flex-column flex-sm-row justify-content-center gap-3";
    actions.append(view);
    panel.append(actions);
    replaceRoot(panel);
    initTooltips(panel);
  };

  const renderAuthenticated = (state) => {
    currentState = state;

    if (!state.item) {
      renderForm("new");

      return;
    }

    renderOwnedState(state.item);
  };

  load = async () => {
    renderSubmitLoading();

    try {
      const response = await fetch(apiUrl("/api/servers/me"), {
        credentials: "include",
        headers: { accept: "application/json" },
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || SERVER_MESSAGES.submit.loadStatusError);
      }

      if (!data.authenticated) {
        currentState = null;
        renderLoggedOut();

        return;
      }

      renderAuthenticated(data);
    } catch (error) {
      replaceRoot(
        statePanel(
          SERVER_MESSAGES.submit.dashboardUnavailableTitle,
          error instanceof Error
            ? error.message
            : SERVER_MESSAGES.submit.dashboardUnavailableMessage,
          "fa-solid fa-triangle-exclamation",
          "servers-state-error"
        )
      );
    }
  };

  load();
};

initServerSubmit();
