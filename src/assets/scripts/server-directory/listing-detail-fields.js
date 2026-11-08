import { Dropdown } from "bootstrap";
import {
  SERVER_LANGUAGE_LIMIT,
  SERVER_LANGUAGE_MAX_LENGTH,
  SERVER_REGIONS,
  serverRegionsLabel,
} from "../../../server-listing-metadata";
import { readSocialFormValues, readSocialValues, SERVER_DESCRIPTION_LIMIT, SOCIAL_PLATFORMS } from "./ui.js";

export const readLanguagesInput = (value) => String(value ?? "")
  .split(",")
  .map((language) => language.trim().replace(/\s+/g, " "))
  .filter(Boolean);

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
    help.id = `${control.id}-help`;
    help.textContent = options.help;
    control.setAttribute("aria-describedby", [control.getAttribute("aria-describedby"), help.id].filter(Boolean).join(" "));
    wrap.append(help);
  }

  return wrap;
};

const createRegionsField = (item = null) => {
  const wrap = document.createElement("div");
  wrap.className = "col-md-6";
  const picker = document.createElement("div");
  picker.className = "dropdown form-floating server-submit-floating";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "form-select dark-select server-submit-region-toggle text-start w-100";
  toggle.id = "server-regions";
  toggle.dataset.bsToggle = "dropdown";
  toggle.dataset.serverRegionsToggle = "";
  toggle.setAttribute("aria-label", "Server region(s)");
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", "server-regions-options");
  toggle.setAttribute("aria-describedby", "server-regions-instructions");

  const instructions = document.createElement("span");
  instructions.className = "visually-hidden";
  instructions.id = "server-regions-instructions";
  instructions.textContent = "Required. Select one or more server regions.";

  const summary = document.createElement("span");
  summary.className = "d-block text-truncate";
  toggle.append(summary);

  const label = document.createElement("label");
  label.htmlFor = toggle.id;
  label.textContent = "Server region(s)";

  const menu = document.createElement("div");
  menu.className = "dropdown-menu server-submit-region-menu w-100 p-2 overflow-y-auto";
  menu.id = "server-regions-options";
  menu.setAttribute("role", "group");
  menu.setAttribute("aria-label", "Server regions");

  const invalid = document.createElement("p");
  invalid.className = "invalid-feedback mb-0";
  invalid.id = "server-regions-error";
  invalid.textContent = "Select at least one server region.";
  invalid.setAttribute("role", "alert");

  picker.append(toggle, label, instructions, menu);
  wrap.append(picker, invalid);
  const dropdown = Dropdown.getOrCreateInstance(toggle, { autoClose: "outside" });
  const checkboxes = SERVER_REGIONS.map(({ value, label }) => {
    const option = document.createElement("label");
    option.className = "dropdown-item form-check d-flex align-items-center gap-2 py-2 ps-2 pe-3 mb-0 rounded-2";
    option.tabIndex = -1;
    const checkbox = document.createElement("input");
    checkbox.className = "form-check-input flex-shrink-0 m-0";
    checkbox.type = "checkbox";
    checkbox.name = "regions";
    checkbox.value = value;
    checkbox.checked = item?.regions?.includes(value) ?? false;
    // Bootstrap arrow navigation focuses menu items, so move focus to their checkboxes
    option.addEventListener("focus", () => checkbox.focus());
    const text = document.createElement("span");
    text.textContent = label;
    option.append(checkbox, text);
    menu.append(option);

    return checkbox;
  });

  const updateRegions = () => {
    const selected = checkboxes.filter((checkbox) => checkbox.checked).map((checkbox) => checkbox.value);
    const label = selected.length ? serverRegionsLabel(selected) : "Select server region(s)";
    summary.textContent = label;
    toggle.title = label;
    checkboxes[0].setCustomValidity(selected.length ? "" : invalid.textContent);

    if (selected.length) {
      invalid.classList.remove("d-block");
      toggle.removeAttribute("aria-invalid");
      toggle.setAttribute("aria-describedby", instructions.id);
    }
  };

  checkboxes.forEach((checkbox, index) => {
    checkbox.addEventListener("change", updateRegions);
    checkbox.addEventListener("keydown", (event) => {
      const nextIndex = {
        ArrowDown: (index + 1) % checkboxes.length,
        ArrowUp: (index - 1 + checkboxes.length) % checkboxes.length,
        Home: 0,
        End: checkboxes.length - 1,
      }[event.key];

      if (nextIndex !== undefined) {
        event.preventDefault();
        event.stopPropagation();
        checkboxes[nextIndex].focus();
      } else if (event.key === "Enter") {
        event.preventDefault();
        checkbox.click();
      }
    });
  });
  checkboxes[0].addEventListener("invalid", (event) => {
    event.preventDefault();
    invalid.classList.add("d-block");
    toggle.setAttribute("aria-invalid", "true");
    toggle.setAttribute("aria-describedby", `${instructions.id} ${invalid.id}`);
    dropdown.show();
    checkboxes[0].focus();
  });
  picker.addEventListener("focusout", (event) => {
    if (event.relatedTarget && !picker.contains(event.relatedTarget)) {
      dropdown.hide();
    }
  });
  updateRegions();

  return wrap;
};

export const createListingMetadataFields = (item = null) => {
  return [
    createRegionsField(item),
    field("languages", "Server language(s)", {
      value: item?.languages?.join(", "),
      maxLength: SERVER_LANGUAGE_LIMIT * SERVER_LANGUAGE_MAX_LENGTH + (SERVER_LANGUAGE_LIMIT - 1) * 2,
      placeholder: "English, or: Spanish, French",
    }),
  ];
};

export const appendPublicFields = (row, item = null) => {
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

export const publicDetailsPayload = (form) => {
  const formData = new FormData(form);

  return {
    description: String(formData.get("description") ?? ""),
    regions: formData.getAll("regions"),
    languages: readLanguagesInput(formData.get("languages")),
    websiteUrl: String(formData.get("websiteUrl") ?? ""),
    socialLinks: readSocialFormValues(formData),
  };
};

export const listingDetailsPayload = (form) => {
  const formData = new FormData(form);

  return {
    name: String(formData.get("name") ?? ""),
    ...publicDetailsPayload(form),
  };
};

export const createListingNameField = (item, column) =>
  field("name", "Server name", {
    column,
    required: true,
    maxLength: 80,
    autocomplete: "organization",
    value: item?.name,
    placeholder: "KingdomsX Realm",
  });

export const createListingDescriptionField = (item) =>
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
  });
