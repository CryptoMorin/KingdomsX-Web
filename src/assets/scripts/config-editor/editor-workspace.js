import { Dropdown } from "bootstrap";
import { buildFormStructure, orderedOwnerContent, sectionKeyForPath, GENERAL_SECTION } from "./settings-form.js";
import {
  acceptRemoteWorkspaceSave,
  addWorkspaceSchematic,
  createWorkspaceFile,
  downloadOriginalWorkspace,
  downloadWorkspace,
  downloadWorkspaceRecovery,
  exampleWorkspace,
  openWorkspaceArtifact,
  openWorkspaceSelection,
  restoreRemoteWorkspaceDraft,
  removeWorkspaceSchematic,
  replaceWorkspaceSchematic,
  removeWorkspaceFile,
  renameWorkspaceFile,
  workspaceChangeSummary,
  workspaceDownloadArtifact,
  workspaceFileChanges,
  workspaceHasUnexportedChanges,
  workspaceOutpostPageEditable,
  workspaceSchematicEditable,
  workspaceSchematicFiles
} from "./workspace-session.js";
import { formatDate } from "../site-date.js";
import { forgetRemoteEditorLink, takeRemoteEditorLink } from "./remote-editor-link.js";
import { createRemoteDraftRecovery } from "./remote-draft-recovery.js";
import { RemoteEditorSession } from "./remote-editor-session.js";
import { initialValueForType, renderOptionField } from "./setting-controls.js";
import {
  availableGuiSlots,
  buildGuiPreview,
  guiPositionBounds,
  guiTooltipMessage,
  plainGuiText,
  previewGuiMessage,
  previewGuiText
} from "./gui-preview.js";
import { messagePreviewElement, observedMessageReferences } from "./message-preview.js";
import { lorePreviewText } from "./lore-value.js";
import {
  clearMaterialIcon,
  materialIconElement,
  updateMaterialIcon
} from "./material-icon.js";
import {
  minecraftGuiLayout,
  minecraftGuiRenderScale,
  renderMinecraftGui
} from "./minecraft-gui-renderer.js";
import { createSchematicPreview } from "./schematic-preview.js";
import {
  configuredBuildingMaxLevel,
  schematicFolderForBuilding,
  schematicPreviewsEnabled
} from "./schematic-catalog.js";
import { canMaterializeEffectiveEntry, effectiveIndexForSession } from "./inherited-settings.js";
import {
  defaultOptionsForResource,
  defaultOptionForFile,
  defaultOptionForDisplay,
  schemaForFile,
  templateProfileForKey
} from "./schema-registry.js";
import {
  addonOwnershipForConfig,
  addonOwnershipForSchematic,
  sharedAddonOwnership
} from "./addon-ownership.js";
import { displayHelpText, labelForKey, labelForSection } from "./schema-options.js";
import {
  configureMappingKeyInput,
  createMappingKeyControl,
  mappingKeyHelp,
  mappingKeyLabel
} from "./mapping-key-control.js";
import { mappingCreationSpec } from "./mapping-creation.js";
import { findOptionTarget, optionPathMarker } from "./navigation.js";
import {
  createEditorContentNavigation,
  createEditorContentTransition
} from "./editor-content-transition.js";
import { createStickyGroupHeaders } from "./sticky-group-headers.js";
import { expressionProblem, parseAnchorName, parseAnchoredValue, parseImportedAnchor } from "./kingdoms-yaml.js";
import { reusableSettingsCompatible } from "./reusable-settings.js";
import { filterSections, firstMatchingFieldPath } from "./view-filter.js";
import { typeAtPath, unwrapNullable } from "./schema-types.js";
import { semanticWarnings } from "./semantic-validation.js";
import { changedSourceLineNumbers, describeChanges } from "./change-review.js";
import { fileSessionHasChanges } from "./file-session.js";
import { appendDescriptionText } from "./description-links.js";
import { workspaceRelationships } from "./workspace-dependencies.js";
import { buildTemplatePresentation } from "./template-presentation.js";
import { messageMacroContext, undefinedMessageMacroWarnings } from "./message-macros.js";
import { miscUpgradeIds } from "./misc-upgrade-options.js";
import { MESSAGE_TITLE_STARTER_FIELDS } from "./message-entry.js";
import {
  applyEditorSettings,
  DEFAULT_EDITOR_SETTINGS,
  editorPrefersReducedMotion,
  loadEditorSettings,
  normalizeEditorSettings,
  saveEditorSettings
} from "./editor-settings.js";
import { showSiteToast } from "../site-toast.js";
import {
  createVisualHistory,
  ensureVisualHistory,
  moveVisualHistory,
  recordVisualHistory,
  restoreVisualHistory,
  visualHistoryDirection
} from "./visual-history.js";
import {
  addDocumentAnchor,
  addDocumentSequenceItemAnchor,
  detachDocumentAlias,
  detachDocumentAliasSource,
  detachDocumentSequenceItemAlias,
  documentAnnotationChanged,
  documentAnchorChanged,
  expandDocumentMessageEntry,
  insertDocumentConditionalValue,
  insertDocumentMapping,
  insertDocumentMappingTree,
  insertDocumentValue,
  moveDocumentMappingEntry,
  pathKey,
  parseSimpleLiteral,
  renameDocumentAnchor,
  removeDocumentAnchor,
  removeDocumentSequenceItemAnchor,
  removeDocumentEntry,
  renameDocumentKey,
  reuseDocumentAnchor,
  reuseDocumentSequenceItemAnchor,
  scanAnchorTokens,
  sequenceItemAnchorDefinitions,
  setDocumentAnnotation,
  replaceDocumentLiteral,
  replaceDocumentValue,
  reusableValueShape,
  undoDocumentAliasDetach,
  undoDocumentAnchorAddition,
  undoDocumentAnchorRemoval,
  undoDocumentAnchorReuse,
  undoDocumentAnchorRename,
  undoDocumentAnnotationChange,
  undoDocumentMessageExpansion
} from "./yaml-source.js";

import { KINGDOM_COMMANDS } from "./editor-values.js";

let labeledControlId = 0;
let guiRenderSequence = 0;
const GUI_CONDITION_PREVIEW_INTERVAL = 3500;
const REMOTE_DRAFT_SAVE_DELAY_MS = 500;
const SESSION_EXPIRY_WARNINGS = [10, 5, 1];

const elements = {
  shell: document.querySelector("[data-editor-shell]"),
  header: document.querySelector(".editor-header"),
  empty: document.querySelector("[data-editor-empty]"),
  workspace: document.querySelector("[data-editor-workspace]"),
  sessionTimes: document.querySelectorAll("[data-editor-session-time]"),
  expiredDialog: document.querySelector("[data-editor-session-expired-dialog]"),
  saveActions: document.querySelector("[data-editor-save-actions]"),
  primarySaveButton: document.querySelector("[data-editor-primary-action]"),
  saveMenuToggle: document.querySelector("[data-editor-save-menu-toggle]"),
  recoveryButtons: document.querySelectorAll("[data-download-recovery]"),
  navigation: document.querySelector("[data-editor-navigation]"),
  headerNavigation: document.querySelector("[data-editor-header-navigation]"),
  controls: document.querySelector("[data-editor-controls]"),
  headerControls: document.querySelector("[data-editor-header-controls]"),
  headerActions: document.querySelector(".editor-header-actions"),
  sidebarControls: document.querySelector("[data-editor-sidebar-controls]"),
  navigationToggle: document.querySelector("[data-toggle-editor-navigation]"),
  navigationClose: document.querySelector("[data-close-editor-navigation]"),
  navigationBackdrop: document.querySelector("[data-editor-navigation-backdrop]"),
  navigationTabs: document.querySelector("[data-editor-navigation-tabs]"),
  navigationTabButtons: document.querySelectorAll("[data-editor-navigation-tab]"),
  sidebar: document.querySelector("[data-editor-sidebar]"),
  visualWorkspace: document.querySelector("[data-visual-workspace]"),
  sourceWorkspace: document.querySelector("[data-source-workspace]"),
  editorModeSwitch: document.querySelector("[data-editor-mode-switch]"),
  editorModeButtons: document.querySelectorAll("[data-editor-mode]"),
  fileInput: document.querySelector("[data-file-input]"),
  schematicFileInput: document.querySelector("[data-schematic-file-input]"),
  fileName: document.querySelector("[data-current-file]"),
  fileMeta: document.querySelector("[data-current-file-meta]"),
  workspaceName: document.querySelector("[data-workspace-name]"),
  workspaceMeta: document.querySelector("[data-workspace-meta]"),
  changeFileSingle: document.querySelector("[data-change-file-single]"),
  workspaceFilesPanel: document.querySelector("[data-workspace-files-panel]"),
  filesResizer: document.querySelector('[data-sidebar-resizer="files"]'),
  sectionsResizer: document.querySelector('[data-sidebar-resizer="sections"]'),
  workspaceFilesCount: document.querySelector("[data-workspace-files-count]"),
  workspaceFileSearch: document.querySelector("[data-workspace-file-search]"),
  workspaceFiles: document.querySelector("[data-workspace-files]"),
  search: document.querySelector("[data-setting-search]"),
  clearSearch: document.querySelector("[data-clear-search]"),
  tools: document.querySelector("[data-editor-tools]"),
  mobileGroupSticky: document.querySelector("[data-editor-mobile-group-sticky]"),
  mobileGroupDetails: document.querySelector("[data-editor-mobile-group-details]"),
  mobileGroupContext: document.querySelector("[data-editor-mobile-group-context]"),
  mobileGroupTitle: document.querySelector("[data-editor-mobile-group-title]"),
  mobileGroupKey: document.querySelector("[data-editor-mobile-group-key]"),
  mobileGroupAncestors: document.querySelector("[data-editor-mobile-group-ancestors]"),
  mobileGroupPin: document.querySelector("[data-editor-mobile-group-pin]"),
  viewModes: document.querySelectorAll("[data-view-mode]"),
  viewResults: document.querySelector("[data-view-results]"),
  collapseGroups: document.querySelector("[data-collapse-groups]"),
  expandGroups: document.querySelector("[data-expand-groups]"),
  guiPreview: document.querySelector("[data-gui-preview]"),
  guiPreviewHelp: document.querySelector("[data-gui-preview-help]"),
  guiPreviewMeta: document.querySelector("[data-gui-preview-meta]"),
  guiPreviewWorkspace: document.querySelector("[data-gui-preview-workspace]"),
  guiPreviewLauncher: document.querySelector("[data-gui-preview-launcher]"),
  guiPreviewBackdrop: document.querySelector("[data-gui-preview-backdrop]"),
  guiPreviewClose: document.querySelector("[data-close-gui-preview]"),
  guiSlotPane: document.querySelector("[data-gui-slot-pane]"),
  outpostPageActions: document.querySelector("[data-outpost-page-actions]"),
  addOutpostPage: document.querySelector("[data-add-outpost-page]"),
  deleteOutpostPage: document.querySelector("[data-delete-outpost-page]"),
  guiPreviewNotice: document.querySelector("[data-gui-preview-notice]"),
  guiPreviewGrid: document.querySelector("[data-gui-preview-grid]"),
  guiPreviewUnplaced: document.querySelector("[data-gui-preview-unplaced]"),
  guiPreviewUnplacedList: document.querySelector("[data-gui-preview-unplaced-list]"),
  guiPreviewUnplacedSearch: document.querySelector("[data-gui-preview-unplaced-search]"),
  guiPreviewUnplacedToggle: document.querySelector("[data-gui-preview-unplaced-toggle]"),
  guiPreviewUnplacedToggleIcon: document.querySelector("[data-gui-preview-unplaced-toggle-icon]"),
  guiPreviewUnplacedToggleLabel: document.querySelector("[data-gui-preview-unplaced-toggle-label]"),
  guiPreviewStates: document.querySelector("[data-gui-preview-states]"),
  guiPreviewStatesList: document.querySelector("[data-gui-preview-states-list]"),
  guiPreviewStatesToggle: document.querySelector("[data-gui-preview-states-toggle]"),
  guiPreviewStatesToggleIcon: document.querySelector("[data-gui-preview-states-toggle-icon]"),
  guiPreviewStatesToggleLabel: document.querySelector("[data-gui-preview-states-toggle-label]"),
  schematicPreview: document.querySelector("[data-schematic-preview]"),
  schematicPreviewTitle: document.querySelector("[data-schematic-preview-title]"),
  schematicPreviewHelp: document.querySelector("[data-schematic-preview-help]"),
  schematicPreviewSource: document.querySelector("[data-schematic-preview-source]"),
  schematicPreviewMeta: document.querySelector("[data-schematic-preview-meta]"),
  schematicPreviewLevels: document.querySelector("[data-schematic-preview-levels]"),
  schematicPreviewCanvas: document.querySelector("[data-schematic-preview-canvas]"),
  schematicPreviewStatus: document.querySelector("[data-schematic-preview-status]"),
  schematicPreviewNotice: document.querySelector("[data-schematic-preview-notice]"),
  schematicPreviewViewport: document.querySelector("[data-schematic-preview-viewport]"),
  addSchematic: document.querySelector("[data-add-schematic]"),
  replaceSchematic: document.querySelector("[data-replace-schematic]"),
  removeSchematic: document.querySelector("[data-remove-schematic]"),
  addSchematicDialog: document.querySelector("[data-add-schematic-dialog]"),
  addSchematicForm: document.querySelector("[data-add-schematic-form]"),
  addSchematicLevel: document.querySelector("[data-add-schematic-level]"),
  addSchematicFile: document.querySelector("[data-add-schematic-file]"),
  addSchematicDescription: document.querySelector("[data-add-schematic-description]"),
  addSchematicHint: document.querySelector("[data-add-schematic-hint]"),
  addSchematicPath: document.querySelector("[data-add-schematic-path]"),
  addSchematicCloseButtons: document.querySelectorAll("[data-close-add-schematic]"),
  sectionList: document.querySelector("[data-editor-sections]"),
  sectionTitle: document.querySelector("[data-current-section]"),
  sectionKey: document.querySelector("[data-section-key]"),
  sectionSummary: document.querySelector("[data-section-summary]"),
  sectionDescription: document.querySelector("[data-section-description]"),
  sectionActions: document.querySelector("[data-section-actions]"),
  scroll: document.querySelector("[data-editor-scroll]"),
  fileContent: document.querySelector("[data-editor-file-content]"),
  sectionContent: document.querySelector("[data-editor-section-content]"),
  form: document.querySelector("[data-editor-form]"),
  formEmpty: document.querySelector("[data-form-empty]"),
  warnings: document.querySelector("[data-editor-warnings]"),
  loadedActions: document.querySelectorAll("[data-loaded-action]"),
  saveButtons: document.querySelectorAll("[data-save-workspace]"),
  originalDownloadLabels: document.querySelectorAll("[data-original-download-label]"),
  originalDownloadButtons: document.querySelectorAll("[data-download-original]"),
  reviewEyebrow: document.querySelector("[data-review-eyebrow]"),
  reviewWarningHeading: document.querySelector("[data-review-warning-heading]"),
  changeStatus: document.querySelector("[data-change-status]"),
  settingsOpen: document.querySelector("[data-open-editor-settings]"),
  settingsDialog: document.querySelector("[data-editor-settings-dialog]"),
  settingsForm: document.querySelector("[data-editor-settings-form]"),
  settingsFontOptions: document.querySelectorAll("[data-editor-settings-font]"),
  settingsTextSizeOptions: document.querySelectorAll("[data-editor-settings-text-size]"),
  settingsReduceMotion: document.querySelector("[data-editor-settings-reduce-motion]"),
  settingsCloseButtons: document.querySelectorAll("[data-close-editor-settings]"),
  settingsReset: document.querySelector("[data-reset-editor-settings]"),
  previewDialog: document.querySelector("[data-preview-dialog]"),
  previewName: document.querySelector("[data-preview-name]"),
  previewSource: document.querySelector("[data-preview-source-host]"),
  previewSourceDetails: document.querySelector("[data-preview-source-details]"),
  previewChanges: document.querySelector("[data-preview-changes]"),
  previewChangesEmpty: document.querySelector("[data-preview-changes-empty]"),
  previewWarningsPanel: document.querySelector("[data-preview-warnings-panel]"),
  previewWarnings: document.querySelector("[data-preview-warnings]"),
  previewFileField: document.querySelector("[data-preview-file-field]"),
  previewFile: document.querySelector("[data-preview-file]"),
  sourceForm: document.querySelector("[data-source-form]"),
  sourceFile: document.querySelector("[data-source-file]"),
  sourceEditor: document.querySelector("[data-source-editor]"),
  sourceUndo: document.querySelector("[data-source-undo]"),
  sourceRedo: document.querySelector("[data-source-redo]"),
  sourceWarnings: document.querySelector("[data-source-warnings]"),
  sourceWarningList: document.querySelector("[data-source-warning-list]"),
  sourceStatus: document.querySelector("[data-source-status]"),
  mappingDialog: document.querySelector("[data-mapping-dialog]"),
  mappingForm: document.querySelector("[data-mapping-form]"),
  mappingParent: document.querySelector("[data-mapping-parent]"),
  mappingDescription: document.querySelector("[data-mapping-description]"),
  mappingDescriptionCopy: document.querySelector("[data-mapping-description-copy]"),
  mappingEyebrow: document.querySelector("[data-mapping-eyebrow]"),
  mappingKey: document.querySelector("[data-mapping-key]"),
  mappingKeyLabel: document.querySelector("[data-mapping-key-label]"),
  mappingTitle: document.querySelector("[data-mapping-title]"),
  mappingTemplateField: document.querySelector("[data-mapping-template-field]"),
  mappingTemplate: document.querySelector("[data-mapping-template]"),
  mappingShapeField: document.querySelector("[data-mapping-shape-field]"),
  mappingShape: document.querySelector("[data-mapping-shape]"),
  mappingHint: document.querySelector("[data-mapping-hint]"),
  mappingSubmit: document.querySelector("[data-mapping-submit]"),
  anchorDialog: document.querySelector("[data-anchor-dialog]"),
  anchorForm: document.querySelector("[data-anchor-form]"),
  anchorEyebrow: document.querySelector("[data-anchor-eyebrow]"),
  anchorHeadingPrefix: document.querySelector("[data-anchor-heading-prefix]"),
  anchorHeadingSuffix: document.querySelector("[data-anchor-heading-suffix]"),
  anchorTarget: document.querySelector("[data-anchor-target]"),
  anchorDescription: document.querySelector("[data-anchor-description]"),
  anchorNameLabel: document.querySelector("[data-anchor-name-label]"),
  anchorNameHint: document.querySelector("[data-anchor-name-hint]"),
  anchorName: document.querySelector("[data-anchor-name]"),
  anchorCloseButtons: document.querySelectorAll("[data-close-anchor]"),
  anchorCloseLabels: document.querySelectorAll("[data-anchor-close-label]"),
  anchorSubmitLabel: document.querySelector("[data-anchor-submit-label]"),
  useSavedDialog: document.querySelector("[data-use-saved-dialog]"),
  useSavedForm: document.querySelector("[data-use-saved-form]"),
  useSavedTarget: document.querySelector("[data-use-saved-target]"),
  useSavedName: document.querySelector("[data-use-saved-name]"),
  useSavedCloseButtons: document.querySelectorAll("[data-close-use-saved]"),
  annotationDialog: document.querySelector("[data-annotation-dialog]"),
  annotationForm: document.querySelector("[data-annotation-form]"),
  annotationTarget: document.querySelector("[data-annotation-target]"),
  annotationPolicies: document.querySelectorAll("[data-annotation-policy]"),
  annotationCloseButtons: document.querySelectorAll("[data-close-annotation]"),
  confirmationDialog: document.querySelector("[data-editor-confirmation-dialog]"),
  confirmationMessage: document.querySelector("[data-editor-confirmation-message]"),
  confirmationConfirm: document.querySelector("[data-editor-confirmation-confirm]"),
  saveOverlay: document.querySelector("[data-editor-save-overlay]"),
  saveStatus: document.querySelector("[data-editor-save-status]"),
  saveProgress: document.querySelector("[data-editor-save-progress]"),
  toastContainer: document.querySelector("[data-editor-toast-container]")
};
const state = {
  workspace: null,
  session: null,
  schema: null,
  effectiveIndex: null,
  sections: [],
  activeSection: "",
  mappingGroup: null,
  mappingTemplates: [],
  mappingGuiSlot: null,
  anchorPath: null,
  useSavedPath: null,
  guiPreview: null,
  guiPreviewExpanded: false,
  guiSelectedSlot: null,
  guiUnplacedQuery: "",
  guiUnplacedCollapsed: false,
  guiStatesCollapsed: false,
  collapsedGuiStateCards: new Set(),
  fileQuery: "",
  expandedFolders: new Set(),
  activeSchematicPath: "",
  replacingSchematicPath: "",
  addingSchematicTarget: null,
  query: "",
  viewMode: "all",
  collapsedGroups: new Set(),
  templatePresentation: null,
  annotationPath: null,
  messageTokens: [],
  messageMacros: null,
  defaultLanguageOptions: [],
  defaultConfigOptions: [],
  defaultMiscUpgradeOptions: [],
  editorMode: "visual",
  navigationDrawerOpen: false,
  navigationPanel: "sections",
  remoteSession: null,
  draftRecovery: null,
  remoteIssueKey: "",
  remoteExpired: false,
  recoveryCodeDraft: null,
  downloadingRecovery: false,
  saving: false
};

let editorSettings = applyEditorSettings(loadEditorSettings());

let sourceEditor;
let sourceEditorPromise;
let previewSourceEditor;
let previewSourceEditorPromise;
const visualHistories = new WeakMap();
const directMappingDrafts = new WeakMap();
let navigationOpener;
let remoteDraftSaveTimer = 0;
let remoteDraftSequence = 0;
let remoteDraftWrite = Promise.resolve();
let remoteDraftErrorReported = false;
let editorBusy = false;
let saveOpener = null;
let sessionExpiryTimer = 0;
let sessionExpiryWarning = 0;
const manualWorkspacesAllowed = Boolean(elements.fileInput);

const editorContentTransition = createEditorContentTransition({
  fileContent: elements.fileContent,
  sectionContent: elements.sectionContent,
  prefersReducedMotion: editorPrefersReducedMotion
});
const stickyGroupHeaders = createStickyGroupHeaders({
  shell: elements.shell,
  scroll: elements.scroll,
  header: elements.header,
  tools: elements.tools,
  content: elements.visualWorkspace,
  form: elements.form,
  mobile: {
    root: elements.mobileGroupSticky,
    details: elements.mobileGroupDetails,
    context: elements.mobileGroupContext,
    title: elements.mobileGroupTitle,
    key: elements.mobileGroupKey,
    ancestors: elements.mobileGroupAncestors,
    pin: elements.mobileGroupPin
  },
  prefersReducedMotion: editorPrefersReducedMotion
});
const schematicPreview = createSchematicPreview({
  container: elements.schematicPreview,
  title: elements.schematicPreviewTitle,
  help: elements.schematicPreviewHelp,
  source: elements.schematicPreviewSource,
  meta: elements.schematicPreviewMeta,
  levels: elements.schematicPreviewLevels,
  canvas: elements.schematicPreviewCanvas,
  status: elements.schematicPreviewStatus,
  notice: elements.schematicPreviewNotice,
  viewport: elements.schematicPreviewViewport,
  replace: elements.replaceSchematic
});
const editorContentNavigation = createEditorContentNavigation({
  transition: editorContentTransition,
  currentFile: () => state.session?.fileName,
  currentSection: () => state.activeSection,
  canNavigate: () => !state.guiPreviewExpanded && !document.querySelector("dialog[open]"),
  prepareCurrentFile: async () => {
    if (state.editorMode !== "source" || remoteWorkspaceIssue()?.key === "expired") {
      return true;
    }

    const editor = await loadSourceEditor();

    return editor.applyDraft({ announceUnchanged: false });
  },
  prepareFile: async (path) => {
    setBusy(true, "Opening config…");

    try {
      return await prepareWorkspaceFileActivation(path);
    } catch (error) {
      setBusy(false);
      throw error;
    }
  },
  commitFile: (destination, detail) => {
    try {
      return commitWorkspaceFileActivation(destination, detail);
    } finally {
      setBusy(false);
    }
  },
  commitSection: commitSectionNavigation
});

async function loadSourceEditor() {
  if (!sourceEditorPromise) {
    sourceEditorPromise = import("./advanced-source-editor.js").then(({ createAdvancedSourceEditor }) =>
      createAdvancedSourceEditor({
        form: elements.sourceForm,
        fileName: elements.sourceFile,
        host: elements.sourceEditor,
        undoButton: elements.sourceUndo,
        redoButton: elements.sourceRedo,
        warningsPanel: elements.sourceWarnings,
        warningList: elements.sourceWarningList,
        status: elements.sourceStatus,
        announce,
        async onSave(session) {
          session.exported = false;
          await activateWorkspaceFile(session.fileName);
          announce("Applied the YAML changes and rebuilt the visual editor.", false, "YAML changes applied");
        },
        onDraftChange: scheduleRemoteDraftSave
      })
    ).then((editor) => {
      sourceEditor = editor;
      editor.setReadOnly(remoteWorkspaceIssue()?.key === "expired");
      return editor;
    }).catch((error) => {
      sourceEditorPromise = undefined;
      throw error;
    });
  }

  return sourceEditorPromise;
}

async function loadPreviewSourceEditor() {
  if (!previewSourceEditorPromise) {
    previewSourceEditorPromise = import("./advanced-source-editor.js")
      .then(({ createReadonlySourceEditor }) => createReadonlySourceEditor({
        host: elements.previewSource,
        ariaLabel: "Exact config source"
      }))
      .then((editor) => {
        previewSourceEditor = editor;
        return editor;
      })
      .catch((error) => {
        previewSourceEditorPromise = undefined;
        throw error;
      });
  }

  return previewSourceEditorPromise;
}

const desktopSidebarQuery = window.matchMedia("(min-width: 997px)");
const navigationFocusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");
const sidebarResizers = [
  {
    handle: elements.filesResizer,
    panel: elements.workspaceFilesPanel,
    property: "--editor-files-rail-width",
    minRem: 11,
    maxRem: 30
  },
  {
    handle: elements.sectionsResizer,
    panel: elements.sidebar,
    property: "--editor-sidebar-width",
    minRem: 12,
    maxRem: 24
  }
];

sidebarResizers.forEach(setupSidebarResizer);
elements.navigationToggle.addEventListener("click", () => {
  setEditorNavigationDrawerOpen(!state.navigationDrawerOpen);
});
elements.navigationClose.addEventListener("click", () => setEditorNavigationDrawerOpen(false));
elements.navigationBackdrop.addEventListener("click", () => setEditorNavigationDrawerOpen(false));
elements.navigationTabButtons.forEach((button) => {
  button.addEventListener("click", () => setEditorNavigationPanel(button.dataset.editorNavigationTab));
  button.addEventListener("keydown", handleEditorNavigationTabKeydown);
});
desktopSidebarQuery.addEventListener("change", () => {
  state.navigationDrawerOpen = false;
  renderEditorNavigation();
});

document.querySelectorAll("[data-open-file]").forEach((button) => {
  button.addEventListener("click", () => elements.fileInput?.click());
});

elements.fileInput?.addEventListener("change", async (event) => {
  await loadSelection(event.target.files);
  event.target.value = "";
});
elements.replaceSchematic.addEventListener("click", () => {
  if (!state.activeSchematicPath) {
    return;
  }

  state.replacingSchematicPath = state.activeSchematicPath;
  elements.schematicFileInput.click();
});
elements.schematicFileInput.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  const path = state.replacingSchematicPath;
  event.target.value = "";
  state.replacingSchematicPath = "";

  if (!file || !path) {
    return;
  }

  try {
    setBusy(true, "Replacing schematic…");
    await replaceWorkspaceSchematic(state.workspace, path, file);
    renderWorkspaceFiles();
    await renderActiveSchematic();
    renderStatus();
    announce(`Replaced ${path}.`);
  } catch (error) {
    announce(error.message, true);
  } finally {
    setBusy(false);
  }
});
elements.removeSchematic.addEventListener("click", removeActiveSchematic);
elements.addSchematic.addEventListener("click", openAddSchematicDialog);
elements.addSchematicCloseButtons.forEach((button) => {
  button.addEventListener("click", () => elements.addSchematicDialog.close());
});
elements.addSchematicLevel.addEventListener("input", renderAddSchematicPath);
elements.addSchematicFile.addEventListener("change", renderAddSchematicPath);
elements.addSchematicForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const target = state.addingSchematicTarget;
  const [file] = elements.addSchematicFile.files;

  if (!target || !file) {
    return;
  }

  try {
    setBusy(true, "Adding schematic…");
    const entry = await addWorkspaceSchematic(
      state.workspace,
      target.folder,
      elements.addSchematicLevel.value,
      file,
      { maxLevel: target.maxLevel }
    );
    elements.addSchematicDialog.close();
    expandFolderPath(entry.path);
    schematicPreview.invalidate();

    if (state.activeSchematicPath) {
      state.activeSchematicPath = entry.path;
    }

    renderWorkspace();
    announce(`Added schematic ${entry.path}.`, false, "Schematic added");
  } catch (error) {
    announce(error.message, true);
  } finally {
    setBusy(false);
  }
});
elements.addSchematicDialog.addEventListener("close", () => {
  state.addingSchematicTarget = null;
  elements.addSchematicForm.reset();
});

document.querySelector("[data-example]").addEventListener("click", loadDemoWorkspace);
elements.settingsOpen.addEventListener("click", openEditorSettings);
elements.settingsForm.addEventListener("submit", saveEditorSettingsForm);
elements.settingsCloseButtons.forEach((button) => {
  button.addEventListener("click", () => elements.settingsDialog.close());
});
elements.settingsReset.addEventListener("click", () => syncEditorSettingsForm(DEFAULT_EDITOR_SETTINGS));
elements.settingsDialog.addEventListener("close", () => {
  const focusTarget = elements.settingsOpen.closest("[inert]") ? elements.navigationToggle : elements.settingsOpen;
  focusTarget.focus({ preventScroll: true });
});
elements.saveButtons.forEach((button) => button.addEventListener("click", () => {
  if (button === elements.primarySaveButton && remoteWorkspaceIssue()?.key === "expired") {
    void downloadRecoveryBackup();
    return;
  }

  void saveCurrentWorkspace();
}));
elements.recoveryButtons.forEach((button) => button.addEventListener("click", downloadRecoveryBackup));
document.querySelectorAll("[data-close-session-expired]").forEach((button) => {
  button.addEventListener("click", () => elements.expiredDialog.close());
});
elements.expiredDialog.addEventListener("close", () => {
  if (remoteWorkspaceIssue()?.key === "expired") {
    elements.primarySaveButton.focus({ preventScroll: true });
  }
});
document.querySelectorAll("[data-download-original]").forEach((button) => button.addEventListener("click", downloadOriginalFile));
document.querySelectorAll("[data-preview-yaml]").forEach((button) => button.addEventListener("click", openPreview));
document.querySelectorAll("[data-close-preview]").forEach((button) => button.addEventListener("click", () => elements.previewDialog.close()));
document.querySelector("[data-open-source-editor]").addEventListener("click", async () => {
  const path = elements.previewFile.value || state.session?.fileName;
  const session = state.workspace?.files.find((candidate) => candidate.fileName === path);

  if (!session) {
    return;
  }

  elements.previewDialog.close();

  try {
    if (session !== state.session && !await openWorkspaceFile(session.fileName)) {
      return;
    }

    await setEditorMode("source", { focus: true });
  } catch (error) {
    announce(error.message, true);
  }
});
elements.editorModeButtons.forEach((button) => {
  button.addEventListener("click", () => setEditorMode(button.dataset.editorMode, { focus: true }));
});
document.querySelectorAll("[data-close-mapping]").forEach((button) => button.addEventListener("click", () => elements.mappingDialog.close()));
elements.mappingDialog.addEventListener("close", () => {
  state.mappingGuiSlot = null;
});
elements.anchorCloseButtons.forEach((button) => button.addEventListener("click", closeAnchorDialog));
elements.mappingForm.addEventListener("submit", addMappingEntry);
elements.anchorForm.addEventListener("submit", createReusableSettings);
elements.useSavedForm.addEventListener("submit", useSavedSettings);
elements.useSavedCloseButtons.forEach((button) => button.addEventListener("click", closeUseSavedDialog));
elements.annotationForm.addEventListener("submit", saveAnnotationPolicies);
elements.annotationCloseButtons.forEach((button) => button.addEventListener("click", closeAnnotationDialog));
elements.guiPreviewUnplacedSearch.addEventListener("input", () => {
  state.guiUnplacedQuery = elements.guiPreviewUnplacedSearch.value;

  if (state.guiPreview) {
    renderGuiUnplaced(state.guiPreview);
  }
});
elements.guiPreviewUnplacedToggle.addEventListener("click", () => {
  state.guiUnplacedCollapsed = !state.guiUnplacedCollapsed;
  updateGuiUnplacedCollapse();
});
elements.guiPreviewStatesToggle.addEventListener("click", () => {
  state.guiStatesCollapsed = !state.guiStatesCollapsed;
  updateGuiStatesCollapse();
});
elements.guiPreviewLauncher.addEventListener("click", () => setGuiPreviewExpanded(true));
elements.guiPreviewClose.addEventListener("click", () => setGuiPreviewExpanded(false));
elements.guiPreviewBackdrop.addEventListener("click", () => setGuiPreviewExpanded(false));
elements.addOutpostPage.addEventListener("click", addOutpostPage);
elements.deleteOutpostPage.addEventListener("click", deleteOutpostPage);
elements.workspaceFileSearch.addEventListener("input", () => {
  state.fileQuery = elements.workspaceFileSearch.value;
  renderWorkspaceFiles();
});
elements.previewFile.addEventListener("change", () => {
  renderPreviewSource().catch((error) => announce(error.message, true));
});
elements.previewSourceDetails.addEventListener("toggle", () => {
  if (elements.previewSourceDetails.open) {
    window.requestAnimationFrame(() => previewSourceEditor?.requestMeasure());
  }
});
elements.search.addEventListener("input", () => updateView({ query: elements.search.value }));
elements.clearSearch.addEventListener("click", () => updateView({ query: "", focusSearch: true }));
elements.viewModes.forEach((button) => button.addEventListener("click", () => {
  updateView({ mode: button.dataset.viewMode });
}));
elements.collapseGroups.addEventListener("click", collapseVisibleGroups);
elements.expandGroups.addEventListener("click", () => {
  state.collapsedGroups.clear();
  renderActiveSection();
});
elements.scroll.addEventListener("scroll", scheduleGuiPreviewLauncherUpdate, { passive: true });
window.addEventListener("scroll", scheduleGuiPreviewLauncherUpdate, { passive: true });
window.addEventListener("resize", scheduleGuiPreviewLauncherUpdate, { passive: true });
window.addEventListener("resize", updateSidebarResizerValues, { passive: true });
document.addEventListener("keydown", (event) => {
  if (document.querySelector("dialog[open]")) {
    return;
  }

  if (!desktopSidebarQuery.matches && state.navigationDrawerOpen) {
    if (event.key === "Escape") {
      event.preventDefault();
      setEditorNavigationDrawerOpen(false);
      return;
    }

    if (event.key === "Tab") {
      const focusable = [...elements.navigation.querySelectorAll(navigationFocusableSelector)]
        .filter((element) => !element.closest("[hidden]") && !element.closest("[inert]"));
      const first = focusable[0];
      const last = focusable.at(-1);

      if (first && last && event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (first && last && !event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }

      return;
    }
  }

  if (event.key === "Escape" && state.guiPreviewExpanded && !elements.mappingDialog.open) {
    event.preventDefault();
    setGuiPreviewExpanded(false);
  }
});

function openEditorSettings() {
  syncEditorSettingsForm(editorSettings);
  elements.settingsDialog.showModal();
  window.requestAnimationFrame(() => {
    elements.settingsDialog.querySelector("input:checked")?.focus();
  });
}

function syncEditorSettingsForm(settings) {
  const normalized = normalizeEditorSettings(settings);
  elements.settingsFontOptions.forEach((option) => {
    option.checked = option.value === normalized.inputFont;
  });
  elements.settingsTextSizeOptions.forEach((option) => {
    option.checked = option.value === normalized.textSize;
  });
  elements.settingsReduceMotion.checked = normalized.reduceMotion;
}

function saveEditorSettingsForm(event) {
  event.preventDefault();
  const values = new FormData(elements.settingsForm);
  editorSettings = applyEditorSettings(saveEditorSettings({
    inputFont: values.get("editor-input-font"),
    textSize: values.get("editor-text-size"),
    reduceMotion: values.has("editor-reduce-motion")
  }));
  elements.settingsDialog.close();
  window.requestAnimationFrame(() => {
    stickyGroupHeaders.invalidate();
    updateSidebarResizerValues();
  });
  announce("Saved editor display settings.");
}

const dropZone = document.querySelector("[data-drop-zone]");

for (const eventName of ["dragenter", "dragover"]) {
  dropZone?.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("is-dragging");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  dropZone?.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragging");
  });
}

dropZone?.addEventListener("drop", (event) => loadSelection(event.dataTransfer.files));

window.addEventListener("beforeunload", (event) => {
  if (workspaceHasUnexportedChanges(state.workspace) || sourceEditor?.hasDraftChanges() || state.recoveryCodeDraft) {
    event.preventDefault();
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    flushRemoteDraftSave();
  } else {
    renderSessionExpiry();
  }
});
window.addEventListener("pagehide", flushRemoteDraftSave);
window.addEventListener("pagehide", editorContentTransition.cleanup);
window.addEventListener("pagehide", schematicPreview.cleanup);

window.addEventListener("keydown", (event) => {
  const historyDirection = visualHistoryDirection(event);

  if (historyDirection && state.session && state.editorMode === "visual" && !usesNativeUndo(event.target)) {
    event.preventDefault();
    if (!remoteWorkspaceIssue()?.locksEditor) {
      applyVisualHistory(historyDirection);
    }
    return;
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase("en-US") === "f"
    && state.session && state.editorMode === "visual") {
    event.preventDefault();
    elements.search.focus();
    elements.search.select();
    return;
  }

  if (event.key === "Escape" && document.activeElement === elements.search && state.query) {
    updateView({ query: "", focusSearch: true });
    return;
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase("en-US") === "s" && state.session) {
    event.preventDefault();

    if (state.editorMode === "source") {
      return;
    }

    saveCurrentWorkspace();
  }
});

function usesNativeUndo(target) {
  if (!(target instanceof Element)) {
    return false;
  }

  if (target.closest("dialog[open]")) {
    return true;
  }

  if (target.isContentEditable || target.closest("[contenteditable='true']")) {
    return true;
  }

  const field = target.closest("textarea, input");

  if (!field || field.readOnly || field.disabled) {
    return false;
  }

  if (field.matches("textarea")) {
    return true;
  }

  return !["button", "checkbox", "color", "file", "radio", "range", "reset", "submit"].includes(field.type);
}

async function loadSelection(files) {
  if (!manualWorkspacesAllowed) {
    announce("Open configs from the private link created by /k admin editor.", true, "Server session required");
    return;
  }

  if (sourceEditor?.hasDraftChanges() && !sourceEditor.confirmDiscard()) {
    return;
  }

  if (workspaceHasUnexportedChanges(state.workspace)
    && !window.confirm(`Replace the open files? Changes that have not been ${state.remoteSession ? "saved to the server" : "downloaded"} will be lost.`)) {
    return;
  }

  sourceEditor?.discardDraft();

  try {
    setBusy(true, "Opening configs…");
    const workspace = await openWorkspaceSelection(files);
    const previousRemote = state.remoteSession;
    const previousDraftRecovery = state.draftRecovery;
    await loadWorkspace(workspace, { remoteSession: null, draftRecovery: null });
    previousRemote?.close();
    clearRemoteDraft(previousDraftRecovery);
    forgetRemoteEditorLink();
  } catch (error) {
    announce(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function loadDemoWorkspace(event) {
  const button = event.currentTarget;

  try {
    button.disabled = true;
    setBusy(true, "Opening demo…");
    await loadWorkspace(await exampleWorkspace());
  } catch (error) {
    announce(error.message, true);
  } finally {
    button.disabled = false;
    setBusy(false);
  }
}

async function loadWorkspace(workspace, {
  remoteSession = null,
  draftRecovery = null,
  announceOpen = true
} = {}) {
  elements.expiredDialog.close();
  Dropdown.getInstance(elements.saveMenuToggle)?.hide();
  state.editorMode = "visual";
  state.navigationDrawerOpen = false;
  state.navigationPanel = "sections";
  state.workspace = workspace;
  state.remoteSession = remoteSession;
  state.draftRecovery = draftRecovery;
  state.remoteIssueKey = "";
  state.remoteExpired = false;
  state.recoveryCodeDraft = null;
  window.clearInterval(sessionExpiryTimer);
  sessionExpiryTimer = 0;
  sessionExpiryWarning = 0;
  sourceEditor?.setReadOnly(false);
  state.fileQuery = "";
  state.activeSchematicPath = "";
  state.replacingSchematicPath = "";
  state.addingSchematicTarget = null;
  elements.workspaceFileSearch.value = "";
  await activateWorkspaceFile(workspace.activePath, { render: false });
  expandFolderPath(workspace.activePath);

  elements.empty.hidden = true;
  elements.shell.hidden = false;
  elements.workspace.hidden = false;
  elements.loadedActions.forEach((element) => element.hidden = false);
  renderWorkspace();
  if (remoteSession) {
    sessionExpiryTimer = window.setInterval(renderSessionExpiry, 1_000);
  }
  renderSessionExpiry({ warn: false });
  scrollEditorToTop();

  if (announceOpen) {
    const message = workspace.sourceKind === "example"
      ? `Loaded a KingdomsX demo with ${pluralize(workspace.files.length, "config file")}.`
      : workspace.files.length === 1
        ? `Opened ${state.session.fileName}.`
        : `Opened ${pluralize(workspace.files.length, "config file")}.`;
    announce(message, false, workspace.sourceKind === "example"
      ? "Demo configs loaded"
      : workspace.files.length === 1 ? "Config opened" : "Configs opened");
  }
}

async function prepareWorkspaceFileActivation(path) {
  const session = state.workspace.files.find((candidate) => candidate.fileName === path);

  if (!session) {
    throw new Error("That config file is no longer open.");
  }

  const [
    schema,
    effectiveIndex,
    defaultLanguageOptions,
    defaultConfigOptions,
    defaultMiscUpgradeOptions
  ] = await Promise.all([
    schemaForFile(session.fileName, session.document.index),
    effectiveIndexForSession(state.workspace, session, { templateProfileForKey }),
    defaultOptionsForResource("languages/en.yml"),
    defaultOptionsForResource("config.yml"),
    defaultOptionsForResource("misc-upgrades.yml")
  ]);

  const templatePresentation = buildTemplatePresentation({
    index: session.document.index,
    effectiveIndex,
    workspace: state.workspace,
    session
  });
  const messageMacros = messageMacroContext(state.workspace, session, defaultLanguageOptions, defaultConfigOptions);
  const messageTokens = collectMessageTokens(state.workspace, schema);

  return {
    session,
    schema,
    effectiveIndex,
    defaultLanguageOptions,
    defaultConfigOptions,
    defaultMiscUpgradeOptions,
    templatePresentation,
    messageMacros,
    messageTokens
  };
}

function commitWorkspaceFileActivation(destination, {
  render = true,
  targetPath = [],
  focusFile = false,
  focusContent = false
} = {}) {
  const fileChanged = state.session !== destination.session;
  Object.assign(state, destination);

  if (fileChanged) {
    state.guiSelectedSlot = null;
    state.activeSchematicPath = "";
  }

  state.workspace.activePath = state.session.fileName;

  if (render) {
    expandFolderPath(state.session.fileName);
  }

  state.query = "";
  state.guiUnplacedQuery = "";
  state.viewMode = "all";
  state.collapsedGroups.clear();
  rebuildStructure();
  synchronizeVisualHistory(state.session);
  state.activeSection = targetPath.length
    ? sectionKeyForPath(targetPath, state.sections) || state.sections[0]?.key || ""
    : state.sections[0]?.key ?? "";

  if (!render) {
    return;
  }

  renderWorkspace();

  if (targetPath.length) {
    expandOptionPath(targetPath);
    revealOption(targetPath, { immediate: true });
  } else {
    scrollEditorToTop();
  }

  if (!focusFile && !focusContent) {
    return;
  }

  return () => {
    if (focusFile) {
      focusWorkspaceFile(state.session.fileName);
    }

    if (focusContent) {
      focusSectionHeading();
    }
  };
}

async function activateWorkspaceFile(path, options = {}) {
  const destination = await prepareWorkspaceFileActivation(path);
  commitWorkspaceFileActivation(destination, options);
}

function rebuildStructure() {
  state.sections = buildFormStructure(state.session.document.index, state.schema?.schema);

  for (const section of state.sections) {
    section.label = labelForSection(state.schema?.id, section.key, section.label);
  }

  if (!state.sections.some((section) => section.key === state.activeSection)) {
    state.activeSection = state.sections[0]?.key ?? "";
  }
}

function renderWorkspace() {
  renderFileDetails();
  renderWorkspaceFiles();
  renderSchematicAddAction();

  if (state.activeSchematicPath) {
    elements.warnings.hidden = true;
    renderGuiPreview();
    renderActiveSchematic();
    renderStatus();
    renderEditorMode();
    window.requestAnimationFrame(updateSidebarResizerValues);
    return;
  }

  renderWarnings();
  renderGuiPreview();
  schematicPreview.render({
    workspace: state.workspace,
    session: state.session,
    schemaId: state.schema?.id,
    configIndex: state.effectiveIndex ?? state.session.document.index,
    messageMacros: state.messageMacros
  });
  ensureVisibleSection();
  renderViewControls();
  renderSections();
  renderActiveSection();
  renderStatus();
  renderEditorMode();
  window.requestAnimationFrame(updateSidebarResizerValues);
}

function renderFileDetails() {
  elements.fileName.textContent = state.session.fileName;
  elements.fileMeta.textContent = pluralize(state.session.document.index.entries.length, "setting");
  elements.workspaceName.textContent = state.workspace.name;
  elements.workspaceMeta.textContent = pluralize(
    state.workspace.files.length + workspaceSchematicFiles(state.workspace).length,
    "file"
  );

  const archiveDownload = state.workspace.sourceKind === "zip" || state.workspace.files.length > 1;
  renderSaveAction(archiveDownload);
  elements.originalDownloadLabels.forEach((label) => {
    label.textContent = archiveDownload ? "Download original ZIP" : "Download original backup";
  });
  elements.originalDownloadButtons.forEach((button) => {
    button.hidden = Boolean(state.remoteSession) || state.workspace.sourceKind === "example";
  });
  const serverSave = state.remoteSession || state.workspace.sourceKind === "example";
  elements.reviewEyebrow.textContent = serverSave ? "Review before saving" : "Review before download";
  elements.reviewWarningHeading.textContent = serverSave ? "Check before saving" : "Check before downloading";
}

function renderSaveAction(archiveDownload = state.workspace?.sourceKind === "zip" || state.workspace?.files.length > 1) {
  if (!state.workspace) {
    return;
  }

  const remoteIssue = remoteWorkspaceIssue();
  const expired = remoteIssue?.key === "expired";
  const demo = state.workspace.sourceKind === "example";
  const serverSave = Boolean(state.remoteSession) || demo;
  const saveLabel = state.saving
    ? "Saving…"
    : serverSave ? "Save to server" : archiveDownload ? "Download ZIP" : "Download file";
  const disabled = demo || editorBusy || state.downloadingRecovery || Boolean(state.remoteSession
    && (!workspaceHasUnexportedChanges(state.workspace) || remoteIssue));

  elements.saveActions.classList.toggle("btn-group", Boolean(state.remoteSession));
  elements.saveMenuToggle.hidden = !state.remoteSession;
  elements.saveMenuToggle.disabled = editorBusy || state.downloadingRecovery;

  elements.saveButtons.forEach((button) => {
    const backup = expired && button === elements.primarySaveButton;
    const label = backup ? "Download backup" : saveLabel;
    button.querySelector("[data-download-label]").textContent = label;
    button.disabled = backup ? editorBusy || state.downloadingRecovery : disabled;
    button.setAttribute("aria-label", state.saving ? "Saving changes to server" : label);
    const icon = button.querySelector("i");
    icon?.classList.toggle("fa-download", backup || (!state.saving && !serverSave));
    icon?.classList.toggle("fa-cloud-arrow-up", !backup && !state.saving && serverSave);
    icon?.classList.toggle("fa-circle-notch", state.saving);
    icon?.classList.toggle("fa-spin", state.saving);
  });
}

function renderWorkspaceFiles() {
  const schematicFiles = schematicPreviewsEnabled(state.workspace)
    ? workspaceSchematicFiles(state.workspace)
    : [];
  const files = [
    ...state.workspace.files.map((session) => ({
      kind: "config",
      path: session.fileName,
      session,
      addon: addonOwnershipForConfig(session.fileName)
    })),
    ...schematicFiles.map((entry) => ({
      kind: "schematic",
      path: entry.path,
      entry,
      addon: addonOwnershipForSchematic(entry.path)
    }))
  ];
  const multiFile = files.length >= 2;
  elements.workspaceFilesPanel.hidden = !multiFile;
  elements.filesResizer.hidden = !multiFile;
  elements.workspace.classList.toggle("has-file-rail", multiFile);

  if (elements.changeFileSingle) {
    elements.changeFileSingle.hidden = multiFile;
  }

  const query = state.fileQuery.trim().toLocaleLowerCase("en-US");
  const visible = files.filter((file) => !query || file.path.toLocaleLowerCase("en-US").includes(query));
  elements.workspaceFilesCount.textContent = query ? `${visible.length}/${files.length}` : String(files.length);
  elements.workspaceFiles.replaceChildren();

  if (!visible.length) {
    elements.workspaceFiles.append(element("p", "editor-sections-empty px-2 py-3 mb-0", "No files match this search."));
    return;
  }

  if (query) {
    for (const file of visible) {
      expandFolderPath(file.path);
    }
  }

  elements.workspaceFiles.append(renderFileTree(buildWorkspaceFileTree(visible), [], null, files));
}

function buildWorkspaceFileTree(files) {
  const root = { folders: new Map(), files: [] };

  for (const file of files) {
    insertWorkspaceFile(root, file.path.split("/").filter(Boolean), file);
  }

  return root;
}

function insertWorkspaceFile(node, parts, file) {
  if (parts.length === 1) {
    node.files.push({ name: parts[0], file });
    return;
  }

  const [head, ...rest] = parts;

  if (!node.folders.has(head)) {
    node.folders.set(head, { name: head, folders: new Map(), files: [] });
  }

  insertWorkspaceFile(node.folders.get(head), rest, file);
}

function expandFolderPath(fileName) {
  if (!fileName) {
    return;
  }

  const parts = fileName.split("/").filter(Boolean);
  let path = "";

  for (let index = 0; index < parts.length - 1; index += 1) {
    path = path ? `${path}/${parts[index]}` : parts[index];
    state.expandedFolders.add(path);
  }
}

function renderFileTree(node, folderPath = [], inheritedAddon = null, allFiles = []) {
  const list = element("ul", "editor-tree editor-file-tree list-unstyled m-0 p-0");
  const folders = [...node.folders.values()].sort((left, right) =>
    left.name.localeCompare(right.name, "en-US", { numeric: true, sensitivity: "base" })
  );
  const files = [...node.files].sort((left, right) =>
    left.name.localeCompare(right.name, "en-US", { numeric: true, sensitivity: "base" })
  );
  const items = [
    ...folders.map((folder) => ({ kind: "folder", folder })),
    ...files.map((file) => ({ kind: "file", file }))
  ];

  items.forEach((item, index) => {
    const li = element("li", `editor-tree-item editor-file-tree-item min-w-0${index === items.length - 1 ? " is-last" : ""}`);
    li.dataset.depth = String(folderPath.length);
    if (folderPath.length) {
      li.dataset.depthTone = String(((folderPath.length - 1) % 8) + 1);
    }

    if (item.kind === "folder") {
      const path = [...folderPath, item.folder.name].join("/");
      const open = state.expandedFolders.has(path);
      const folderFiles = allFiles.filter((file) => file.path === path || file.path.startsWith(`${path}/`));
      const sharedAddon = sharedAddonOwnership(folderFiles.map((file) => file.addon));
      const folderAddon = sharedAddon && folderFiles.some((file) => file.addon?.rootFolder === path)
        ? sharedAddon
        : null;
      const toggle = element("button", "editor-file-folder editor-interactive-surface w-100 min-w-0 text-start d-flex align-items-center gap-2");
      toggle.type = "button";
      toggle.dataset.workspaceFolder = path;
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      const label = element("span", "d-flex align-items-center justify-content-between gap-2 min-w-0 flex-grow-1");
      label.append(element("span", "min-w-0 text-truncate", item.folder.name));
      if (folderAddon && folderAddon.id !== inheritedAddon?.id) {
        label.append(addonPill(folderAddon));
      }

      toggle.append(
        element("i", open ? "fa-solid fa-chevron-down" : "fa-solid fa-chevron-right"),
        label
      );
      toggle.addEventListener("click", () => {
        if (state.expandedFolders.has(path)) {
          state.expandedFolders.delete(path);
        } else {
          state.expandedFolders.add(path);
        }

        renderWorkspaceFiles();
      });
      li.append(toggle);
      if (open) {
        li.append(renderFileTree(
          item.folder,
          [...folderPath, item.folder.name],
          folderAddon ?? inheritedAddon,
          allFiles
        ));
      }
    } else {
      li.append(item.file.file.kind === "schematic"
        ? workspaceSchematicButton(item.file.file.entry, item.file.name, item.file.file.addon, inheritedAddon)
        : workspaceFileButton(item.file.file.session, item.file.name, item.file.file.addon, inheritedAddon));
    }

    list.append(li);
  });

  return list;
}

function setupSidebarResizer(config) {
  let drag = null;

  config.handle.addEventListener("pointerdown", (event) => {
    if (!desktopSidebarQuery.matches || event.button !== 0) {
      return;
    }

    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: config.panel.getBoundingClientRect().width
    };
    config.handle.setPointerCapture(event.pointerId);
    config.handle.classList.add("is-active");
    document.body.classList.add("is-resizing-sidebar");
    event.preventDefault();
  });

  config.handle.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }

    setSidebarWidth(config, drag.startWidth + event.clientX - drag.startX);
  });

  const stopDragging = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }

    drag = null;
    config.handle.classList.remove("is-active");
    document.body.classList.remove("is-resizing-sidebar");
  };
  config.handle.addEventListener("pointerup", stopDragging);
  config.handle.addEventListener("pointercancel", stopDragging);
  config.handle.addEventListener("lostpointercapture", stopDragging);

  config.handle.addEventListener("keydown", (event) => {
    if (!desktopSidebarQuery.matches) {
      return;
    }

    const currentWidth = config.panel.getBoundingClientRect().width;

    if (event.key === "ArrowLeft") {
      setSidebarWidth(config, currentWidth - 16);
    } else if (event.key === "ArrowRight") {
      setSidebarWidth(config, currentWidth + 16);
    } else if (event.key === "Home") {
      resetSidebarWidth(config);
    } else if (event.key === "End") {
      setSidebarWidth(config, sidebarWidthLimits(config).max);
    } else {
      return;
    }

    event.preventDefault();
  });

  config.handle.addEventListener("dblclick", () => resetSidebarWidth(config));
}

function setSidebarWidth(config, width) {
  const { min, max } = sidebarWidthLimits(config);
  const nextWidth = Math.min(Math.max(width, min), max);
  elements.workspace.style.setProperty(config.property, `${nextWidth}px`);
  updateSidebarResizerValue(config, nextWidth, min, max);
}

function resetSidebarWidth(config) {
  elements.workspace.style.removeProperty(config.property);
  window.requestAnimationFrame(() => updateSidebarResizerValue(config));
}

function sidebarWidthLimits(config) {
  const rootSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const minimum = config.minRem * rootSize;
  const otherPanelsWidth = sidebarResizers
    .filter((candidate) => candidate !== config && !candidate.panel.hidden)
    .reduce((total, candidate) => total + candidate.panel.getBoundingClientRect().width, 0);
  const handlesWidth = sidebarResizers
    .filter((candidate) => !candidate.handle.hidden && getComputedStyle(candidate.handle).display !== "none")
    .reduce((total, candidate) => total + candidate.handle.getBoundingClientRect().width, 0);
  const roomBesideEditor = elements.workspace.getBoundingClientRect().width
    - otherPanelsWidth
    - handlesWidth
    - (20 * rootSize);
  const maximum = Math.max(minimum, Math.min(config.maxRem * rootSize, roomBesideEditor));

  return { min: minimum, max: maximum };
}

function updateSidebarResizerValues() {
  sidebarResizers.forEach((config) => updateSidebarResizerValue(config));
}

function updateSidebarResizerValue(config, width, min, max) {
  const limits = min === undefined || max === undefined ? sidebarWidthLimits(config) : { min, max };
  const currentWidth = width ?? config.panel.getBoundingClientRect().width;
  const rootSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

  config.handle.setAttribute("aria-valuemin", String(Math.round(limits.min)));
  config.handle.setAttribute("aria-valuemax", String(Math.round(limits.max)));
  config.handle.setAttribute("aria-valuenow", String(Math.round(currentWidth)));
  config.handle.setAttribute("aria-valuetext", `${(currentWidth / rootSize).toFixed(1)} rem`);
}

function setEditorNavigationDrawerOpen(expanded, { restoreFocus = true } = {}) {
  if (desktopSidebarQuery.matches) {
    return;
  }

  if (expanded === state.navigationDrawerOpen) {
    return;
  }

  if (expanded) {
    navigationOpener = document.activeElement;
  }

  if (expanded) {
    state.navigationPanel = defaultEditorNavigationPanel();
  }

  state.navigationDrawerOpen = expanded;
  renderEditorNavigation();

  if (expanded) {
    elements.navigationClose.focus({ preventScroll: true });
  } else if (restoreFocus) {
    navigationOpener?.focus?.({ preventScroll: true });
  }
}

function setEditorNavigationPanel(panel) {
  if (!["files", "sections"].includes(panel) || desktopSidebarQuery.matches) {
    return;
  }

  state.navigationPanel = panel;
  renderEditorNavigation();
}

function handleEditorNavigationTabKeydown(event) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
    return;
  }

  const tabs = [...elements.navigationTabButtons].filter((button) => !button.hidden);
  const currentIndex = tabs.indexOf(event.currentTarget);

  if (currentIndex < 0) {
    return;
  }

  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? tabs.length - 1
      : (currentIndex + (event.key === "ArrowLeft" ? -1 : 1) + tabs.length) % tabs.length;
  const next = tabs[nextIndex];
  event.preventDefault();
  setEditorNavigationPanel(next.dataset.editorNavigationTab);
  next.focus();
}

function defaultEditorNavigationPanel() {
  return state.editorMode === "source" || state.activeSchematicPath ? "files" : "sections";
}

function renderEditorNavigation() {
  const mobileNavigation = !desktopSidebarQuery.matches;
  const focusedControl = elements.controls.contains(document.activeElement) ? document.activeElement : null;
  const available = mobileNavigation || state.editorMode !== "source" || state.workspace?.files.length > 1;

  if (!available) {
    state.navigationDrawerOpen = false;
  }

  const expanded = available && (mobileNavigation ? state.navigationDrawerOpen : true);
  elements.headerNavigation.hidden = !mobileNavigation;
  elements.navigationToggle.hidden = !mobileNavigation;
  elements.navigationToggle.setAttribute("aria-expanded", String(expanded));
  elements.navigationToggle.setAttribute(
    "aria-label",
    `${expanded ? "Hide" : "Show"} editor navigation`
  );
  elements.navigationToggle.title = `${expanded ? "Hide" : "Show"} editor navigation`;

  elements.workspace.classList.toggle("is-navigation-open", mobileNavigation && expanded);
  elements.navigation.toggleAttribute("inert", !expanded);
  elements.navigation.setAttribute("aria-hidden", String(!expanded));
  elements.navigation.setAttribute("role", mobileNavigation ? "dialog" : "navigation");

  if (mobileNavigation && expanded) {
    elements.navigation.setAttribute("aria-modal", "true");
  } else {
    elements.navigation.removeAttribute("aria-modal");
  }

  elements.navigationBackdrop.hidden = !mobileNavigation || !expanded;
  document.body.classList.toggle("editor-navigation-open", mobileNavigation && expanded);

  const filesAvailable = elements.workspace.classList.contains("has-file-rail")
    || (mobileNavigation && state.editorMode === "source");
  const sectionsAvailable = state.editorMode !== "source" && !state.activeSchematicPath;
  const tabsAvailable = mobileNavigation && filesAvailable && sectionsAvailable;
  const activePanel = tabsAvailable
    ? state.navigationPanel
    : filesAvailable ? "files" : "sections";
  elements.navigationTabs.hidden = !tabsAvailable;

  elements.navigationTabButtons.forEach((button) => {
    const active = button.dataset.editorNavigationTab === activePanel;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  elements.navigationTabs.dataset.editorNavigationPanel = activePanel;

  elements.workspaceFilesPanel.hidden = !filesAvailable || (mobileNavigation && activePanel !== "files");
  elements.sidebar.hidden = !sectionsAvailable || (mobileNavigation && activePanel !== "sections");

  for (const [panel, tabId] of [
    [elements.workspaceFilesPanel, "editor-navigation-files-tab"],
    [elements.sidebar, "editor-navigation-sections-tab"]
  ]) {
    if (tabsAvailable) {
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", tabId);
    } else {
      panel.removeAttribute("role");
      panel.removeAttribute("aria-labelledby");
    }
  }

  const controlsHost = mobileNavigation ? elements.sidebarControls : elements.headerControls;
  elements.headerControls.hidden = mobileNavigation;
  elements.sidebarControls.hidden = !mobileNavigation;
  elements.headerActions.classList.toggle("me-auto", mobileNavigation);
  elements.settingsOpen.classList.toggle("editor-header-icon-button", !mobileNavigation);
  elements.settingsOpen.querySelector("span").classList.toggle("d-none", !mobileNavigation);

  if (elements.controls.parentElement !== controlsHost) {
    controlsHost.append(elements.controls);

    if (focusedControl) {
      const focusTarget = mobileNavigation && !expanded ? elements.navigationToggle : focusedControl;
      focusTarget.focus({ preventScroll: true });
    }
  }
}

function workspaceFileButton(session, name, addon, inheritedAddon) {
  const changeCount = session.document.changes.size;
  const button = element("button", "editor-workspace-file editor-interactive-surface w-100 min-w-0 text-start");
  button.type = "button";
  button.dataset.workspaceFile = session.fileName;
  button.classList.toggle("is-active", session === state.session && !state.activeSchematicPath);

  const heading = element("span", "d-flex align-items-center justify-content-between gap-2");
  heading.append(element("strong", "text-truncate", name));
  const badges = element("span", "d-inline-flex align-items-center flex-shrink-0 gap-1");

  if (addon && addon.id !== inheritedAddon?.id) {
    badges.append(addonPill(addon));
  }

  if (changeCount) {
    badges.append(sidebarChangeBadge(changeCount, pluralize(changeCount, "change")));
  }

  if (badges.childNodes.length) {
    heading.append(badges);
  }

  button.append(heading);
  button.setAttribute("aria-current", session === state.session && !state.activeSchematicPath ? "page" : "false");
  button.addEventListener("click", async () => {
    if (session === state.session && state.activeSchematicPath) {
      state.activeSchematicPath = "";
      renderWorkspace();
      scrollEditorToTop();
      if (!desktopSidebarQuery.matches) {
        setEditorNavigationDrawerOpen(false, { restoreFocus: false });
        focusSectionHeading();
      }

      return;
    }

    const focusNavigation = document.activeElement === button;
    const mobileNavigation = !desktopSidebarQuery.matches;
    const opened = await openWorkspaceFile(session.fileName, {
      focusFile: focusNavigation && !mobileNavigation
    });

    if (mobileNavigation && (opened || state.session === session)) {
      setEditorNavigationDrawerOpen(false, { restoreFocus: false });
      renderEditorMode({ focus: true });
    }
  });
  return button;
}

function workspaceSchematicButton(entry, name, addon, inheritedAddon) {
  const changed = state.workspace.changedSupportFiles.has(entry.path);
  const changeLabel = state.workspace.originalSupportEntries.has(entry.path) ? "replaced" : "added";
  const button = element("button", "editor-workspace-file editor-workspace-file--schematic editor-interactive-surface w-100 min-w-0 text-start");
  button.type = "button";
  button.dataset.workspaceSchematic = entry.path;
  button.classList.toggle("is-active", entry.path === state.activeSchematicPath);

  const heading = element("span", "d-flex align-items-center justify-content-between gap-2");
  const label = element("span", "d-flex align-items-center gap-2 min-w-0");
  label.append(
    element("i", "fa-solid fa-cubes flex-shrink-0"),
    element("strong", "text-truncate", name)
  );
  heading.append(label);
  const badges = element("span", "d-inline-flex align-items-center flex-shrink-0 gap-1");

  if (addon && addon.id !== inheritedAddon?.id) {
    badges.append(addonPill(addon));
  }

  if (changed) {
    badges.append(sidebarChangeBadge(1, changeLabel));
  }

  if (badges.childNodes.length) {
    heading.append(badges);
  }

  button.append(heading);
  button.setAttribute("aria-current", entry.path === state.activeSchematicPath ? "page" : "false");
  button.addEventListener("click", async () => {
    await openWorkspaceSchematic(entry.path);
  });
  return button;
}

function renderSchematicAddAction() {
  const target = schematicAddTarget();
  const existingLevels = target ? schematicLevelsInFolder(target.folder) : [];
  const allLevelsDefined = Number.isSafeInteger(target?.maxLevel)
    && existingLevels.filter((level) => level <= target.maxLevel).length >= target.maxLevel;
  elements.addSchematic.hidden = !target
    || !workspaceSchematicEditable(state.workspace, target.folder)
    || allLevelsDefined;
  elements.removeSchematic.hidden = !state.activeSchematicPath
    || !workspaceSchematicEditable(state.workspace, state.activeSchematicPath)
    || !schematicContextForPath(state.activeSchematicPath);
}

function openAddSchematicDialog() {
  const target = schematicAddTarget();

  if (!target) {
    announce("That building's schematic folder could not be determined.", true);
    return;
  }

  const existingLevels = schematicLevelsInFolder(target.folder);
  const suggestedLevel = suggestedSchematicLevel(existingLevels, target.maxLevel);
  state.addingSchematicTarget = target;
  elements.addSchematicForm.reset();
  elements.addSchematicLevel.max = target.maxLevel ?? "";
  elements.addSchematicLevel.value = String(suggestedLevel);
  elements.addSchematicDescription.textContent = target.maxLevel
    ? `This building has ${target.maxLevel} levels. The new schematic is used from its starting level until the next numbered schematic.`
    : "The new schematic is used from its starting level until the next numbered schematic.";
  elements.addSchematicHint.textContent = existingLevels.length
    ? `Current starting levels: ${formatLevelList(existingLevels)}. Levels without their own file use the most recent earlier schematic.`
    : "Start with level 1 so every building level has a design.";
  renderAddSchematicPath();
  elements.addSchematicDialog.showModal();
  elements.addSchematicLevel.focus();
}

function schematicAddTarget() {
  if (!state.workspace || !schematicPreviewsEnabled(state.workspace)) {
    return null;
  }

  if (state.activeSchematicPath) {
    return schematicContextForPath(state.activeSchematicPath);
  }

  const folder = schematicFolderForBuilding(state.session?.fileName, state.schema?.id);

  if (!folder) {
    return null;
  }

  return {
    folder,
    maxLevel: configuredBuildingMaxLevel(state.effectiveIndex ?? state.session.document.index)
  };
}

function schematicContextForPath(path) {
  const normalized = String(path ?? "").replaceAll("\\", "/");
  const match = /^((?:.*\/)?schematics\/(structures|turrets)\/([^/]+))\/([1-9]\d*)\.(?:schematic|schem)$/i.exec(normalized);

  if (!match) {
    return null;
  }

  const markerIndex = match[1].toLocaleLowerCase("en-US").lastIndexOf("/schematics/");
  const root = markerIndex < 0 ? "" : match[1].slice(0, markerIndex);
  const familyFolder = match[2].toLocaleLowerCase("en-US") === "turrets" ? "Turrets" : "Structures";
  const configPath = [root, familyFolder, `${match[3]}.yml`].filter(Boolean).join("/");
  const config = state.workspace.files.find((session) =>
    session.fileName.toLocaleLowerCase("en-US") === configPath.toLocaleLowerCase("en-US")
  );

  return {
    folder: match[1],
    level: Number.parseInt(match[4], 10),
    config,
    maxLevel: config ? configuredBuildingMaxLevel(config.document.index) : null
  };
}

function schematicLevelsInFolder(folder) {
  const prefix = `${folder.toLocaleLowerCase("en-US")}/`;

  return workspaceSchematicFiles(state.workspace).flatMap((entry) => {
    const normalized = entry.path.replaceAll("\\", "/");

    if (!normalized.toLocaleLowerCase("en-US").startsWith(prefix)) {
      return [];
    }

    const relative = normalized.slice(folder.length + 1);
    const match = /^([1-9]\d*)\.(?:schematic|schem)$/i.exec(relative);

    return match ? [Number.parseInt(match[1], 10)] : [];
  }).sort((left, right) => left - right);
}

function suggestedSchematicLevel(existingLevels, maxLevel) {
  if (!existingLevels.length) {
    return 1;
  }

  if (Number.isSafeInteger(maxLevel)) {
    for (let level = 1; level <= maxLevel; level += 1) {
      if (!existingLevels.includes(level)) {
        return level;
      }
    }

    return maxLevel;
  }

  return existingLevels.at(-1) + 1;
}

function renderAddSchematicPath() {
  const target = state.addingSchematicTarget;

  if (!target) {
    return;
  }

  const level = elements.addSchematicLevel.value || "level";
  const extension = /\.(schematic|schem)$/i.exec(elements.addSchematicFile.files[0]?.name ?? "")?.[1]
    ?.toLocaleLowerCase("en-US") ?? "schematic";
  elements.addSchematicPath.textContent = `${target.folder}/${level}.${extension}`;
}

function formatLevelList(levels) {
  if (levels.length === 1) {
    return String(levels[0]);
  }

  if (levels.length === 2) {
    return `${levels[0]} and ${levels[1]}`;
  }

  return `${levels.slice(0, -1).join(", ")}, and ${levels.at(-1)}`;
}

async function removeActiveSchematic() {
  const path = state.activeSchematicPath;
  const context = schematicContextForPath(path);

  if (!path || !context) {
    return;
  }

  if (!window.confirm(`Remove ${path} from the edited ZIP? The original backup will remain unchanged.`)) {
    return;
  }

  try {
    setBusy(true, "Removing schematic…");
    removeWorkspaceSchematic(state.workspace, path);
    schematicPreview.invalidate();

    const remaining = workspaceSchematicFiles(state.workspace)
      .filter((entry) => schematicContextForPath(entry.path)?.folder.toLocaleLowerCase("en-US")
        === context.folder.toLocaleLowerCase("en-US"))
      .sort((left, right) =>
        schematicContextForPath(left.path).level - schematicContextForPath(right.path).level
      );
    const previous = remaining.filter((entry) => schematicContextForPath(entry.path).level < context.level).at(-1);
    const nextPath = previous?.path ?? remaining[0]?.path ?? "";

    if (nextPath) {
      state.activeSchematicPath = nextPath;
      renderWorkspace();
    } else {
      state.activeSchematicPath = "";
      if (context.config && context.config !== state.session) {
        await activateWorkspaceFile(context.config.fileName);
      } else {
        renderWorkspace();
      }
    }

    announce(`Removed schematic ${path}.`, false, "Schematic removed");
  } catch (error) {
    announce(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function openWorkspaceSchematic(path) {
  if (!schematicPreviewsEnabled(state.workspace)) {
    return;
  }

  const entry = workspaceSchematicFiles(state.workspace).find((candidate) => candidate.path === path);

  if (!entry) {
    announce("That schematic is no longer open.", true);
    return;
  }

  if (state.editorMode === "source") {
    const editor = await loadSourceEditor();

    if (remoteWorkspaceIssue()?.key !== "expired" && !await editor.applyDraft({ announceUnchanged: false })) {
      return;
    }

    state.editorMode = "visual";
  }

  state.activeSchematicPath = path;
  renderWorkspace();
  scrollEditorToTop();
  if (!desktopSidebarQuery.matches) {
    setEditorNavigationDrawerOpen(false, { restoreFocus: false });
  }

  announce(`Opened ${path}.`, false, "Schematic opened");
}

async function renderActiveSchematic() {
  const entry = workspaceSchematicFiles(state.workspace)
    .find((candidate) => candidate.path === state.activeSchematicPath);

  if (!entry) {
    state.activeSchematicPath = "";
    return;
  }

  const context = schematicContextForPath(entry.path);
  const config = context?.config;
  const configIndex = config
    ? await effectiveIndexForSession(state.workspace, config, { templateProfileForKey })
      .catch(() => config.document.index)
    : null;

  if (state.activeSchematicPath !== entry.path) {
    return;
  }

  const messageMacros = config
    ? messageMacroContext(
      state.workspace,
      config,
      state.defaultLanguageOptions,
      state.defaultConfigOptions
    )
    : null;

  return schematicPreview.renderFile(entry, {
    workspace: state.workspace,
    configIndex,
    messageMacros
  });
}

async function openWorkspaceFile(path, detail = {}) {
  try {
    const opened = await editorContentNavigation.openFile(path, detail);

    if (opened) {
      announce(`Opened ${state.session.fileName}.`, false, "Config opened");
    }

    return opened;
  } catch (error) {
    announce(error.message, true);
    return false;
  }
}

async function setEditorMode(mode, { focus = false } = {}) {
  if (!["visual", "source"].includes(mode) || mode === state.editorMode || !state.session) {
    return;
  }

  let editor;

  try {
    setBusy(true, "Loading code editor…");
    editor = await loadSourceEditor();
  } catch {
    announce("The code editor could not be loaded. Check your connection and try again.", true, "Code editor unavailable");
    return;
  } finally {
    setBusy(false);
  }

  if (mode === "visual" && remoteWorkspaceIssue()?.key !== "expired"
    && !await editor.applyDraft({ announceUnchanged: false })) {
    return;
  }

  state.editorMode = mode;
  setEditorNavigationDrawerOpen(false, { restoreFocus: false });
  renderEditorMode({ focus });
  scrollEditorToTop();
  window.requestAnimationFrame(scrollEditorToTop);
}

function renderEditorMode({ focus = false } = {}) {
  const sourceMode = state.editorMode === "source";
  const schematicMode = Boolean(state.activeSchematicPath);
  const expired = remoteWorkspaceIssue()?.key === "expired";

  sourceEditor?.setReadOnly(expired);

  if (sourceMode && !sourceEditor.open(state.session, { focus })) {
    state.editorMode = "visual";
    return renderEditorMode();
  }

  if (!sourceMode) {
    if (!expired) {
      sourceEditor?.sync(state.session);
    }
  } else if (expired && state.recoveryCodeDraft?.fileName === state.session.fileName) {
    sourceEditor.restoreDraft(state.session, state.recoveryCodeDraft.source);
  }

  elements.workspace.classList.toggle("is-source-mode", sourceMode);
  elements.workspace.classList.toggle("is-schematic-mode", schematicMode);
  elements.sidebar.hidden = sourceMode || schematicMode;
  elements.sectionsResizer.hidden = sourceMode || schematicMode;
  elements.visualWorkspace.hidden = sourceMode;
  elements.sourceWorkspace.hidden = !sourceMode;
  elements.tools.hidden = schematicMode;
  elements.sectionContent.hidden = schematicMode;
  elements.editorModeSwitch.hidden = schematicMode;
  elements.scroll.classList.toggle("overflow-auto", !sourceMode);
  elements.scroll.classList.toggle("overflow-hidden", sourceMode);
  elements.editorModeSwitch.dataset.editorModeCurrent = state.editorMode;
  elements.editorModeButtons.forEach((button) => {
    const active = button.dataset.editorMode === state.editorMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  if (!sourceMode && focus) {
    window.requestAnimationFrame(focusSectionHeading);
  }

  if (sourceMode && state.guiPreviewExpanded) {
    setGuiPreviewExpanded(false, { restoreFocus: false });
  }

  scheduleGuiPreviewLauncherUpdate();
  renderEditorNavigation();
}

function renderGuiPreview() {
  const isGui = !state.activeSchematicPath && state.schema?.id === "guis/schema";
  elements.guiPreview.hidden = !isGui;

  if (!isGui) {
    state.guiPreview = null;
    state.guiSelectedSlot = null;

    if (state.guiPreviewExpanded) {
      setGuiPreviewExpanded(false, { restoreFocus: false });
    }

    elements.outpostPageActions.hidden = true;
    scheduleGuiPreviewLauncherUpdate();
    return;
  }

  const preview = buildGuiPreview(state.effectiveIndex ?? state.session.document.index, {
    macros: state.messageMacros
  });
  state.guiPreview = preview;
  const previewMeta = [
    element("span", "editor-pill fw-bold text-nowrap d-inline-flex align-items-center", `${preview.columns} × ${preview.rows}`),
    element("span", "editor-pill fw-bold text-nowrap d-inline-flex align-items-center", pluralize(preview.options.length, "button")),
    element("span", "editor-pill fw-bold text-nowrap d-inline-flex align-items-center", preview.type)
  ];
  const outpostPage = outpostPageDetails(state.session.fileName);
  const outpostPages = outpostPage ? matchingOutpostPages(outpostPage) : [];

  if (outpostPage) {
    previewMeta.unshift(element(
      "span",
      "editor-pill fw-bold text-nowrap d-inline-flex align-items-center",
      `Page ${outpostPage.page} of ${outpostPages.length}`
    ));
  }

  elements.guiPreviewMeta.replaceChildren(...previewMeta);
  elements.outpostPageActions.hidden = !outpostPage
    || !workspaceOutpostPageEditable(state.workspace, state.session.fileName);
  elements.deleteOutpostPage.disabled = outpostPages.length <= 1;
  elements.deleteOutpostPage.title = outpostPages.length <= 1
    ? "An outpost needs at least one page"
    : `Delete outpost page ${outpostPage?.page}`;

  const notices = [];

  if (preview.inheritedCount) {
    notices.push(`${pluralize(preview.inheritedCount, "button")} come from a shared template. Select one to customize it only for this file.`);
  }

  if (preview.collisions.length) {
    notices.push(`${pluralize(preview.collisions.length, "slot")} contain more than one button.`);
  }

  if (preview.invalid.length) {
    notices.push(`${pluralize(preview.invalid.length, "button position")} fall outside this inventory.`);
  }

  elements.guiPreviewNotice.textContent = notices.join(" ");
  elements.guiPreviewNotice.hidden = notices.length === 0;
  elements.guiPreviewHelp.textContent = preview.options.length
    ? "Select a slot to configure its button. Drag local buttons with one fixed position to an empty slot."
    : "Select an empty slot to add the first button to this menu.";

  elements.guiPreviewGrid.dataset.inventoryType = preview.type.toLocaleUpperCase("en-US");
  const layout = minecraftGuiLayout(preview.type, preview.rows);
  const stage = element("div", "editor-inventory-stage position-relative w-100");
  stage.style.aspectRatio = `${layout.width} / ${layout.height}`;
  const canvas = element("canvas", "editor-inventory-canvas d-block w-100 h-100");
  canvas.setAttribute("aria-hidden", "true");
  const overlay = element("div", "editor-inventory-overlay position-absolute");
  overlay.append(...preview.slots.map((slot, index) =>
    guiSlot(slot, preview, layout.slots[index], layout)
  ));
  const loading = element("span", "editor-inventory-loading position-absolute fw-bold text-center", "Rendering Minecraft GUI…");
  stage.append(canvas, loading, overlay);
  elements.guiPreviewGrid.replaceChildren(stage);

  const renderId = ++guiRenderSequence;
  renderMinecraftGui(canvas, preview, {
    title: previewGuiMessage(preview.title, state.messageMacros),
    scale: minecraftGuiRenderScale(layout.width, canvas.clientWidth, window.devicePixelRatio)
  }).then(() => {
    if (renderId !== guiRenderSequence || !stage.isConnected) {
      return;
    }

    stage.classList.add("is-ready");
    loading.remove();
  }).catch(() => {
    if (renderId !== guiRenderSequence || !stage.isConnected) {
      return;
    }

    stage.classList.add("has-render-error");
    loading.textContent = "The Minecraft GUI could not be rendered. Slot editing is still available.";
  });
  renderGuiUnplaced(preview);
  renderGuiStates(preview);
  renderGuiSlotPane(preview);
  scheduleGuiPreviewLauncherUpdate();
}

function renderGuiSlotPane(preview) {
  const selected = preview.slots[state.guiSelectedSlot];
  elements.guiPreviewWorkspace.classList.toggle("has-selected-slot", Boolean(selected));
  elements.guiSlotPane.hidden = !selected;

  if (!selected) {
    state.guiSelectedSlot = null;
    elements.guiSlotPane.replaceChildren();
    return;
  }

  const heading = element("div", "d-flex align-items-start justify-content-between gap-3");
  const copy = element("div", "min-w-0");
  copy.append(
    element("span", "editor-eyebrow", "Inventory slot"),
    element("h2", "editor-gui-slot-pane-title mb-1 mt-1", `Slot ${selected.slot}`)
  );
  const close = headerIconButton("Close slot actions", "fa-solid fa-xmark", () => {
    const slot = selected.slot;
    state.guiSelectedSlot = null;
    renderGuiSlotPane(preview);
    updateGuiSlotSelection();
    elements.guiPreviewGrid.querySelector(`[data-slot="${slot}"]`)?.focus();
  });
  heading.append(copy, close);

  const body = element("div", "d-grid gap-2 mt-3");

  if (!selected.options.length) {
    body.append(element("p", "editor-gui-slot-pane-help editor-preview-copy mb-1", "This slot is empty and available for a new button."));
    const add = element("button", "btn btn-site btn-site-primary d-inline-flex align-items-center justify-content-center gap-2 fw-bold");
    add.type = "button";
    add.append(element("i", "fa-solid fa-plus"), document.createTextNode("Add button here"));
    add.addEventListener("click", () => addGuiButtonAtSlot(selected.slot));
    body.append(add);
  } else {
    const collision = selected.options.length > 1;

    if (collision) {
      body.append(element(
        "p",
        "editor-gui-slot-pane-warning editor-preview-notice mb-1",
        `${pluralize(selected.options.length, "button")} currently use this slot. Choose which one to configure or remove.`
      ));
    }

    selected.options.forEach((option) => body.append(guiSlotOptionActions(option)));
  }

  elements.guiSlotPane.replaceChildren(heading, body);
}

function guiSlotOptionActions(option) {
  const card = element("section", "editor-gui-slot-option rounded-3 p-3 d-grid gap-3");
  const details = element("div", "d-grid gap-2 min-w-0");
  details.append(element("strong", "d-block text-truncate", option.label));
  const appearances = option.states.length ? option.states : [option];
  details.append(...appearances.map((appearance) => guiSlotItemAppearance(option, appearance)));

  if (option.inherited || option.generated) {
    details.append(element(
      "span",
      "editor-pill fw-bold text-nowrap d-inline-flex align-items-center justify-self-start",
      option.generated ? `Shared: ${option.generatedBy}` : `Inherited: ${option.origin}`
    ));
  }

  const actions = element("div", "d-flex flex-wrap gap-2");
  const configure = element("button", "btn btn-sm btn-site-secondary d-inline-flex align-items-center gap-2 flex-grow-1 justify-content-center");
  const effectiveEntry = state.effectiveIndex?.byPath.get(pathKey(option.path));
  const local = !option.inherited && !option.generated;
  const canCustomize = local || canMaterializeEffectiveEntry(effectiveEntry);
  const actionLabel = local
    ? "Config"
    : canCustomize
      ? "Customize button"
      : option.generated ? "Open shared settings" : "Open template";
  configure.type = "button";
  configure.append(
    element("i", canCustomize ? "fa-solid fa-sliders" : "fa-solid fa-arrow-up-right-from-square"),
    document.createTextNode(actionLabel)
  );
  configure.addEventListener("click", () => {
    setGuiPreviewExpanded(false, { restoreFocus: false });
    openGuiOption(option);
  });
  actions.append(configure);

  if (!option.switchShared && !option.inherited && !option.generated) {
    const remove = element("button", "btn btn-sm btn-site-danger d-inline-flex align-items-center gap-2");
    remove.type = "button";
    remove.append(element("i", "fa-solid fa-trash"), document.createTextNode("Remove button"));
    remove.addEventListener("click", () => removeOption(option.path));
    actions.append(remove);
  }

  card.append(details, actions);
  return card;
}

function guiSlotItemAppearance(option, appearance) {
  const conditional = option.states.length > 0;
  const item = element("div", "editor-gui-slot-appearance d-grid gap-1 min-w-0");

  if (conditional) {
    item.append(element(
      "span",
      "editor-condition-label d-block fw-bold",
      `${appearance.conditionLabel}:`
    ));
  }

  const material = appearance.previewMaterial
    || appearance.material
    || option.previewMaterial
    || option.material
    || "Unspecified";
  const preview = element("div", "editor-gui-item d-flex align-items-start gap-3 min-w-0");
  preview.append(materialIconElement(material, {
    className: "editor-gui-item-icon flex-shrink-0",
    skull: appearance.previewSkull
      || appearance.skull
      || option.previewSkull
      || option.representativeSkull
      || option.skull,
    components: appearance.components || option.components
  }));
  preview.append(guiItemNameTooltip(appearance, option));
  item.append(preview);
  return item;
}

function addGuiButtonAtSlot(slot) {
  const group = guiOptionsGroup();

  if (!group) {
    announce("This GUI schema does not expose an options section for new buttons.", true);
    return;
  }

  openMappingDialog(group, { guiSlot: slot });
}

function guiOptionsGroup() {
  const visit = (groups) => {
    for (const group of groups ?? []) {
      if (samePath(group.path, ["options"])) {
        return group;
      }

      const nested = visit(group.groups);

      if (nested) {
        return nested;
      }
    }

    return null;
  };
  const existing = visit(state.sections);

  if (existing) {
    return existing;
  }

  const type = unwrapNullable(typeAtPath(state.schema?.schema, ["options"]));

  if (type?.kind !== "mapping") {
    return null;
  }

  return {
    key: "options",
    label: "Options",
    path: ["options"],
    valueType: type.values,
    keyType: type.keys,
    requiredKeys: type.required ?? []
  };
}

let guiPreviewLauncherFrame = 0;

function scheduleGuiPreviewLauncherUpdate() {
  if (!guiPreviewLauncherAvailable() && elements.guiPreviewLauncher.hidden) {
    return;
  }

  if (guiPreviewLauncherFrame) {
    return;
  }

  guiPreviewLauncherFrame = window.requestAnimationFrame(() => {
    guiPreviewLauncherFrame = 0;
    updateGuiPreviewLauncher();
  });
}

function updateGuiPreviewLauncher() {
  const available = guiPreviewLauncherAvailable();

  if (!available) {
    elements.guiPreviewLauncher.hidden = true;
    elements.guiPreviewLauncher.setAttribute("aria-expanded", state.guiPreviewExpanded ? "true" : "false");
    return;
  }

  const previewBottom = elements.guiPreviewGrid.getBoundingClientRect().bottom;
  const scrollTop = Math.max(0, elements.scroll.getBoundingClientRect().top);
  const headerBottom = state.guiPreviewExpanded
    ? Number.NEGATIVE_INFINITY
    : elements.header.getBoundingClientRect().bottom;
  const slotStates = [...elements.guiPreviewGrid.querySelectorAll(".editor-inventory-slot")]
    .map((slot) => ({
      slot,
      behindHeader: slot.getBoundingClientRect().bottom <= headerBottom
    }));

  const scrolledPast = previewBottom < scrollTop;
  elements.guiPreviewLauncher.hidden = !scrolledPast || state.guiPreviewExpanded;
  elements.guiPreviewLauncher.setAttribute("aria-expanded", state.guiPreviewExpanded ? "true" : "false");

  for (const { slot, behindHeader } of slotStates) {
    if (slot.classList.contains("is-behind-editor-header") !== behindHeader) {
      slot.classList.toggle("is-behind-editor-header", behindHeader);
    }
  }
}

function guiPreviewLauncherAvailable() {
  return state.schema?.id === "guis/schema"
    && state.editorMode === "visual"
    && !elements.guiPreview.hidden;
}

function setGuiPreviewExpanded(expanded, { restoreFocus = true } = {}) {
  if (expanded && (state.schema?.id !== "guis/schema" || state.editorMode !== "visual")) {
    return;
  }

  state.guiPreviewExpanded = expanded;
  elements.guiPreview.classList.toggle("is-expanded", expanded);
  elements.guiPreviewBackdrop.hidden = !expanded;
  elements.guiPreviewLauncher.setAttribute("aria-expanded", expanded ? "true" : "false");

  if (expanded) {
    elements.guiPreview.setAttribute("role", "dialog");
    elements.guiPreview.setAttribute("aria-modal", "true");
    elements.guiPreview.setAttribute("aria-label", "Expanded inventory preview");
  } else {
    elements.guiPreview.removeAttribute("role");
    elements.guiPreview.removeAttribute("aria-modal");
    elements.guiPreview.removeAttribute("aria-label");
  }

  if (expanded) {
    elements.guiPreviewLauncher.hidden = true;
    elements.guiPreviewClose.focus();
  } else {
    updateGuiPreviewLauncher();

    if (restoreFocus && !elements.guiPreviewLauncher.hidden) {
      elements.guiPreviewLauncher.focus();
    }
  }
}

async function addOutpostPage() {
  const current = outpostPageDetails(state.session?.fileName);

  if (!current) {
    return;
  }

  try {
    const pages = matchingOutpostPages(current);
    const nextPage = Math.max(0, ...pages.map(({ details }) => details.page)) + 1;
    const extension = state.session.fileName.match(/\.yaml$/i) ? ".yaml" : ".yml";
    const path = `${current.directory}/${nextPage}${extension}`;
    const newline = state.session.document.lineEndings === "crlf"
      ? "\r\n"
      : state.session.document.lineEndings === "cr" ? "\r" : "\n";
    const source = [
      "(import):",
      "  outpost-page:",
      "    anchors: [ &base base ]",
      "",
      "options: { }",
      ""
    ].join(newline);

    createWorkspaceFile(state.workspace, path, source);
    await activateWorkspaceFile(path);
    announce(`Created outpost page ${nextPage}. Add stock buttons from its Options section.`, false, "Outpost page created");
  } catch (error) {
    announce(error.message, true);
  }
}

async function deleteOutpostPage() {
  const current = outpostPageDetails(state.session?.fileName);

  if (!current) {
    return;
  }

  const pages = matchingOutpostPages(current);

  if (pages.length <= 1) {
    announce("An outpost needs at least one page.", true);
    return;
  }

  if (!window.confirm(`Delete outpost page ${current.page}? Stock buttons on this page will be removed from the downloaded config.`)) {
    return;
  }

  try {
    removeWorkspaceFile(state.workspace, state.session.fileName);
    const remaining = matchingOutpostPages(current);
    let renumbered = false;
    remaining.forEach(({ session, details }, index) => {
      const page = index + 1;

      if (details.page === page) {
        return;
      }

      const extension = session.fileName.match(/\.yaml$/i) ? ".yaml" : ".yml";
      renameWorkspaceFile(state.workspace, session.fileName, `${current.directory}/${page}${extension}`);
      renumbered = true;
    });

    const nextPage = Math.min(current.page, remaining.length);
    const next = matchingOutpostPages(current).find(({ details }) => details.page === nextPage)?.session;
    await activateWorkspaceFile(next?.fileName ?? state.workspace.activePath);
    announce(`Deleted outpost page ${current.page}.${renumbered ? " Later pages were renumbered to keep the sequence continuous." : ""}`, false, "Outpost page deleted");
  } catch (error) {
    announce(error.message, true);
  }
}

function matchingOutpostPages(page) {
  return state.workspace.files
    .map((session) => ({ session, details: outpostPageDetails(session.fileName) }))
    .filter(({ details }) => details?.directory.toLocaleLowerCase("en-US") === page.directory.toLocaleLowerCase("en-US"))
    .sort((left, right) => left.details.page - right.details.page);
}

function outpostPageDetails(fileName) {
  const normalized = String(fileName ?? "").replaceAll("\\", "/");
  const match = /^(.*\/guis\/[^/]+\/structures\/outpost)\/([1-9]\d*)\.ya?ml$/i.exec(`/${normalized}`);

  if (!match) {
    return null;
  }

  return {
    directory: match[1].replace(/^\//, ""),
    page: Number(match[2])
  };
}

function renderGuiUnplaced(preview) {
  const query = state.guiUnplacedQuery.trim().toLocaleLowerCase("en-US");
  elements.guiPreviewUnplacedSearch.value = state.guiUnplacedQuery;
  const options = preview.unplaced.filter((option) => !query || [
    option.key,
    option.label,
    option.material,
    option.name,
    option.lore,
    ...option.states.flatMap((item) => [item.label, item.material, item.name, item.lore])
  ].join(" ").toLocaleLowerCase("en-US").includes(query));
  elements.guiPreviewUnplacedList.replaceChildren(...options.map(guiUnplacedOption));

  if (query && !options.length) {
    elements.guiPreviewUnplacedList.append(element("p", "editor-form-empty mb-0", "No other or unplaced buttons match this filter."));
  }

  elements.guiPreviewUnplaced.hidden = preview.unplaced.length === 0;
  updateGuiUnplacedCollapse();
}

function guiUnplacedOption(option) {
  const card = element("article", "editor-gui-unplaced editor-surface-card rounded-3 p-3");
  const heading = element("div", "d-flex align-items-center justify-content-between gap-3");
  const edit = element("button", "editor-icon-button editor-interactive-surface d-inline-grid flex-shrink-0");
  edit.type = "button";
  edit.setAttribute("aria-label", `Edit ${option.label}`);
  edit.append(element("i", "fa-solid fa-pen"));
  edit.addEventListener("click", () => openGuiOption(option));
  heading.append(element("strong", "d-block text-light", option.label), edit);
  card.append(heading);

  if (option.states.length) {
    card.append(guiAppearanceGrid(option, { singleColumn: true }));
  } else {
    const appearance = guiAppearanceButton(option, option, { direct: true });
    const preview = element("div", "mt-2");
    preview.append(appearance);
    card.append(preview);
  }

  return card;
}

function updateGuiUnplacedCollapse() {
  const collapsed = state.guiUnplacedCollapsed;
  elements.guiPreviewUnplacedList.hidden = collapsed;
  elements.guiPreviewUnplacedSearch.hidden = collapsed;
  elements.guiPreviewUnplacedToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  elements.guiPreviewUnplacedToggle.setAttribute(
    "aria-label",
    collapsed ? "Expand other and unplaced buttons" : "Collapse other and unplaced buttons"
  );
  elements.guiPreviewUnplacedToggleIcon.className = collapsed
    ? "fa-solid fa-chevron-down"
    : "fa-solid fa-chevron-up";
  elements.guiPreviewUnplacedToggleLabel.textContent = collapsed ? "Expand" : "Collapse";
}

function renderGuiStates(preview) {
  const options = preview.options.filter((option) => option.states.length && option.slots.length);
  elements.guiPreviewStates.hidden = options.length === 0;
  elements.guiPreviewStatesList.replaceChildren(...options.map((option) => {
    const card = element("article", "editor-gui-condition-card editor-surface-card min-w-0 rounded-3 p-3");
    const cardKey = `${state.session.fileName}\u0000${option.path.join("\u0000")}`;
    const collapsed = state.collapsedGuiStateCards.has(cardKey);
    const title = element("div", "d-flex align-items-center justify-content-between gap-3");
    const toggle = element("button", "editor-icon-button editor-interactive-surface d-inline-grid flex-shrink-0");
    const toggleIcon = element("i", collapsed ? "fa-solid fa-chevron-down" : "fa-solid fa-chevron-up");
    const statesId = `editor-gui-condition-card-${++labeledControlId}`;
    toggle.type = "button";
    toggle.setAttribute("aria-controls", statesId);
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    toggle.setAttribute(
      "aria-label",
      `${collapsed ? "Expand" : "Collapse"} ${option.label} conditional appearances`
    );
    toggle.append(toggleIcon);
    title.append(element("strong", "d-block", option.label), toggle);
    card.append(title);
    const states = guiAppearanceGrid(option);
    states.id = statesId;
    states.hidden = collapsed;
    toggle.addEventListener("click", () => {
      const nextCollapsed = !state.collapsedGuiStateCards.has(cardKey);

      if (nextCollapsed) {
        state.collapsedGuiStateCards.add(cardKey);
      } else {
        state.collapsedGuiStateCards.delete(cardKey);
      }

      states.hidden = nextCollapsed;
      toggle.setAttribute("aria-expanded", nextCollapsed ? "false" : "true");
      toggle.setAttribute(
        "aria-label",
        `${nextCollapsed ? "Expand" : "Collapse"} ${option.label} conditional appearances`
      );
      toggleIcon.className = nextCollapsed
        ? "fa-solid fa-chevron-down"
        : "fa-solid fa-chevron-up";
    });
    card.append(states);
    return card;
  }));
  updateGuiStatesCollapse();
}

function guiAppearanceGrid(option, { singleColumn = false } = {}) {
  const classes = singleColumn
    ? "row row-cols-1 g-2 mt-0"
    : "row row-cols-1 row-cols-md-2 g-2 mt-0";
  const grid = element("div", classes);

  for (const appearance of option.states) {
    const column = element("div", "col");
    column.append(guiAppearanceButton(option, appearance));
    grid.append(column);
  }

  return grid;
}

function guiAppearanceButton(option, appearance, { direct = false } = {}) {
  const button = element("button", "editor-gui-item-action editor-interactive-surface w-100 h-100 text-start rounded-3 p-3");
  button.type = "button";
  const material = appearance.previewMaterial
    || appearance.material
    || option.previewMaterial
    || option.material
    || "Unspecified";

  if (!direct) {
    button.append(element(
      "span",
      "editor-condition-label d-block fw-bold",
      `${appearance.conditionLabel}:`
    ));
  }

  const item = materialIconElement(material, {
    className: "editor-gui-item-icon flex-shrink-0",
    skull: appearance.previewSkull || appearance.skull || option.previewSkull || option.skull,
    components: appearance.components
  });
  const tooltip = guiItemTooltip(appearance);
  tooltip.classList.add("editor-gui-item-tooltip", "mw-100");
  const itemPreview = element(
    "span",
    `editor-gui-item d-flex flex-column flex-sm-row align-items-start gap-3 min-w-0${direct ? "" : " mt-2"}`
  );
  itemPreview.append(item, tooltip);
  button.append(itemPreview);

  if (direct) {
    button.setAttribute("aria-label", `Edit ${option.label}. ${material}`);
    button.addEventListener("click", () => openGuiOption(option));
    return button;
  }

  const action = appearance.inherited
    ? `Customize this inherited appearance from ${appearance.origin}`
    : appearance.generated
      ? `Customize this shared appearance from ${appearance.generatedBy}`
      : `Edit ${appearance.label}`;
  button.setAttribute("aria-label", `${action}. ${appearance.conditionLabel}. ${material}`);
  button.addEventListener("click", () => appearance.inherited || appearance.generated
    ? materializeEffectiveEntry(appearance.path, `${option.label} · ${appearance.label}`)
    : navigateToOption(appearance.path));
  return button;
}

function updateGuiStatesCollapse() {
  const collapsed = state.guiStatesCollapsed;
  elements.guiPreviewStatesList.hidden = collapsed;
  elements.guiPreviewStatesToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  elements.guiPreviewStatesToggle.setAttribute(
    "aria-label",
    collapsed ? "Expand all conditional appearances" : "Collapse all conditional appearances"
  );
  elements.guiPreviewStatesToggleIcon.className = collapsed
    ? "fa-solid fa-chevron-down"
    : "fa-solid fa-chevron-up";
  elements.guiPreviewStatesToggleLabel.textContent = collapsed ? "Expand all" : "Collapse all";
}

function guiSlot(slot, preview, geometry, layout) {
  const button = element("button", "editor-inventory-slot position-absolute");
  button.type = "button";
  button.dataset.slot = String(slot.slot);
  const selected = state.guiSelectedSlot === slot.slot;
  button.classList.toggle("is-selected", selected);
  button.setAttribute("aria-pressed", selected ? "true" : "false");
  positionGuiSlot(button, geometry, layout);
  button.append(element("span", "editor-inventory-number position-absolute", String(slot.slot)));

  if (!slot.options.length) {
    button.setAttribute("aria-label", `Empty inventory slot ${slot.slot}. Add a button.`);
    button.addEventListener("click", () => openGuiSlotPane(slot.slot));
    configureGuiDropTarget(button, slot, preview);
    return button;
  }

  const option = slot.options.at(-1);
  const displayName = previewGuiText(option.previewName || option.name, state.messageMacros)
    || option.displayName
    || plainGuiText(option.previewName || option.name)
    || option.label;
  button.classList.add("has-button");
  button.classList.toggle("is-inherited", option.inherited);
  button.classList.toggle("has-collision", slot.options.length > 1);
  const description = slot.options.length > 1
    ? `Slot ${slot.slot}: ${slot.options.map((candidate) => candidate.label).join(", ")}`
    : option.inherited
      ? `${option.label} · ${guiMaterialDescription(option)} · inherited from ${option.origin}`
      : `${option.label} · ${guiMaterialDescription(option)} · ${displayName}`;
  button.setAttribute("aria-label", description);
  const tooltip = guiItemTooltip(option);
  tooltip.id = `editor-gui-tooltip-${slot.slot}`;
  button.setAttribute("aria-describedby", tooltip.id);
  button.append(tooltip);

  if (!option.previewMaterial && option.stateMaterials.length) {
    button.append(conditionalMaterialPreview(option));
  }

  if (option.states.length) {
    const appearancePreview = element(
      "span",
      "editor-material-icon editor-inventory-condition-preview overflow-hidden"
    );
    const count = element("span", "editor-pill fw-bold text-nowrap editor-inventory-state-count position-absolute d-inline-flex align-items-center text-center", String(option.states.length));
    count.setAttribute("aria-label", pluralize(option.states.length, "conditional appearance"));
    button.append(appearancePreview, count);
    configureConditionalAppearancePreview(button, option, tooltip, appearancePreview, count);
  }

  if (option.inherited) {
    const inherited = element("span", "editor-inventory-inherited position-absolute");
    inherited.setAttribute("aria-label", "Inherited from shared template");
    inherited.append(element("i", "fa-solid fa-link"));
    button.append(inherited);
  }

  button.addEventListener("click", () => openGuiSlotPane(slot.slot));

  const movable = !option.switchShared
    && !option.inherited
    && slot.options.length === 1
    && ["slot", "coordinates"].includes(option.position?.kind);
  button.draggable = movable;

  if (movable) {
    button.addEventListener("dragstart", (event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", option.path.join("\u0000"));
      button.classList.add("is-dragging");
    });
    button.addEventListener("dragend", () => button.classList.remove("is-dragging"));
  }

  configureGuiDropTarget(button, slot, preview);
  return button;
}

function openGuiSlotPane(slot) {
  state.guiSelectedSlot = slot;
  renderGuiSlotPane(state.guiPreview);
  updateGuiSlotSelection();
  window.requestAnimationFrame(() => elements.guiSlotPane.focus?.());
}

function updateGuiSlotSelection() {
  elements.guiPreviewGrid.querySelectorAll("[data-slot]").forEach((button) => {
    const selected = Number(button.dataset.slot) === state.guiSelectedSlot;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
}

function configureConditionalAppearancePreview(button, option, tooltip, icon, count) {
  let pointerInside = false;
  let focused = false;
  let activeIndex = 0;
  let switchTimer = 0;

  const stopTimer = () => {
    window.clearTimeout(switchTimer);
    switchTimer = 0;
  };
  const renderAppearance = () => {
    const appearance = option.states[activeIndex];
    updateMaterialIcon(icon, appearance.material || option.previewMaterial || option.material, {
      skull: appearance.skull || option.previewSkull || option.skull,
      components: appearance.components
    });
    count.textContent = `${activeIndex + 1}/${option.states.length}`;
    count.setAttribute(
      "aria-label",
      `${appearance.conditionLabel}, appearance ${activeIndex + 1} of ${option.states.length}`
    );
    renderGuiItemTooltip(tooltip, appearance, {
      position: activeIndex + 1,
      total: option.states.length
    });
  };
  const scheduleSwitch = () => {
    stopTimer();

    if (option.states.length < 2) {
      return;
    }

    switchTimer = window.setTimeout(() => {
      if (!button.isConnected || (!pointerInside && !focused)) {
        stopTimer();
        return;
      }

      activeIndex = (activeIndex + 1) % option.states.length;
      renderAppearance();
      scheduleSwitch();
    }, GUI_CONDITION_PREVIEW_INTERVAL);
  };
  const start = () => {
    if (button.classList.contains("is-previewing-conditions")) {
      return;
    }

    activeIndex = 0;
    button.classList.add("is-previewing-conditions");
    renderAppearance();
    scheduleSwitch();
  };
  const stop = () => {
    if (pointerInside || focused) {
      return;
    }

    stopTimer();
    button.classList.remove("is-previewing-conditions");
    clearMaterialIcon(icon);
    count.textContent = String(option.states.length);
    count.setAttribute("aria-label", pluralize(option.states.length, "conditional appearance"));
    renderGuiItemTooltip(tooltip, option);
  };

  button.addEventListener("mouseenter", () => {
    pointerInside = true;
    start();
  });
  button.addEventListener("mouseleave", () => {
    pointerInside = false;
    stop();
  });
  button.addEventListener("focus", () => {
    focused = true;
    start();
  });
  button.addEventListener("blur", () => {
    focused = false;
    stop();
  });
}

function conditionalMaterialPreview(option) {
  const materials = option.stateMaterials.slice(0, 4);
  const preview = element("span", "editor-inventory-conditional-materials position-absolute");
  preview.dataset.count = String(materials.length);

  for (const material of materials) {
    const appearance = option.states.find((state) => state.material === material);
    preview.append(materialIconElement(material, {
      className: "editor-inventory-conditional-material",
      skull: appearance?.skull || "",
      components: appearance?.components
    }));
  }

  return preview;
}

function guiMaterialDescription(option) {
  if (option.previewMaterial) {
    return option.previewMaterial;
  }

  if (option.material && option.material !== "Unspecified") {
    return option.material;
  }

  if (option.stateMaterials?.length) {
    return pluralize(option.stateMaterials.length, "conditional material");
  }

  return "no material";
}

function positionGuiSlot(button, geometry, layout) {
  if (!geometry) {
    button.hidden = true;
    return;
  }

  button.style.left = `${geometry.x / layout.width * 100}%`;
  button.style.top = `${geometry.y / layout.height * 100}%`;
  button.style.width = `${geometry.width / layout.width * 100}%`;
  button.style.height = `${geometry.height / layout.height * 100}%`;
}

function openGuiOption(option) {
  if (!option.inherited && !option.generated) {
    navigateToOption(option.path);
    return;
  }

  materializeEffectiveEntry(option.path, option.label);
}

function materializeEffectiveEntry(optionPath, label) {
  const entry = state.effectiveIndex?.byPath.get(pathKey(optionPath));

  if (!canMaterializeEffectiveEntry(entry)) {
    const generatedCall = entry?.generatedCallPath
      && state.session.document.index.byPath.get(pathKey(entry.generatedCallPath));

    if (generatedCall) {
      navigateToOption(generatedCall.path);
      announce(`${label} uses shared values from “${entry.generatedBy}”. Edit its input values here, or make the reused values independent first.`, true, "Shared value unavailable");
      return;
    }

    const parent = state.workspace.files.find((session) => session.fileName === entry?.origin);

    if (parent) {
      openWorkspaceFile(parent.fileName);
      announce(`Opened the shared template that defines ${label}.`, false, "Config opened");
    } else {
      announce(`Open ${entry?.origin || "the shared template"} with this file to customize these shared settings safely.`, true);
    }

    return;
  }

  const source = entry.generated ? `the generated “${entry.generatedBy}” settings` : "a shared template";

  if (!window.confirm(`Customize ${label} here? Its effective settings from ${source} will be copied into this file as an override.`)) {
    return;
  }

  try {
    insertDocumentValue(state.session.document, optionPath, entry.source);
    state.session.exported = false;
    refreshAfterMutation(optionPath, { reveal: true });
    announce(`Created a local override for ${label}. You can now edit it without changing ${source}.`, false, "Local override created");
  } catch (error) {
    announce(error.message, true);
  }
}

function configureGuiDropTarget(element, slot, preview) {
  element.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    element.classList.add("is-drop-target");
  });
  element.addEventListener("dragleave", () => element.classList.remove("is-drop-target"));
  element.addEventListener("drop", (event) => {
    event.preventDefault();
    element.classList.remove("is-drop-target");
    const path = event.dataTransfer.getData("text/plain").split("\u0000").filter(Boolean);
    const option = preview.options.find((candidate) => samePath(candidate.path, path));

    if (option) {
      moveGuiOption(option, slot.slot, preview);
    }
  });
}

function moveGuiOption(option, nextSlot, preview) {
  if (!["slot", "coordinates"].includes(option.position?.kind)) {
    return;
  }

  const occupied = preview.slots[nextSlot]?.options.some((candidate) => !samePath(candidate.path, option.path));

  if (occupied) {
    announce(`Slot ${nextSlot} is already occupied. Move or edit that button first.`, true, "Slot unavailable");
    return;
  }

  if (option.slots.includes(nextSlot)) {
    return;
  }

  try {
    if (option.position.kind === "slot") {
      replaceDocumentValue(state.session.document, option.position.path, String(nextSlot));
    } else {
      const nextX = nextSlot % preview.columns + 1;
      const nextY = Math.floor(nextSlot / preview.columns) + 1;
      replaceDocumentValue(state.session.document, option.position.xPath, String(nextX));
      replaceDocumentValue(state.session.document, option.position.yPath, String(nextY));
    }

    state.session.exported = false;
    refreshAfterMutation(option.path);
    announce(`Moved ${option.label} to slot ${nextSlot}.`, false, "Setting moved");
  } catch (error) {
    announce(error.message, true);
  }
}

function guiItemTooltip(option) {
  const tooltip = element("span", "editor-minecraft-tooltip");
  tooltip.role = "tooltip";
  renderGuiItemTooltip(tooltip, option);
  return tooltip;
}

function guiItemNameTooltip(appearance, fallback) {
  const tooltip = element("span", "editor-minecraft-tooltip editor-gui-item-tooltip mw-100");
  tooltip.role = "tooltip";
  const name = previewGuiMessage(
    appearance.previewName ?? appearance.name ?? fallback.previewName ?? fallback.name,
    state.messageMacros
  );
  tooltip.append(messagePreviewElement(name, {
    compact: true,
    macros: state.messageMacros,
    showHeading: false
  }));
  return tooltip;
}

function renderGuiItemTooltip(tooltip, appearance, cycle = null) {
  const contents = [];

  if (cycle) {
    const header = element("span", "editor-condition-label d-grid gap-1");
    const label = element("span", "d-flex align-items-center justify-content-between gap-3");
    label.append(
      element("span", "", `${appearance.conditionLabel}:`),
      element("span", "editor-minecraft-tooltip-position flex-shrink-0", `${cycle.position}/${cycle.total}`)
    );
    header.append(label);
    if (cycle.total > 1) {
      const progress = element("span", "editor-minecraft-tooltip-progress d-block overflow-hidden");
      progress.style.setProperty(
        "--editor-condition-preview-duration",
        `${GUI_CONDITION_PREVIEW_INTERVAL}ms`
      );
      header.append(progress);
    }

    contents.push(header);
  }

  contents.push(messagePreviewElement(guiTooltipMessage(appearance, state.messageMacros), {
    compact: true,
    macros: state.messageMacros,
    showHeading: false
  }));
  tooltip.replaceChildren(...contents);
}

function updateView({ query = state.query, mode = state.viewMode, focusSearch = false }) {
  state.query = query;
  state.viewMode = String(query).trim() ? "all" : mode;

  const firstMatch = state.query
    ? firstMatchingFieldPath(state.sections, {
      query: state.query,
      mode: state.viewMode,
      changed: optionChanged
    })
    : null;

  if (firstMatch) {
    expandOptionPath(firstMatch);
    const sectionKey = sectionKeyForPath(firstMatch, state.sections);

    if (sectionKey) {
      state.activeSection = sectionKey;
    }
  }

  ensureVisibleSection();
  renderViewControls();
  renderSections();
  renderActiveSection();

  if (state.query) {
    if (firstMatch) {
      revealOption(firstMatch, { highlight: true });
    } else {
      scrollEditorToSection();
    }
  } else {
    scrollEditorToSection();
  }

  if (focusSearch) {
    elements.search.focus();
  }
}

function renderViewControls() {
  elements.search.value = state.query;
  elements.clearSearch.hidden = !state.query;
  elements.viewModes.forEach((button) => {
    const active = button.dataset.viewMode === state.viewMode;
    button.setAttribute("aria-pressed", String(active));
  });

  const visible = visibleSections();
  const count = visible.reduce((total, section) => total + section.visibleFieldCount, 0);
  const total = state.sections.reduce((sum, section) => sum + section.fieldCount, 0);
  elements.viewResults.textContent = state.query || state.viewMode !== "all"
    ? `${count.toLocaleString()} of ${total.toLocaleString()} settings`
    : `${total.toLocaleString()} settings`;
}

function visibleSections() {
  return filterSections(state.sections, {
    query: state.query,
    mode: state.viewMode,
    changed: optionChanged
  });
}

function ensureVisibleSection() {
  const sections = visibleSections();

  if (!sections.some((section) => section.key === state.activeSection)) {
    state.activeSection = sections[0]?.key ?? "";
  }
}

function optionChanged(optionPath) {
  return state.session.document.changes.has(pathKey(optionPath))
    || documentAnchorChanged(state.session.document, optionPath)
    || documentAnnotationChanged(state.session.document, optionPath);
}

function collapseVisibleGroups() {
  const section = visibleSections().find((candidate) => candidate.key === state.activeSection);

  if (!section) {
    return;
  }

  for (const group of section.groups) {
    collectGroupPaths(group, state.collapsedGroups);
  }

  renderActiveSection();
}

function collectGroupPaths(group, target) {
  target.add(pathKey(group.path));
  group.groups.forEach((child) => collectGroupPaths(child, target));
}

function renderWarnings() {
  const relationshipWarnings = state.templatePresentation.relationships.warnings;
  const warnings = [
    ...state.session.document.warnings,
    ...relationshipWarnings,
    ...semanticWarnings({
      index: state.session.document.index,
      schemaId: state.schema?.id,
      sections: state.sections
    }),
    ...undefinedMessageMacroWarnings(state.session.document.index, state.messageMacros)
  ];
  elements.warnings.replaceChildren();
  elements.warnings.hidden = warnings.length === 0;

  for (const warning of warnings) {
    const item = element("div", "editor-warning d-flex align-items-start gap-2");
    item.append(element("i", "fa-solid fa-triangle-exclamation"), document.createTextNode(warning));
    elements.warnings.append(item);
  }
}

function renderSections() {
  elements.sectionList.replaceChildren();
  const sections = visibleSections();

  if (!sections.length) {
    elements.sectionList.append(element("p", "editor-sections-empty px-2 py-3 mb-0", "No sections match this view."));
    return;
  }

  for (const section of sections) {
    const button = element("button", "editor-section editor-interactive-surface w-100 mw-100 min-w-0 overflow-hidden text-start d-flex align-items-center justify-content-between gap-2 align-self-stretch");
    button.type = "button";
    button.dataset.editorSectionKey = section.key;
    const active = section.key === state.activeSection;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-current", active ? "true" : "false");
    button.append(element("span", "editor-section-label flex-grow-1 min-w-0 text-truncate", section.label));

    const badges = element("span", "d-inline-flex align-items-center flex-shrink-0 gap-1");
    const settingCount = element(
      "span",
      "editor-pill fw-bold text-nowrap editor-sidebar-badge editor-section-count d-inline-flex align-items-center justify-content-center overflow-hidden text-center",
      String(section.visibleFieldCount)
    );
    settingCount.title = pluralize(section.visibleFieldCount, "setting");
    const changeCount = sectionChangeCount(section);

    if (changeCount) {
      badges.append(sidebarChangeBadge(changeCount, `${pluralize(changeCount, "change")} in ${section.label}`));
    }

    badges.append(settingCount);
    button.append(badges);

    button.addEventListener("click", async () => {
      const focusNavigation = document.activeElement === button;
      const mobileNavigation = !desktopSidebarQuery.matches;
      const selected = await selectEditorSection(section.key, {
        focusSidebar: focusNavigation && !mobileNavigation,
        focusContent: focusNavigation && mobileNavigation
      });

      if (mobileNavigation && (selected || state.activeSection === section.key)) {
        setEditorNavigationDrawerOpen(false, { restoreFocus: false });
      }
    });
    elements.sectionList.append(button);
  }
}

function selectEditorSection(sectionKey, detail = {}) {
  return editorContentNavigation.selectSection(sectionKey, detail).catch((error) => {
    announce(error.message, true);
    return false;
  });
}

function commitSectionNavigation(sectionKey, {
  optionPath = [],
  resetView = false,
  focusSidebar = false,
  focusContent = false
} = {}) {
  if (resetView) {
    state.query = "";
    state.viewMode = "all";
    expandOptionPath(optionPath);
    renderViewControls();
  }

  state.activeSection = sectionKey;
  renderSections();
  renderActiveSection();

  if (optionPath.length) {
    revealOption(optionPath, { immediate: true });
  } else {
    scrollEditorToSection();
  }

  if (!focusSidebar && !focusContent) {
    return;
  }

  return () => {
    if (focusSidebar) {
      focusSectionButton(sectionKey);
    }

    if (focusContent) {
      focusSectionHeading();
    }
  };
}

function sectionChangeCount(section) {
  return [...state.session.document.changes.values()].filter((change) =>
    Array.isArray(change.path)
      && sectionKeyForPath(change.path, state.sections) === section.key
  ).length;
}

function sidebarChangeBadge(changeCount, label) {
  const badge = element("span", "editor-pill fw-bold text-nowrap editor-sidebar-badge editor-sidebar-badge--changes d-inline-flex align-items-center justify-content-center flex-shrink-0 gap-1 text-center");
  const icon = element("i", "fa-solid fa-pencil");
  icon.setAttribute("aria-hidden", "true");
  badge.title = label;
  badge.setAttribute("aria-label", label);
  badge.append(icon, document.createTextNode(String(changeCount)));
  return badge;
}

function addonPill(addon) {
  const pill = element("span", "editor-pill fw-bold text-nowrap editor-addon-pill flex-shrink-0 overflow-hidden", addon.label);
  pill.dataset.addon = addon.id;
  pill.title = `${addon.label} addon`;
  pill.setAttribute("aria-label", `${addon.label} addon`);
  return pill;
}

function renderActiveSection() {
  const section = visibleSections().find((candidate) => candidate.key === state.activeSection);
  elements.form.replaceChildren();
  elements.sectionActions.replaceChildren();

  if (!section) {
    elements.sectionTitle.textContent = "No matching settings";
    elements.sectionKey.hidden = true;
    elements.sectionKey.textContent = "";
    elements.sectionSummary.textContent = "Try another search or settings view.";
    elements.sectionDescription.hidden = true;
    elements.formEmpty.hidden = false;
    return;
  }

  const sectionDeclaration = state.templatePresentation?.declarations.get(pathKey(section.path ?? []));
  elements.sectionTitle.textContent = sectionDeclaration
    ? `Entry template: ${sectionDeclaration.name}`
    : samePath(section.path ?? [], ["(module)"])
      ? "Parent template contract"
      : samePath(section.path ?? [], ["(import)"])
        ? "Parent templates"
        : section.label;
  const showKey = state.viewMode === "advanced"
    && section.key !== GENERAL_SECTION
    && Boolean(section.key);
  elements.sectionKey.hidden = !showKey;
  elements.sectionKey.textContent = showKey ? displaySettingPath(section.path?.length ? section.path : [section.key]) : "";
  appendSemanticBadges(elements.sectionTitle, section);
  elements.sectionSummary.textContent = section.visibleGroupCount
    ? `${pluralize(section.visibleFieldCount, "setting")} in ${pluralize(section.visibleGroupCount, "group")}`
    : pluralize(section.visibleFieldCount, "setting");
  const sectionDescription = displayHelpText([
    section.comments.join(" "),
    section.typeDescription,
    inheritancePolicyText(section.annotations)
  ]
    .filter(Boolean)
    .filter((part, index, all) => all.indexOf(part) === index)
    .join(" "));
  elements.sectionDescription.replaceChildren();
  appendDescriptionText(elements.sectionDescription, sectionDescription);
  elements.sectionDescription.hidden = !sectionDescription;

  if (section.entry && section.removal?.allowed) {
    elements.sectionActions.append(dangerButton(`Remove ${section.label}`, () => removeOption(section.path)));
  }

  if (section.entry && optionChanged(section.path)) {
    elements.sectionActions.prepend(undoButton("Undo this change", () => undoOption(section.path)));
  }

  if (section.entry && state.session.document.index.byPath.has(pathKey(section.path))) {
    elements.sectionActions.append(headerIconButton(
      `Edit inheritance rules for ${section.label}`,
      "fa-solid fa-shield-halved",
      () => openAnnotationDialog(section.path, section.label)
    ));
  }

  const sectionOverview = templateOwnerOverview(section.path);

  if (sectionOverview) {
    elements.form.append(sectionOverview);
  }

  if (showStructureControls(section)) {
    const addPanel = structureAddPanel(section);

    if (addPanel) {
      elements.form.append(addPanel);
    }
  }

  const directDraft = renderDirectMappingDraft(section);

  if (directDraft) {
    elements.form.append(directDraft);
  }

  renderOwnerContent(section, elements.form, 1);
  const reusableSettings = reusableSettingsNotice(section);

  if (reusableSettings) {
    elements.form.append(reusableSettings);
  }

  elements.formEmpty.hidden = section.visibleFieldCount > 0
    || showStructureControls(section);
  stickyGroupHeaders.refresh();
  renderExpiredWorkspace();
}

function renderGroup(group, depth) {
  const wrapper = element("section", "editor-group position-relative");
  wrapper.style.setProperty("--editor-group-depth", String(depth));
  wrapper.dataset.optionPath = optionPathMarker(group.path);
  const groupKey = pathKey(group.path);
  const namedCall = state.templatePresentation?.namedCalls.get(groupKey);
  const declaration = state.templatePresentation?.declarations.get(groupKey);
  const importedTemplate = state.templatePresentation?.imports.get(groupKey);
  const groupLabel = group.label || labelForKey(String(group.path.at(-1) ?? ""));
  const groupHelp = [group.comments?.join(" "), group.typeDescription, inheritancePolicyText(group.annotations)]
    .filter(Boolean)
    .filter((part, index, all) => all.indexOf(part) === index);
  const collapsed = !state.query && state.collapsedGroups.has(groupKey);
  wrapper.classList.toggle("is-collapsed", collapsed);

  const sentinel = element("div", "editor-group-sticky-sentinel");
  sentinel.setAttribute("aria-hidden", "true");

  const header = element("div", "editor-group-header px-3");
  const headerRow = element("div", "editor-group-header-row d-flex align-items-center gap-2");
  const heading = element("div", "editor-group-heading min-w-0 flex-grow-1");
  const titleRow = element("div", "d-flex flex-wrap align-items-center gap-2 min-w-0");
  const title = element("h2", "editor-group-title editor-item-title mb-0 overflow-hidden fw-bold text-nowrap", namedCall
    ? `Generated settings from ${namedCall.name || "unresolved template"}`
    : declaration
      ? `Entry template: ${declaration.name}`
      : importedTemplate
        ? `Parent template: ${importedTemplate.name}`
        : groupLabel);
  titleRow.append(title);
  if (group.path.length && !namedCall) {
    titleRow.append(element("code", "editor-group-key d-block text-truncate", String(group.path.at(-1) ?? "")));
  }

  appendSemanticBadges(titleRow, group);
  heading.append(titleRow);
  headerRow.append(heading);

  const sticky = element("div", "editor-group-sticky");
  const stickyHeader = element("div", "editor-group-sticky-header editor-sticky-group-header px-3 d-flex align-items-center gap-2");
  const stickyHeading = element("div", "editor-group-heading min-w-0 flex-grow-1");
  const stickyTitleRow = element("div", "d-flex align-items-center gap-2 min-w-0");
  stickyTitleRow.append(element("span", "editor-group-title editor-item-title overflow-hidden fw-bold text-nowrap", title.textContent));
  const key = titleRow.querySelector(".editor-group-key");

  if (key) {
    stickyTitleRow.append(key.cloneNode(true));
  }

  const badges = titleRow.querySelector(".editor-semantic-badges");

  if (badges) {
    stickyTitleRow.append(badges.cloneNode(true));
  }

  stickyHeading.append(stickyTitleRow);
  const stickyActions = element("div", "editor-group-actions d-flex align-items-center flex-shrink-0");
  const pin = headerIconButton(
    `Jump to top of ${groupLabel}`,
    "fa-solid fa-arrow-up",
    () => stickyGroupHeaders.scrollToGroup(wrapper)
  );
  pin.classList.add("editor-group-pin", "flex-shrink-0");
  pin.tabIndex = -1;
  stickyActions.append(pin);
  stickyHeader.append(stickyHeading, stickyActions);
  sticky.append(stickyHeader);

  const actions = element("div", "editor-group-actions d-flex align-items-center gap-1 flex-shrink-0");

  if (optionChanged(group.path)) {
    actions.append(undoButton("Undo this change", () => undoOption(group.path)));
  }

  if (state.session.document.index.byPath.has(groupKey)) {
    actions.append(headerIconButton(
      `Edit inheritance rules for ${groupLabel}`,
      "fa-solid fa-shield-halved",
      () => openAnnotationDialog(group.path, groupLabel)
    ));
  }

  if (group.removal?.allowed) {
    actions.append(dangerButton(`Remove ${group.label}`, () => removeOption(group.path), true));
  }

  const toggle = headerIconButton(
    collapsed ? `Expand ${group.label}` : `Collapse ${group.label}`,
    "fa-solid fa-chevron-down",
    () => {
      if (state.collapsedGroups.has(groupKey)) {
        state.collapsedGroups.delete(groupKey);
      } else {
        state.collapsedGroups.add(groupKey);
      }

      renderActiveSection();
    }
  );
  toggle.classList.add("editor-group-toggle");
  actions.append(toggle);
  headerRow.append(actions);
  header.append(headerRow);

  const help = groupHelp.length ? element("p", "editor-group-help mb-0 mt-1") : null;

  if (help) {
    appendDescriptionText(help, displayHelpText(groupHelp.join(" ")));
  }

  if (help) {
    header.append(help);
  }

  const meta = element("div", "editor-group-meta");
  const metaCopy = element("div", "min-w-0");

  if (group.keyEditable) {
    metaCopy.append(createMappingKeyControl({
      path: group.path,
      keyType: group.renameKeyType,
      value: group.path.at(-1),
      onRename: renameOption
    }));
  }

  if (metaCopy.childElementCount) {
    meta.append(metaCopy);
  } else {
    meta.hidden = true;
  }

  const content = element("div", "editor-group-content d-grid gap-3");
  content.hidden = collapsed;
  const overview = templateOwnerOverview(group.path);

  if (overview) {
    content.append(overview);
  }

  if (showStructureControls(group)) {
    const addPanel = structureAddPanel(group);

    if (addPanel) {
      content.append(addPanel);
    }
  }

  const directDraft = renderDirectMappingDraft(group);

  if (directDraft) {
    content.append(directDraft);
  }

  renderOwnerContent(group, content, depth + 1);
  wrapper.append(sentinel, sticky, header, meta, content);
  return reusableSettingsNotice(group, wrapper) ?? wrapper;
}

function renderOwnerContent(owner, container, groupDepth) {
  const fields = fieldsForOwner(owner);
  const projected = { ...owner, fields };

  for (const item of orderedOwnerContent(projected)) {
    if (item.kind === "group") {
      container.append(renderGroup(item.value, groupDepth));
      continue;
    }

    const index = fields.indexOf(item.value);
    container.append(renderField(item.value, index, fields, owner));
  }
}

function renderField(field, index, fields, owner) {
  const conditionalOutputs = isConditionalOutputGroup(owner);
  const changed = optionChanged(field.path);
  const previous = fields[index - 1];
  const next = fields[index + 1];
  const fallback = field.entry.key === "else";
  const profileDefault = defaultOptionForFile(state.schema, field.path);
  const defaultOption = defaultOptionForDisplay(state.schema, field.path);

  return renderOptionField({
    field: fieldForRendering(field),
    schemaId: state.schema?.id ?? "",
    changed,
    editable: state.session.document.editable,
    onChange: updateOption,
    onUndo: undoOption,
    onResetDefault: resetOptionToDefault,
    onRemove: removeOption,
    onRename: renameOption,
    onMoveUp: conditionalOutputs && previous && !fallback
      ? () => moveOption(field.path, -1)
      : null,
    onMoveDown: conditionalOutputs && next && (fallback || next.entry.key !== "else")
      ? () => moveOption(field.path, 1)
      : null,
    onRevealAnchor: revealAnchorDefinition,
    onResolveAnchor: resolveAnchorSource,
    onRenameAnchor: renameAnchorDefinition,
    onRemoveAnchor: removeAnchorDefinition,
    onDetachAnchor: detachAnchorReference,
    onDetachListAnchor: detachListAnchorReference,
    onRemoveListAnchor: removeListAnchorDefinition,
    onRevealListAnchor: revealListAnchorDefinition,
    onResolveListAnchor: resolveListAnchorSource,
    onListAnchorNames: compatibleSequenceNames,
    onCreateAnchor: openAnchorDialog,
    onUseAnchor: openUseSavedDialog,
    onAddMessageEffect: addMessageEffect,
    onEditAnnotations: openAnnotationDialog,
    onNavigateTemplate: navigateTemplateTarget,
    templateContext: state.templatePresentation?.contextForEntry(field.entry) ?? null,
    templateDefinitions: state.templatePresentation?.definitions ?? [],
    anchorNames: reusableSettingsNamesBefore(field.entry),
    defaultOption,
    defaultSource: profileDefault?.source ?? "",
    originalSource: state.session.document.originalIndex?.byPath.get(pathKey(field.path))?.source ?? "",
    availableGuiSlots: field.entry.key === "slot" ? availableGuiSlots(state.guiPreview) : [],
    messageTokens: state.messageTokens,
    messageMacros: state.messageMacros
  });
}

function fieldForRendering(field) {
  let rendered = fieldWithGuiPositionBounds(field);

  if (field.entry.key === "lore") {
    rendered = {
      ...rendered,
      entry: {
        ...rendered.entry,
        lorePreview: lorePreviewText(
          rendered.entry,
          state.effectiveIndex ?? state.session.document.index
        )
      }
    };
  }

  if (rendered.path.join("\0") === ["masswar", "disable-misc-upgrades"].join("\0")) {
    rendered = {
      ...rendered,
      type: {
        ...rendered.type,
        kind: "set",
        elements: {
          kind: "enum",
          typeName: "MiscUpgrade",
          values: miscUpgradeIds(state.workspace, state.defaultMiscUpgradeOptions),
          description: "Misc upgrade defined in misc-upgrades.yml."
        }
      }
    };
  }

  return rendered;
}

function fieldWithGuiPositionBounds(field) {
  if (state.schema?.id !== "guis/schema") {
    return field;
  }

  const bounds = guiPositionBounds(state.guiPreview?.type, field.entry.key);

  if (!bounds) {
    return field;
  }

  return {
    ...field,
    type: numberTypeWithBounds(field.type, bounds)
  };
}

function numberTypeWithBounds(type, bounds) {
  if (type?.kind === "nullable") {
    return { ...type, value: numberTypeWithBounds(type.value, bounds) };
  }

  if (type?.kind === "reference") {
    return { ...type, target: numberTypeWithBounds(type.target, bounds) };
  }

  if (type?.kind === "list" || type?.kind === "set") {
    return { ...type, elements: numberTypeWithBounds(type.elements, bounds) };
  }

  if (type?.kind === "union") {
    return {
      ...type,
      choices: type.choices.map((choice) => numberTypeWithBounds(choice, bounds))
    };
  }

  return type?.kind === "integer" ? { ...type, ...bounds } : type;
}

function fieldsForOwner(owner) {
  const namedCall = state.templatePresentation?.namedCalls.get(pathKey(owner.path ?? []));

  return (owner.fields ?? [])
    .filter((field) => !namedCall || field.entry.key !== "[fn]")
    .map((field) => {
      if (!namedCall) {
        return field;
      }

      const parameter = namedCall.definition?.parameters.includes(field.entry.key);

      return parameter
        ? {
          ...field,
          presentationLabel: field.entry.key
            .replace(/^<|>$/g, "")
            .replaceAll(/[-_]+/g, " ")
            .replace(/\b\w/g, (letter) => letter.toUpperCase())
        }
        : field;
    });
}

function templateOwnerOverview(ownerPath = []) {
  const presentation = state.templatePresentation;

  if (!presentation) {
    return null;
  }

  const cards = element("div", "d-grid gap-3");
  const named = presentation.namedCalls.get(pathKey(ownerPath));
  const declaration = presentation.declarations.get(pathKey(ownerPath));
  const imported = presentation.imports.get(pathKey(ownerPath));

  if (named) {
    cards.append(namedFunctionOverview(named));
  }

  if (declaration) {
    cards.append(entryTemplateOverview(declaration));
  }

  if (imported) {
    cards.append(importOverview(imported));
  }

  if (presentation.module && samePath(ownerPath, ["(module)"])) {
    cards.append(moduleOverview(presentation.module));
  }

  return cards.childElementCount ? cards : null;
}

function namedFunctionOverview(call) {
  const card = element("article", "editor-template-card rounded-3 p-3 d-grid gap-3");
  const header = element("div", "d-flex flex-wrap align-items-start justify-content-between gap-2");
  const copy = element("div", "min-w-0");
  copy.append(
    element("span", "editor-eyebrow", "Generated settings"),
    element("strong", "d-block mt-1", call.definition ? `Uses entry template ${call.name}` : `Unresolved entry template ${call.name || "unknown"}`),
    element("p", "editor-control-hint mb-0 mt-1", "These inputs are passed to the selected entry template.")
  );
  header.append(copy);
  if (call.definition) {
    const reveal = button("Show entry template", "fa-solid fa-arrow-up-right-from-square", "btn btn-sm btn-site-secondary");
    reveal.addEventListener("click", () => navigateTemplateTarget({ path: call.definition.entry.path }));
    header.append(reveal);
  }

  const names = [...new Set([...call.definitions.map((definition) => definition.name), call.name].filter(Boolean))];
  const select = element("select", "form-select editor-input editor-input--code");
  names.forEach((name) => select.append(selectOption(name, name)));
  select.value = call.name;
  select.addEventListener("change", () => updateOption(call.entry.path, `*${select.value}`, { literal: true }));
  card.append(header, labeledControl("Entry template", select));
  if (call.missing.length) {
    card.append(validationNotice(`Missing ${pluralize(call.missing.length, "input")}: ${call.missing.join(", ")}.`));
  }

  if (call.unknown.length) {
    card.append(validationNotice(`Unknown ${pluralize(call.unknown.length, "input")}: ${call.unknown.map((entry) => entry.key).join(", ")}.`));
  }

  if (call.generated.length) {
    card.append(generatedSettingsOverview(call.generated));
  }

  const syntax = element("details", "editor-advanced-syntax");
  syntax.append(element("summary", "", "Inspect KingdomsX function syntax"), element("code", "d-block mt-2", `${call.entry.key}: ${call.entry.source}`));
  card.append(syntax);
  return card;
}

function entryTemplateOverview(definition) {
  const card = element("article", "editor-template-card rounded-3 p-3 d-grid gap-3");
  const heading = element("div");
  heading.append(
    element("span", "editor-eyebrow", "Entry template"),
    element("p", "editor-control-hint mb-0 mt-1", "Entries using this template fill in these values in the order shown below.")
  );
  card.append(heading);
  const name = element("input", "form-control editor-input editor-input--code");
  name.value = definition.name;
  name.pattern = "[A-Za-z0-9_\\-]+";
  name.addEventListener("change", () => {
    if (!name.reportValidity() || name.value.trim() === definition.name) {
      return;
    }

    renameAnchorDefinition(definition.entry.path, name.value, definition.name);
  });
  card.append(labeledControl("Entry template name", name));
  const inputs = element("div", "d-flex flex-wrap gap-2");

  if (definition.parameters.length) {
    definition.parameters.forEach((name, index) => inputs.append(element(
      "span",
      "editor-pill fw-bold text-nowrap editor-template-chip d-inline-flex align-items-center",
      `${index + 1}. ${name.replace(/^<|>$/g, "")}`
    )));
  } else {
    inputs.append(element("span", "editor-control-hint", "No inputs"));
  }

  card.append(labeledControl("Inputs", inputs));
  const calls = element("div", "d-flex flex-wrap gap-2");
  definition.calls.forEach((call, index) => {
    const target = call.ownerPath ?? call.entry.path;
    const jump = button(`Use ${index + 1}`, "fa-solid fa-arrow-down", "btn btn-sm btn-site-secondary");
    jump.addEventListener("click", () => navigateTemplateTarget({ path: target }));
    calls.append(jump);
  });
  if (calls.childElementCount) {
    card.append(labeledControl(`${pluralize(definition.calls.length, "call site")}`, calls));
  } else {
    card.append(element("small", "editor-validation--warning", "Nothing in this file uses this template."));
  }

  return card;
}

function moduleOverview(module) {
  const card = element("article", "editor-template-card rounded-3 p-3 d-grid gap-3");
  card.append(
    element("span", "editor-eyebrow", "Parent template contract"),
    element("strong", "", `${pluralize(module.parameters.length, "input")} exposed to child configs`)
  );
  const list = element("div", "d-grid gap-2");

  for (const parameter of module.parameters) {
    const row = element("div", "editor-ghost-card rounded-2 p-2 d-flex flex-wrap align-items-center justify-content-between gap-2");
    const copy = element("span");
    copy.append(element("strong", "d-block", parameter.label), element("small", "editor-control-hint", `${parameter.type} · ${parameter.required ? "Required" : `Default: ${parameter.defaultValue}`}`));
    row.append(copy, element("span", "editor-pill fw-bold text-nowrap editor-template-chip d-inline-flex align-items-center", `${pluralize(parameter.usages.length, "use")}`));
    list.append(row);
  }

  card.append(list);
  if (module.consumers.length) {
    const consumers = element("div", "d-flex flex-wrap gap-2");
    module.consumers.forEach((consumer) => {
      const open = button(consumer.path, "fa-solid fa-arrow-up-right-from-square", "btn btn-sm btn-site-secondary");
      open.addEventListener("click", () => navigateTemplateTarget({ fileName: consumer.path }));
      consumers.append(open);
    });
    card.append(labeledControl("Child configs", consumers));
  }

  return card;
}

function importOverview(imported) {
  const card = element("article", "editor-template-card rounded-3 p-3 d-grid gap-3");
  const header = element("div", "d-flex flex-wrap align-items-start justify-content-between gap-2");
  const copy = element("div");
  copy.append(
    element("span", "editor-eyebrow", "Parent template"),
    element("strong", "d-block mt-1", imported.resolved ? imported.parentFileName : `${imported.name} could not be resolved`),
    element("p", "editor-control-hint mb-0 mt-1", imported.extend
      ? "Parent settings are inherited, then local settings extend or override them."
      : "Only explicitly imported values are used. The full parent settings are not extended.")
  );
  header.append(copy);
  if (imported.resolved) {
    const open = button("Open parent contract", "fa-solid fa-arrow-up-right-from-square", "btn btn-sm btn-site-secondary");
    open.addEventListener("click", () => navigateTemplateTarget({ fileName: imported.parentFileName, path: ["(module)"] }));
    header.append(open);
  }

  card.append(header);
  if (imported.parameters.length) {
    const status = element("div", "d-flex flex-wrap gap-2");

    for (const parameter of imported.parameters) {
      const supplied = imported.suppliedByName.has(parameter.name);
      const text = supplied ? `${parameter.label}: local value`
        : parameter.required ? `${parameter.label}: missing`
          : `${parameter.label}: parent default`;
      status.append(element("span", `editor-pill fw-bold text-nowrap editor-template-chip d-inline-flex align-items-center${!supplied && parameter.required ? " is-warning" : ""}`, text));
    }

    card.append(labeledControl("Template inputs", status));
  }

  if (imported.unknown.length) {
    card.append(validationNotice(`Unknown ${pluralize(imported.unknown.length, "input")}: ${imported.unknown.map((entry) => entry.key).join(", ")}.`));
  }

  if (imported.anchors.length) {
    card.append(element("small", "editor-control-hint", `${pluralize(imported.anchors.length, "named parent value")} available to import.`));
  }

  const effective = state.templatePresentation?.effectiveEntries ?? [];
  const inherited = effective.filter((entry) => entry.inherited);
  const local = effective.filter((entry) => !entry.inherited);

  if (effective.length) {
    const details = element("details", "editor-template-result");
    details.append(element("summary", "", `Effective config · ${pluralize(local.length, "local setting")} + ${pluralize(inherited.length, "inherited setting")}`));
    const list = element("div", "d-grid gap-1 mt-2");

    for (const entry of inherited.slice(0, 24)) {
      const row = element("div", "editor-ghost-card rounded-2 p-2 d-flex flex-wrap align-items-center justify-content-between gap-2");
      row.append(
        element("span", "", displaySettingPath(entry.path)),
        element("span", "editor-pill fw-bold text-nowrap editor-template-chip d-inline-flex align-items-center", `Inherited from ${entry.origin || imported.parentFileName}`)
      );
      list.append(row);
    }

    if (inherited.length > 24) {
      list.append(element("small", "editor-control-hint", `${inherited.length - 24} more inherited settings.`));
    }

    details.append(list);
    card.append(details);
  }

  return card;
}

function generatedSettingsOverview(entries) {
  const details = element("details", "editor-template-result");
  details.append(element("summary", "", `Generated result · ${pluralize(entries.length, "setting")}`));
  const list = element("dl", "editor-template-result-list d-grid gap-2 mt-2 mb-0");

  for (const entry of entries.slice(0, 12)) {
    list.append(
      element("dt", "", displaySettingPath(entry.path)),
      element("dd", "mb-0", String(parseSimpleLiteral(entry.source).value ?? entry.source))
    );
  }

  details.append(list);
  return details;
}

function validationNotice(message) {
  return element("small", "editor-validation--warning", message);
}

function labeledControl(label, control) {
  if (!control.matches("input.form-control, textarea.form-control, select.form-select")) {
    const root = element("div", "d-grid gap-1");
    root.append(element("span", "editor-subfield-label fw-bold", label), control);
    return root;
  }

  const root = element("div", "form-floating editor-floating");
  const id = control.id || `editor-workspace-control-${++labeledControlId}`;
  control.id = id;
  if (control.matches("input, textarea") && !control.placeholder) {
    control.placeholder = label;
  }

  const fieldLabel = element("label", "", label);
  fieldLabel.htmlFor = id;
  root.append(control, fieldLabel);
  return root;
}

function collectMessageTokens(workspace, loadedSchema) {
  const sources = [
    ...(workspace?.files ?? []).map((session) => session.document.currentText),
    ...(loadedSchema?.defaults ?? []).map((option) => option.source ?? "")
  ];
  const tokens = new Set(observedMessageReferences(sources));

  for (const session of workspace?.files ?? []) {
    for (const entry of session.document.index.entries) {
      if (entry.path.length >= 2 && entry.path.at(-2) === "variables") {
        tokens.add(`{$${entry.path.at(-1)}}`);
      }
    }
  }

  return [...tokens];
}

function showStructureControls(owner) {
  if (owner?.availableFields?.length) {
    return true;
  }

  return state.viewMode === "all" && !state.query && owner?.dynamicMapping;
}

function reusableSettingsNamesBefore(currentEntry) {
  return reusableSettingsDefinitionsBefore(currentEntry).map((entry) => parseAnchorName(entry.source));
}

function reusableSettingsNotice(owner, sharedGroup = null) {
  if (!owner.entry) {
    return null;
  }

  const name = parseAnchorName(owner.entry.source);

  if (!name) {
    return null;
  }

  const isFunction = owner.syntax?.kind === "function-declaration";

  if (isFunction) {
    return null;
  }

  const flow = element("div", "editor-reusable-flow d-grid min-w-0");
  const connector = element("span", "editor-reusable-flow-connector");
  connector.setAttribute("aria-hidden", "true");
  const notice = element("aside", "editor-reusable editor-surface-card rounded-3 p-3 d-grid gap-3");
  const summary = element("div", "d-flex align-items-start gap-3");
  const icon = element("span", "editor-reusable-icon place-items-center d-grid flex-shrink-0");
  icon.append(element("i", "fa-solid fa-link"));
  const copy = element("div", "editor-reusable-copy d-grid gap-1 min-w-0");
  const input = anchorNameControl(owner.entry, name);
  const controlId = input.id || `editor-workspace-control-${++labeledControlId}`;
  input.id = controlId;
  const relation = element("div", "editor-reusable-relation d-flex flex-wrap align-items-center gap-2 min-w-0");
  const label = element("label", "editor-reusable-name fw-bold", "Shared as:");
  label.htmlFor = controlId;
  relation.append(label, input);
  copy.append(
    element("span", "editor-eyebrow", "Shared group"),
    relation,
    element("p", "editor-reusable-help mb-0", `Compatible groups later in this file can link to this ${owner.label} group and stay in sync.`)
  );
  summary.append(icon, copy);
  const controls = element("div", "d-flex flex-wrap gap-2");
  const stop = element("button", "btn btn-sm btn-site-secondary d-inline-flex align-items-center gap-2");
  stop.type = "button";
  stop.append(element("i", "fa-solid fa-link-slash"), document.createTextNode("Stop sharing"));
  stop.addEventListener("click", () => removeAnchorDefinition(owner.entry.path, name));
  controls.append(stop);
  notice.append(summary, controls);
  if (sharedGroup) {
    const valueWrapper = element("div", "editor-reusable-flow-value d-grid gap-2 min-w-0");
    valueWrapper.append(sharedGroup);
    flow.append(valueWrapper);
  }

  flow.append(connector, notice);
  return flow;
}

function anchorNameControl(entry, name) {
  const input = element("input", "form-control editor-input editor-input--code");
  input.value = name;
  input.pattern = "[A-Za-z0-9_\-]+";
  input.addEventListener("change", () => {
    if (!input.reportValidity() || input.value.trim() === name) {
      return;
    }

    renameAnchorDefinition(entry.path, input.value);
  });
  return input;
}

async function revealAnchorDefinition(aliasEntry, name) {
  const definition = findAnchorDefinition(aliasEntry, name);

  if (!definition) {
    const shared = state.effectiveIndex?.byPath.get(pathKey(aliasEntry.path));
    const parent = state.workspace.files.find((session) => session.fileName === shared?.sharedOrigin);

    if (parent && shared?.sharedDefinitionPath) {
      const opened = await openWorkspaceFile(parent.fileName, {
        targetPath: shared.sharedDefinitionPath,
        focusContent: contentTriggerOwnsFocus()
      });

      if (opened) {
        announce(`Showing shared value “${name}” in ${parent.fileName}.`, false, "Shared value located");
      }

      return;
    }

    const declaration = findImportedAnchorDeclaration(name);

    if (declaration) {
      navigateToOption(declaration.path);
      announce(`“${name}” is imported from ${shared?.sharedOrigin || "a shared template"}. Open that template with these files to view its original values.`);
      return;
    }

    announce(`Shared value “${name}” was not found earlier in this file.`, true);
    return;
  }

  refreshAfterMutation(definition.path, { reveal: true });
  announce(`Showing shared value “${name}”.`, false, "Shared value located");
}

function renameAnchorDefinition(path, nextName, currentName = "") {
  try {
    renameDocumentAnchor(state.session.document, path, nextName, currentName);
    const name = nextName.trim();
    state.session.exported = false;
    refreshAfterMutation(path, { reveal: true });
    announce(`Renamed the shared value to “${name}” and updated every linked setting.`, false, "Shared value renamed");
  } catch (error) {
    announce(error.message, true);
  }
}

function removeAnchorDefinition(path, name) {
  const warning = `Stop sharing “${name}”? Every linked setting will keep the same values as an independent copy.`;

  if (!window.confirm(warning)) {
    return;
  }

  try {
    removeDocumentAnchor(state.session.document, path);
    state.session.exported = false;
    refreshAfterMutation(path, { reveal: true });
    announce(`Stopped sharing “${name}”. Linked settings kept their current values as independent copies.`, false, "Sharing stopped");
  } catch (error) {
    announce(error.message, true);
  }
}

function detachAnchorReference(aliasEntry, name) {
  const definition = findAnchorDefinition(aliasEntry, name);

  try {
    if (definition) {
      detachDocumentAlias(state.session.document, aliasEntry.path, definition.path);
    } else {
      const shared = state.effectiveIndex?.byPath.get(pathKey(aliasEntry.path));

      if (shared?.sharedBy !== name || !shared.sharedDefinitionSource) {
        throw new Error(`Shared value “${name}” could not be loaded from its original definition.`);
      }

      detachDocumentAliasSource(
        state.session.document,
        aliasEntry.path,
        shared.sharedDefinitionSource,
        shared.sharedDefinitionIndent
      );
    }

    state.session.exported = false;
    refreshAfterMutation(aliasEntry.path, { reveal: true });
    announce(`Unlinked “${name}”. This setting now has its own independent copy.`, false, "Value unlinked");
  } catch (error) {
    announce(error.message, true);
  }
}

function detachListAnchorReference(target, name) {
  try {
    detachDocumentSequenceItemAlias(
      state.session.document,
      target.path,
      target.itemIndex
    );
    state.session.exported = false;
    refreshAfterMutation(target.path, { reveal: true });
    announce(`Unlinked “${name}”. This list item now has its own independent value.`, false, "Value unlinked");
  } catch (error) {
    announce(error.message, true);
  }
}

function removeListAnchorDefinition(target, name) {
  if (!window.confirm(`Stop sharing “${name}”? Every linked list item will keep the same independent value.`)) {
    return;
  }

  try {
    removeDocumentSequenceItemAnchor(
      state.session.document,
      target.path,
      target.itemIndex
    );
    state.session.exported = false;
    refreshAfterMutation(target.path, { reveal: true });
    announce(`Stopped sharing “${name}”. Linked list items kept independent copies.`, false, "Sharing stopped");
  } catch (error) {
    announce(error.message, true);
  }
}

function revealListAnchorDefinition(target, name) {
  const definition = sequenceItemAnchorDefinitions(
    state.session.document,
    target.path,
    target.itemIndex
  ).find((candidate) => candidate.name === name);

  if (!definition) {
    announce(`Shared value “${name}” was not found earlier in this file.`, true);
    return;
  }

  navigateToOption(definition.path);
  announce(`Showing the list that defines “${name}”${Number.isInteger(definition.itemIndex) ? ` at item ${definition.itemIndex + 1}` : ""}.`, false, "Shared value located");
}

function resolveListAnchorSource(target, name) {
  return sequenceItemAnchorDefinitions(
    state.session.document,
    target.path,
    target.itemIndex
  ).find((candidate) => candidate.name === name)?.source ?? "";
}

function compatibleSequenceNames(target) {
  return compatibleSequenceDefinitions(target.path, target.itemIndex)
    .map((definition) => definition.name);
}

function resolveAnchorSource(aliasEntry, name) {
  const definition = findAnchorDefinition(aliasEntry, name);

  if (definition) {
    return parseAnchoredValue(definition.source)?.value ?? "";
  }

  const shared = state.effectiveIndex?.byPath.get(pathKey(aliasEntry.path));

  if (shared?.sharedBy !== name || !shared.sharedDefinitionSource) {
    return "";
  }

  return parseAnchoredValue(shared.sharedDefinitionSource)?.value ?? "";
}

function openAnchorDialog(target, label) {
  state.anchorPath = target;
  elements.anchorEyebrow.textContent = "Create shared value";
  elements.anchorHeadingPrefix.textContent = "Share: ";
  elements.anchorHeadingSuffix.textContent = "";
  elements.anchorTarget.textContent = label;
  elements.anchorDescription.textContent = "Give this value a file-local name. Compatible settings later in the file can link to it and stay in sync.";
  elements.anchorNameLabel.textContent = "Shared value name";
  elements.anchorNameHint.textContent = "Use letters, numbers, underscores, or hyphens. The name is available later in this file.";
  elements.anchorCloseLabels.forEach((copy) => {
    copy.textContent = "Cancel";
  });
  elements.anchorCloseButtons.forEach((button) => {
    if (button.hasAttribute("aria-label")) {
      button.setAttribute("aria-label", "Close");
    }
  });
  elements.anchorSubmitLabel.textContent = "Create shared value";
  const path = Array.isArray(target) ? target : target.path;
  elements.anchorName.value = suggestedAnchorName(path);
  elements.anchorDialog.showModal();
  window.requestAnimationFrame(() => elements.anchorName.select());
}

function closeAnchorDialog() {
  elements.anchorDialog.close();
  state.anchorPath = null;
}

function openAnnotationDialog(path, label = labelForKey(path.at(-1))) {
  const entry = state.session.document.index.byPath.get(pathKey(path));

  if (!entry) {
    return;
  }

  const active = new Set((entry.annotations ?? []).map((annotation) => annotation.id));
  state.annotationPath = path;
  elements.annotationTarget.textContent = label;
  elements.annotationPolicies.forEach((input) => {
    input.checked = active.has(input.value);
  });
  elements.annotationDialog.showModal();
  window.requestAnimationFrame(() => elements.annotationPolicies[0]?.focus());
}

function closeAnnotationDialog() {
  elements.annotationDialog.close();
  state.annotationPath = null;
}

function saveAnnotationPolicies(event) {
  event.preventDefault();

  if (!state.annotationPath) {
    return;
  }

  const path = state.annotationPath;

  try {
    for (const input of elements.annotationPolicies) {
      setDocumentAnnotation(state.session.document, path, input.value, input.checked);
    }

    state.session.exported = false;
    closeAnnotationDialog();
    refreshAfterMutation(path, { reveal: true });
    announce("Saved the inheritance rules.", false, "Inheritance rules saved");
  } catch (error) {
    announce(error.message, true);
  }
}

function reusableSettingsDefinitionsBefore(currentEntry) {
  if (!currentEntry) {
    return [];
  }

  const definitions = new Map();
  const index = state.session.document.index;
  const targetShape = reusableValueShape(currentEntry, index);

  for (const entry of index.entries) {
    if (entry.line >= currentEntry.line) {
      break;
    }

    const name = parseAnchorName(entry.source);

    if (!name || entry.syntax?.kind === "function-declaration") {
      continue;
    }

    if (reusableValueShape(entry, index) !== targetShape) {
      continue;
    }

    if (state.schema?.schema
      && !reusableSettingsCompatible(state.schema.schema, entry.path, currentEntry.path)) {
      continue;
    }

    definitions.set(name, entry);
  }

  return [...definitions.values()];
}

function valueShapeLabel(entry) {
  const shape = reusableValueShape(entry, state.session.document.index);

  if (shape === "list") {
    return "list";
  }

  if (shape === "section") {
    return "section";
  }

  return "value";
}

function openUseSavedDialog(target, label) {
  const listTarget = !Array.isArray(target) && Number.isInteger(target?.itemIndex);
  const path = listTarget ? target.path : target;
  const entry = state.session.document.index.byPath.get(pathKey(path));
  const definitions = listTarget
    ? compatibleSequenceDefinitions(path, target.itemIndex)
    : reusableSettingsDefinitionsBefore(entry);

  if (!entry || !definitions.length) {
    announce("No compatible shared value is defined earlier in this file yet.", true, "Shared value unavailable");
    return;
  }

  state.useSavedPath = target;
  elements.useSavedTarget.textContent = label;
  elements.useSavedName.replaceChildren(...definitions.map((definition) => {
    const name = definition.name ?? parseAnchorName(definition.source);
    const shape = listTarget ? "list item" : valueShapeLabel(definition);

    return selectOption(`${name} · ${shape}`, name);
  }));
  elements.useSavedDialog.showModal();
  window.requestAnimationFrame(() => elements.useSavedName.focus());
}

function compatibleSequenceDefinitions(path, itemIndex) {
  const fieldType = unwrapNullable(typeAtPath(state.schema?.schema, path));
  const listType = ["list", "set"].includes(fieldType?.kind)
    ? fieldType
    : fieldType?.kind === "union"
      ? fieldType.choices?.map(unwrapNullable).find((choice) => ["list", "set"].includes(choice?.kind))
      : null;
  const elementType = unwrapNullable(listType?.elements);

  return sequenceItemAnchorDefinitions(state.session.document, path, itemIndex)
    .filter((definition) => sequenceDefinitionMatchesType(definition.source, elementType));
}

function sequenceDefinitionMatchesType(source, type) {
  if (!type || ["advanced", "string", "suggestion", "enum", "expression"].includes(type.kind)) {
    return parseSimpleLiteral(source).kind === "string";
  }

  const kind = parseSimpleLiteral(source).kind;

  if (type.kind === "boolean") {
    return kind === "boolean";
  }

  if (type.kind === "integer") {
    return kind === "integer";
  }

  if (type.kind === "decimal") {
    return kind === "integer" || kind === "decimal";
  }

  return false;
}

function closeUseSavedDialog() {
  elements.useSavedDialog.close();
  state.useSavedPath = null;
}

function useSavedSettings(event) {
  event.preventDefault();

  if (!state.useSavedPath || !elements.useSavedName.value) {
    return;
  }

  const target = state.useSavedPath;
  const listTarget = !Array.isArray(target) && Number.isInteger(target?.itemIndex);
  const path = listTarget ? target.path : target;
  const name = elements.useSavedName.value;

  try {
    if (listTarget) {
      reuseDocumentSequenceItemAnchor(state.session.document, path, target.itemIndex, name);
    } else {
      reuseDocumentAnchor(state.session.document, path, name);
    }

    state.session.exported = false;
    closeUseSavedDialog();
    refreshAfterMutation(path, { reveal: true });
    announce(`This setting is now linked to “${name}”.`);
  } catch (error) {
    announce(error.message, true);
  }
}

function suggestedAnchorName(path) {
  const base = path.map((segment) => String(segment).toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .join("-") || "reusable-settings";
  const existing = new Set(scanAnchorTokens(state.session.document.currentText)
    .filter((token) => token.kind === "anchor")
    .map((token) => token.name));

  if (!existing.has(base)) {
    return base;
  }

  let suffix = 2;

  while (existing.has(`${base}-${suffix}`)) {
    suffix += 1;
  }

  return `${base}-${suffix}`;
}

function createReusableSettings(event) {
  event.preventDefault();

  if (!state.anchorPath || !elements.anchorName.reportValidity()) {
    return;
  }

  const target = state.anchorPath;
  const listTarget = !Array.isArray(target) && Number.isInteger(target?.itemIndex);
  const path = listTarget ? target.path : target;
  const name = elements.anchorName.value.trim();

  try {
    if (listTarget) {
      addDocumentSequenceItemAnchor(state.session.document, path, target.itemIndex, name);
    } else {
      addDocumentAnchor(state.session.document, path, name);
    }

    state.session.exported = false;
    closeAnchorDialog();
    refreshAfterMutation(path, { reveal: true });
    announce(`Created shared value “${name}”.`, false, "Shared value created");
  } catch (error) {
    announce(error.message, true);
  }
}

function findAnchorDefinition(aliasEntry, name) {
  return state.session.document.index.entries
    .filter((entry) => entry.line < aliasEntry.line && parseAnchorName(entry.source) === name)
    .at(-1);
}

function findImportedAnchorDeclaration(name) {
  return state.session.document.index.entries.find((entry) =>
    entry.path.at(-1) === "anchors"
      && entry.path[0] === "(import)"
      && entry.collectionItems?.some((item) => parseImportedAnchor(item.source)?.localName === name)
  );
}

function renameOption(optionPath, nextKey) {
  const conditionalOutput = isConditionalOutputPath(optionPath.slice(0, -1));
  const nextPath = renameDocumentKey(state.session.document, optionPath, nextKey);

  if (conditionalOutput && nextKey === "else") {
    moveFallbackToEnd(state.session.document, nextPath);
  }

  state.session.exported = false;
  refreshAfterMutation(nextPath);
  announce(`Renamed entry to ${labelForKey(nextKey)}.`, false, "Entry renamed");
  return nextPath;
}

function moveOption(optionPath, direction) {
  try {
    moveDocumentMappingEntry(state.session.document, optionPath, direction);
    state.session.exported = false;
    refreshAfterMutation(optionPath, { reveal: true });
    announce(direction < 0 ? "Moved condition up." : "Moved condition down.", false, "Setting moved");
  } catch (error) {
    announce(error.message, true);
  }
}

function moveFallbackToEnd(document, fallbackPath) {
  const parentPath = fallbackPath.slice(0, -1);

  while (true) {
    const siblings = directMappingEntries(document, parentPath);
    const fallbackIndex = siblings.findIndex((entry) => samePath(entry.path, fallbackPath));

    if (fallbackIndex < 0 || fallbackIndex === siblings.length - 1) {
      return;
    }

    moveDocumentMappingEntry(document, fallbackPath, 1);
  }
}

function directMappingEntries(document, parentPath) {
  return document.index.entries.filter((entry) =>
    entry.path.length === parentPath.length + 1
      && parentPath.every((segment, index) => entry.path[index] === segment)
  );
}

function updateOption(optionPath, replacement, { literal, renderDelay = 0 }) {
  const warning = riskyChangeWarning(optionPath, replacement);

  if (warning && !window.confirm(`${warning}\n\nApply this change anyway?`)) {
    return false;
  }

  try {
    if (literal) {
      replaceDocumentLiteral(state.session.document, optionPath, replacement);
    } else {
      replaceDocumentValue(state.session.document, optionPath, replacement);
    }

    state.session.exported = false;

    if (renderDelay > 0) {
      const session = state.session;
      recordVisualHistory(visualHistoryFor(), session.document, optionPath);
      window.setTimeout(() => {
        if (state.session === session) {
          refreshAfterMutation(optionPath, { recordHistory: false });
        }
      }, renderDelay);
    } else {
      refreshAfterMutation(optionPath);
    }

    return true;
  } catch (error) {
    announce(error.message, true);
    return false;
  }
}

function resetOptionToDefault(optionPath, defaultOption) {
  if (!updateOption(optionPath, defaultOption.source, { literal: true })) {
    return;
  }

  const label = optionPath.map(labelForKey).join(" / ");
  announce(`Reset ${label} to its default value.`);
}

function addMessageEffect(optionPath, effect) {
  try {
    expandDocumentMessageEntry(state.session.document, optionPath, effect);
    state.session.exported = false;
    refreshAfterMutation(optionPath, { reveal: true });
    const label = effect === "actionbar" ? "action bar" : effect === "titles" ? "title" : "sound";
    announce(`Added a ${label} to this message.`, false, "Setting added");
  } catch (error) {
    announce(error.message, true);
  }
}

function riskyChangeWarning(path, replacement) {
  if (state.schema?.id !== "config") {
    return "";
  }

  const value = parseSimpleLiteral(replacement);
  const enabled = value.kind === "boolean" && value.value;
  const warnings = new Map([
    [pathKey(["debug"]), "Debug logging can be extremely noisy and may expose database connection details."],
    [pathKey(["disable-debug-tracing"]), "Disabling debug tracing reduces diagnostic information and may make support investigations harder."],
    [pathKey(["updates", "download"]), "Automatic update downloads can replace production plugin builds after a restart."],
    [pathKey(["updates", "configs"]), "Automatic config updating is experimental and can change settings silently."],
    [pathKey(["updates", "synchronize-guis", "automatic"]), "Automatic GUI synchronization copies layout changes between languages."],
    [pathKey(["development-mode"]), "Development mode is intended for testing, not an ordinary production server."]
  ]);
  const key = pathKey(path);

  if (enabled && warnings.has(key)) {
    return warnings.get(key);
  }

  if (key === pathKey(["iSwearIKnowWhatTheFuckIAmDoingRightNow"])) {
    return "This setting is intended for expert use. Change it only when KingdomsX documentation explicitly requires a different value.";
  }

  return "";
}

function undoOption(optionPath) {
  if (documentAnnotationChanged(state.session.document, optionPath)) {
    undoDocumentAnnotationChange(state.session.document, optionPath);
    state.session.exported = false;
    refreshAfterMutation(optionPath, { reveal: true });
    announce("Restored the previous inheritance rules.", false, "Change restored");
    return;
  }

  if (documentAnchorChanged(state.session.document, optionPath)) {
    undoDocumentAnchorRename(state.session.document, optionPath);
    state.session.exported = false;
    refreshAfterMutation(optionPath, { reveal: true });
    announce("Restored the previous shared value name and linked settings.", false, "Change restored");
    return;
  }

  const change = state.session.document.changes.get(pathKey(optionPath));

  if (!change) {
    return;
  }

  try {
    if (change.kind === "renamed") {
      const originalPath = renameDocumentKey(state.session.document, optionPath, change.originalPath.at(-1), {
        rawKey: change.originalRawKey,
        track: false
      });
      state.session.document.changes.delete(pathKey(optionPath));

      if (change.previousChange) {
        state.session.document.changes.set(pathKey(originalPath), { ...change.previousChange, path: originalPath });
      }
    } else if (change.kind === "added") {
      removeDocumentEntry(state.session.document, optionPath);
    } else if (change.kind === "expanded-message") {
      undoDocumentMessageExpansion(state.session.document, optionPath);
    } else if (change.kind === "detached-alias") {
      undoDocumentAliasDetach(state.session.document, optionPath);
    } else if (change.kind === "anchor-added") {
      undoDocumentAnchorAddition(state.session.document, optionPath);
    } else if (change.kind === "anchor-removed") {
      undoDocumentAnchorRemoval(state.session.document, optionPath);
    } else if (change.kind === "reused-anchor") {
      undoDocumentAnchorReuse(state.session.document, optionPath);
    } else {
      replaceDocumentLiteral(state.session.document, optionPath, change.previousSource);
    }

    state.session.exported = false;
    refreshAfterMutation(optionPath);
  } catch (error) {
    announce(error.message, true);
  }
}

function removeOption(optionPath) {
  const label = optionPath.map(labelForKey).join(" / ");

  if (!window.confirm(`Remove ${label}? This setting can be removed from the file.`)) {
    return;
  }

  try {
    removeDocumentEntry(state.session.document, optionPath);
    state.session.exported = false;
    refreshAfterMutation(optionPath);
    announce(`Removed ${label}.`, false, "Setting removed");
  } catch (error) {
    announce(error.message, true);
  }
}

function refreshAfterMutation(optionPath, { reveal = false, recordHistory = true } = {}) {
  if (recordHistory) {
    recordVisualHistory(visualHistoryFor(), state.session.document, optionPath);
  }

  const previousActiveSection = state.activeSection;
  const previousSections = state.sections;

  if (reveal) {
    state.query = "";
    state.viewMode = "all";
    expandOptionPath(optionPath);
  }

  rebuildStructure();

  const desiredSection = sectionKeyForPath(optionPath, state.sections)
    || sectionKeyForPath(optionPath, previousSections);

  state.activeSection = state.sections.some((section) => section.key === desiredSection)
    ? desiredSection
    : state.sections[0]?.key ?? "";
  state.effectiveIndex = state.session.document.index;
  state.templatePresentation = buildTemplatePresentation({
    index: state.session.document.index,
    effectiveIndex: state.effectiveIndex,
    workspace: state.workspace,
    session: state.session
  });
  state.messageTokens = collectMessageTokens(state.workspace, state.schema);
  state.messageMacros = messageMacroContext(
    state.workspace,
    state.session,
    state.defaultLanguageOptions,
    state.defaultConfigOptions
  );

  renderWorkspace();
  refreshEffectivePreview();

  if (reveal) {
    revealOption(optionPath);
  } else if (state.activeSection !== previousActiveSection) {
    scrollEditorToSection();
  }
}

function visualHistoryFor(session = state.session) {
  let history = visualHistories.get(session);

  if (!history) {
    history = createVisualHistory(session.document);
  }

  visualHistories.set(session, history);
  return history;
}

function synchronizeVisualHistory(session) {
  const history = ensureVisualHistory(visualHistories.get(session), session.document);
  visualHistories.set(session, history);
  return history;
}

function applyVisualHistory(direction) {
  const step = moveVisualHistory(visualHistoryFor(), direction);

  if (!step) {
    return;
  }

  restoreVisualHistory(state.session.document, step.snapshot);
  state.session.exported = false;
  refreshAfterMutation(step.optionPath, { recordHistory: false });
  announce(direction < 0 ? "Undid the last edit." : "Redid the last edit.", false, direction < 0 ? "Change undone" : "Change redone");
}

function refreshEffectivePreview() {
  const session = state.session;
  effectiveIndexForSession(state.workspace, session, { templateProfileForKey }).then((index) => {
    if (state.session !== session) {
      return;
    }

    state.effectiveIndex = index;
    state.templatePresentation = buildTemplatePresentation({
      index: session.document.index,
      effectiveIndex: index,
      workspace: state.workspace,
      session
    });
    schematicPreview.render({
      workspace: state.workspace,
      session,
      schemaId: state.schema?.id,
      configIndex: index,
      messageMacros: state.messageMacros
    });
    renderGuiPreview();
    renderActiveSection();
  }).catch(() => {
    if (state.session === session) {
      state.effectiveIndex = session.document.index;
    }
  });
}

function expandOptionPath(optionPath) {
  for (let length = 1; length <= optionPath.length; length += 1) {
    state.collapsedGroups.delete(pathKey(optionPath.slice(0, length)));
  }
}

function scrollEditorToTop() {
  elements.scroll.scrollTo({ top: 0, behavior: "auto" });
}

function scrollEditorToSection() {
  const header = elements.sectionTitle.closest(".editor-section-header");

  if (!header) {
    scrollEditorToTop();
    return;
  }

  const scrollBounds = elements.scroll.getBoundingClientRect();
  const headerTop = header.getBoundingClientRect().top - scrollBounds.top + elements.scroll.scrollTop;
  const headerPosition = getComputedStyle(elements.header).position;
  const headerHeight = ["absolute", "fixed"].includes(headerPosition)
    ? elements.header.getBoundingClientRect().height
    : 0;
  const toolHeight = elements.tools.getBoundingClientRect().height;
  elements.scroll.scrollTo({
    top: Math.max(0, headerTop - headerHeight - toolHeight),
    behavior: "auto"
  });
}

function revealOption(optionPath, { highlight = false, immediate = false } = {}) {
  const reveal = () => {
    const target = findOptionTarget(elements.form, optionPath);

    if (!target) {
      scrollEditorToSection();
      return;
    }

    target.scrollIntoView({
      behavior: editorPrefersReducedMotion() ? "auto" : "smooth",
      block: "center"
    });

    if (highlight) {
      target.classList.add("is-search-hit");
      window.setTimeout(() => target.classList.remove("is-search-hit"), 1600);
    }

    stickyGroupHeaders.schedule();
  };

  if (immediate) {
    reveal();
  } else {
    window.requestAnimationFrame(reveal);
  }
}

function navigateToOption(optionPath) {
  const sectionKey = sectionKeyForPath(optionPath, state.sections);
  const focusContent = contentTriggerOwnsFocus();

  if (sectionKey && sectionKey !== state.activeSection) {
    return selectEditorSection(sectionKey, {
      optionPath,
      resetView: true,
      focusContent
    });
  }

  commitSectionNavigation(state.activeSection, {
    optionPath,
    resetView: true,
    focusContent
  });
  return Promise.resolve(true);
}

async function navigateTemplateTarget({ fileName = state.session.fileName, path = [] } = {}) {
  const focusContent = contentTriggerOwnsFocus();

  if (fileName && fileName !== state.session.fileName) {
    return openWorkspaceFile(fileName, { targetPath: path, focusContent });
  }

  if (path.length) {
    return navigateToOption(path);
  }

  return false;
}

function contentTriggerOwnsFocus() {
  return document.activeElement instanceof Element
    && elements.sectionContent.contains(document.activeElement);
}

function focusWorkspaceFile(fileName) {
  const button = [...elements.workspaceFiles.querySelectorAll("[data-workspace-file]")]
    .find((candidate) => candidate.dataset.workspaceFile === fileName);
  button?.focus();
}

function focusSectionButton(sectionKey) {
  const button = [...elements.sectionList.querySelectorAll("[data-editor-section-key]")]
    .find((candidate) => candidate.dataset.editorSectionKey === sectionKey);
  button?.focus();
}

function focusSectionHeading() {
  elements.sectionTitle.tabIndex = -1;
  elements.sectionTitle.focus({ preventScroll: true });
  elements.sectionTitle.addEventListener("blur", () => elements.sectionTitle.removeAttribute("tabindex"), { once: true });
}

function samePath(left, right) {
  return left.length === right.length
    && left.every((segment, position) => segment === right[position]);
}

function mappingSpec(group, { entryKey = "", guiSlot = null } = {}) {
  return mappingCreationSpec({
    schemaId: state.schema?.id,
    fileName: state.session?.fileName,
    group,
    entryKey,
    guiSlot
  });
}

function structureAddPanel(owner) {
  if (mappingSpec(owner).panel === "commands" && canAddMappingEntry(owner)) {
    return mappingAddPanel(owner);
  }

  if (owner.availableFields.length) {
    return availableSettingsPanel(owner);
  }

  if (owner.dynamicMapping && canAddMappingEntry(owner)) {
    return mappingAddPanel(owner);
  }

  return null;
}

function availableSettingsPanel(owner) {
  const preferred = [...owner.availableFields]
    .filter((option) => option.required || option.tier === "common")
    .sort((left, right) =>
      Number(Boolean(right.required)) - Number(Boolean(left.required))
      || left.label.localeCompare(right.label)
    )
    .slice(0, 6);
  const requiredMissing = owner.availableFields.filter((option) => option.required).length;
  const scope = owner.path?.length ? "section" : "file";

  const panel = element("aside", "editor-available editor-add-surface surface-panel rounded-3 p-3 p-xxl-4 d-flex flex-column flex-xxl-row align-items-xxl-center gap-3");
  const icon = element("span", "editor-mapping-add-icon place-items-center d-grid flex-shrink-0");
  icon.append(element("i", "fa-solid fa-sliders"));

  const copy = element("div", "min-w-0 flex-grow-1");
  copy.append(
    element("span", "editor-eyebrow", scope === "section" ? "More section settings" : "More settings"),
    element("h2", "editor-mapping-add-title mb-1 mt-1", `Add a setting to ${owner.label}`),
    element("p", "editor-mapping-add-help mb-0", availableSettingsHelp(owner, preferred, requiredMissing, scope))
  );
  if (preferred.length) {
    const quick = element("div", "editor-available-chips d-flex flex-wrap gap-1");

    for (const optionInfo of preferred) {
      const chip = element("button", "editor-pill fw-bold text-nowrap editor-chip-button editor-available-chip d-inline-flex align-items-center");
      chip.type = "button";
      chip.textContent = optionInfo.required ? `${optionInfo.label} · needed` : optionInfo.label;
      chip.title = availableSettingDescription(optionInfo);
      chip.addEventListener("click", () => addAvailableSetting(owner, optionInfo.key));
      quick.append(chip);
    }

    copy.append(quick);
  }

  const controls = element("div", "editor-available-controls d-grid gap-2 flex-shrink-0 w-100");
  const select = element("select", "form-select editor-input");
  select.append(selectOption("Choose another setting…", ""));

  for (const optionInfo of owner.availableFields) {
    const suffix = optionInfo.required ? " · needed" : "";
    select.append(selectOption(`${optionInfo.label}${suffix} · ${optionInfo.key}`, optionInfo.key));
  }

  if (owner.dynamicMapping && canAddMappingEntry(owner)) {
    const custom = selectOption("Custom named entry…", "__custom__");
    custom.dataset.customEntry = "true";
    select.append(custom);
  }

  const add = element("button", "btn btn-site-secondary w-100 d-inline-flex align-items-center justify-content-center gap-2");
  add.type = "button";
  add.disabled = true;
  add.append(element("i", "fa-solid fa-plus"), document.createTextNode("Add setting"));
  const updateAction = () => {
    if (select.selectedOptions[0]?.dataset.customEntry) {
      select.title = `Create a custom named setting inside ${owner.label}.`;
      add.lastChild.textContent = `Add to ${owner.label}`;
      add.disabled = false;
      return;
    }

    if (!select.value) {
      select.title = "Choose a setting to add.";
      add.lastChild.textContent = "Add setting";
      add.disabled = true;
      return;
    }

    const selected = owner.availableFields.find((candidate) => candidate.key === select.value);
    select.title = selected
      ? availableSettingDescription(selected)
      : "Add this setting, then edit it below.";
    add.lastChild.textContent = "Add setting";
    add.disabled = false;
  };
  select.addEventListener("change", updateAction);
  add.addEventListener("click", () => {
    if (select.selectedOptions[0]?.dataset.customEntry) {
      openMappingDialog(owner);
    } else if (select.value) {
      addAvailableSetting(owner, select.value);
    }
  });
  updateAction();
  controls.append(select, add);
  panel.append(addSurfaceIntro(icon, copy), controls);
  return panel;
}

function availableSettingDescription(option) {
  return option.description || `Add ${option.label}, then edit it below.`;
}

function availableSettingsHelp(owner, preferred, requiredMissing, scope) {
  if (requiredMissing) {
    return `${pluralize(requiredMissing, "needed setting")} ${requiredMissing === 1 ? "is" : "are"} still missing from ${owner.label}. Add ${requiredMissing === 1 ? "it" : "them"}, then edit below.`;
  }

  if (preferred.length) {
    return "Choose a common setting, or select another from the list.";
  }

  return scope === "section"
    ? "Choose a setting to add to this section."
    : "Choose a setting to add.";
}

function addAvailableSetting(owner, key) {
  const setting = owner.availableFields.find((candidate) => candidate.key === key);

  if (!setting) {
    return;
  }

  if (state.session.document.index.byPath.has(pathKey(setting.path))) {
    refreshAfterMutation(setting.path, { reveal: true });
    announce(`${setting.label} is already present in this file.`);
    return;
  }

  try {
    const pluginDefault = defaultOptionForFile(state.schema, setting.path);

    if (unwrapNullable(setting.type)?.typeName === "MessageTitles") {
      const fields = MESSAGE_TITLE_STARTER_FIELDS.map(([fieldKey, starter]) => [
        fieldKey,
        defaultOptionForFile(state.schema, [...setting.path, fieldKey])?.source ?? starter
      ]);
      insertDocumentMapping(state.session.document, setting.path, fields);
    } else if (pluginDefault) {
      insertDocumentValue(state.session.document, setting.path, pluginDefault.source);
    } else {
      insertDocumentValue(state.session.document, setting.path, initialValueForType(setting.type));
    }

    state.session.exported = false;
    refreshAfterMutation(setting.path, { reveal: true });
    announce(`Added ${setting.label}.`, false, "Setting added");
  } catch (error) {
    announce(error.message, true);
  }
}

function mappingAddPanel(group) {
  const spec = mappingSpec(group);

  if (spec.panel === "commands") {
    return kingdomCommandsAddPanel(group);
  }

  const panel = element("aside", "editor-mapping-add editor-add-surface surface-panel rounded-3 p-3 p-xxl-4 d-flex flex-column flex-xxl-row align-items-xxl-center gap-3");
  const icon = element("span", "editor-mapping-add-icon place-items-center d-grid flex-shrink-0");
  icon.append(element("i", "fa-solid fa-layer-group"));
  const copy = element("div", "min-w-0 flex-grow-1");
  copy.append(
    element("span", "editor-eyebrow", spec.eyebrow),
    element("h2", "editor-mapping-add-title mb-1 mt-1", spec.title),
    element("p", "editor-mapping-add-help mb-0", spec.help || spec.blankHelp)
  );
  panel.append(addSurfaceIntro(icon, copy), mappingAddButton(group));
  return panel;
}

function kingdomCommandsAddPanel(group) {
  const available = availableKingdomCommands(group);
  const preferred = preferredKingdomCommands(available);
  const panel = element("aside", "editor-available editor-add-surface surface-panel rounded-3 p-3 p-xxl-4 d-flex flex-column flex-xxl-row align-items-xxl-center gap-3");
  const icon = element("span", "editor-mapping-add-icon place-items-center d-grid flex-shrink-0");
  icon.append(element("i", "fa-solid fa-terminal"));

  const copy = element("div", "min-w-0 flex-grow-1");
  copy.append(
    element("span", "editor-eyebrow", "Kingdoms commands"),
    element("h2", "editor-mapping-add-title mb-1 mt-1", "Add to Commands"),
    element("p", "editor-mapping-add-help mb-0", available.length
      ? "Choose a Kingdoms command to disable it, set a cooldown, or restrict it to certain worlds. Display names and aliases stay in the language file."
      : "All suggested Kingdoms commands are already listed below.")
  );
  if (preferred.length) {
    const quick = element("div", "editor-available-chips d-flex flex-wrap gap-1");

    for (const commandId of preferred) {
      const chip = element("button", "editor-pill fw-bold text-nowrap editor-chip-button editor-available-chip d-inline-flex align-items-center");
      chip.type = "button";
      chip.textContent = labelForKey(commandId);
      chip.title = `Add /k ${commandId}`;
      chip.addEventListener("click", () => addKingdomCommandEntry(group, commandId));
      quick.append(chip);
    }

    copy.append(quick);
  }

  const controls = element("div", "editor-available-controls d-grid gap-2 flex-shrink-0 w-100");
  const select = element("select", "form-select editor-input");
  select.append(selectOption(available.length ? "Choose a command…" : "Custom command…", ""));

  for (const commandId of available) {
    select.append(selectOption(`${labelForKey(commandId)} · ${commandId}`, commandId));
  }

  if (available.length) {
    const custom = selectOption("Custom command…", "__custom__");
    custom.dataset.customEntry = "true";
    select.append(custom);
  }

  const add = element("button", "btn btn-site-secondary w-100 d-inline-flex align-items-center justify-content-center gap-2");
  add.type = "button";
  add.disabled = !available.length;
  add.append(element("i", "fa-solid fa-plus"), document.createTextNode("Add to Commands"));

  const updateAction = () => {
    if (!available.length || select.selectedOptions[0]?.dataset.customEntry) {
      select.title = "Create a custom addon command entry.";
      add.lastChild.textContent = "Add custom command";
      add.disabled = false;
      return;
    }

    if (!select.value) {
      select.title = preferred.length
        ? "Use a common command, or choose another from this list."
        : "Choose a Kingdoms command to add.";
      add.lastChild.textContent = "Add to Commands";
      add.disabled = true;
      return;
    }

    select.title = `Add /k ${select.value}, then edit its disable, cooldown, and world settings.`;
    add.lastChild.textContent = "Add to Commands";
    add.disabled = false;
  };

  select.addEventListener("change", updateAction);
  add.addEventListener("click", () => {
    if (!available.length || select.selectedOptions[0]?.dataset.customEntry) {
      openMappingDialog(group);
    } else if (select.value) {
      addKingdomCommandEntry(group, select.value);
    }
  });
  updateAction();
  controls.append(select, add);
  panel.append(addSurfaceIntro(icon, copy), controls);
  return panel;
}

function addSurfaceIntro(icon, copy) {
  const intro = element("div", "d-flex align-items-start gap-3 min-w-0 flex-grow-1");
  intro.append(icon, copy);
  return intro;
}

function availableKingdomCommands(group) {
  const existing = new Set();

  for (const entry of state.session.document.index.entries) {
    if (entry.path.length === group.path.length + 1
      && group.path.every((segment, index) => entry.path[index] === segment)) {
      existing.add(entry.key);
    }
  }

  return KINGDOM_COMMANDS.filter((commandId) => !existing.has(commandId));
}

function preferredKingdomCommands(available) {
  const favorites = ["claim", "invite", "fly", "create", "admin", "home", "map", "nation"];

  return favorites.filter((commandId) => available.includes(commandId)).slice(0, 6);
}

function addKingdomCommandEntry(group, commandId) {
  const path = [...group.path, commandId];
  const spec = mappingSpec(group, { entryKey: commandId });

  if (state.session.document.index.byPath.has(pathKey(path))) {
    refreshAfterMutation(path, { reveal: true });
    announce(`${labelForKey(commandId)} is already in Commands.`);
    return;
  }

  try {
    insertMappingStarter(state.session.document, path, spec.starter, group.valueType);
    state.session.exported = false;
    refreshAfterMutation(path, { reveal: true });
    announce(spec.announcements.added, false, "Setting added");
  } catch (error) {
    announce(error.message, true);
  }
}

function mappingAddButton(group) {
  const spec = mappingSpec(group);
  const button = element("button", "btn btn-sm btn-site-secondary d-inline-flex align-items-center justify-content-center gap-2 flex-shrink-0");
  button.type = "button";
  button.append(
    element("i", "fa-solid fa-plus"),
    document.createTextNode(spec.actionLabel)
  );
  button.addEventListener("click", () => {
    if (spec.mode === "direct") {
      addDirectMappingEntry(group, spec);
    } else {
      openMappingDialog(group);
    }
  });
  return button;
}

function addDirectMappingEntry(group, spec) {
  const drafts = directMappingDraftsFor(state.session);
  const groupKey = pathKey(group.path);

  if (drafts.has(groupKey)) {
    document.querySelector(`[data-mapping-draft-key="${CSS.escape(groupKey)}"]`)?.focus();
    announce(spec.announcements.unfinished);
    return;
  }

  drafts.set(groupKey, { key: "", source: spec.starter.source });
  renderActiveSection();
  document.querySelector(`[data-mapping-draft-key="${CSS.escape(groupKey)}"]`)?.focus();
  announce(spec.announcements.started);
}

function directMappingDraftsFor(session) {
  let drafts = directMappingDrafts.get(session);

  if (!drafts) {
    drafts = new Map();
    directMappingDrafts.set(session, drafts);
  }

  return drafts;
}

function renderDirectMappingDraft(group) {
  const spec = mappingSpec(group);

  if (spec.mode !== "direct" || !state.session) {
    return null;
  }

  const session = state.session;
  const groupKey = pathKey(group.path);
  const draft = directMappingDrafts.get(session)?.get(groupKey);

  if (!draft) {
    return null;
  }

  const row = element("aside", "editor-option editor-ghost-card rounded-3 p-3 d-grid gap-3");
  row.dataset.mappingDraft = groupKey;
  const heading = element("div", "d-flex align-items-center justify-content-between gap-2");
  heading.append(element("strong", "", `Unfinished ${spec.noun}`));
  const cancel = element("button", "btn btn-sm btn-site-ghost", "Cancel");
  cancel.type = "button";
  cancel.dataset.mappingDraftCancel = groupKey;
  cancel.addEventListener("click", () => {
    directMappingDrafts.get(session)?.delete(groupKey);
    renderActiveSection();
    announce(spec.announcements.cancelled);
  });
  heading.append(cancel);

  const controls = element("div", "row g-3");
  const keyField = element("div", "col-12 col-lg-6 d-grid gap-1");
  const keyLabel = element("label", "form-label mb-0", spec.keyLabel);
  const keyInput = element("input", "form-control editor-input");
  keyInput.required = true;
  keyInput.spellcheck = false;
  keyInput.value = draft.key;
  keyInput.dataset.mappingDraftKey = groupKey;
  keyInput.setAttribute("aria-label", spec.keyLabel);
  const keyControl = configureMappingKeyInput(keyInput, group.keyType, group.key);
  keyInput.addEventListener("input", () => {
    draft.key = keyInput.value;
    keyInput.setCustomValidity("");
  });
  keyInput.addEventListener("change", () => {
    const key = keyInput.value.trim();
    keyInput.setCustomValidity(key ? "" : `Choose the ${spec.noun}.`);
    valueInput.setCustomValidity(valueInput.value.trim() ? "" : "Enter a value.");

    if (!keyInput.reportValidity() || !valueInput.reportValidity()) {
      return;
    }

    const path = [...group.path, key];

    if (session.document.index.byPath.has(pathKey(path))) {
      keyInput.setCustomValidity(`This ${spec.noun} already exists in this section.`);
      keyInput.reportValidity();
      return;
    }

    try {
      insertDocumentValue(session.document, path, draft.source);
      directMappingDrafts.get(session)?.delete(groupKey);
      session.exported = false;
      refreshAfterMutation(path, { reveal: true });
      announce(mappingSpec(group, { entryKey: key }).announcements.added, false, "Setting added");
    } catch (error) {
      keyInput.setCustomValidity(error.message);
      keyInput.reportValidity();
    }
  });
  keyField.append(keyLabel, keyControl, element("small", "editor-control-hint", spec.keyHelp));

  const valueField = element("div", "col-12 col-lg-6 d-grid gap-1");
  const valueLabel = element("label", "form-label mb-0", "Value");
  const valueInput = element("input", "form-control editor-input");
  const valueType = unwrapNullable(group.valueType);
  valueInput.type = ["integer", "decimal"].includes(valueType?.kind) ? "number" : "text";

  if (valueType?.kind === "integer") {
    valueInput.step = "1";
  }

  if (valueType?.kind === "decimal") {
    valueInput.step = "any";
  }

  if (valueType?.minimum !== undefined) {
    valueInput.min = String(valueType.minimum);
  }

  if (valueType?.maximum !== undefined) {
    valueInput.max = String(valueType.maximum);
  }

  valueInput.value = draft.source;
  valueInput.required = true;
  valueInput.dataset.mappingDraftValue = groupKey;
  valueInput.setAttribute("aria-label", "Value");
  valueInput.addEventListener("input", () => {
    draft.source = valueInput.value;
  });
  valueField.append(valueLabel, valueInput);
  controls.append(keyField, valueField);
  row.append(heading, controls);
  return row;
}

function dangerButton(label, action, iconOnly = false) {
  const classes = iconOnly
    ? "editor-icon-button editor-interactive-surface editor-icon-button--danger d-inline-grid"
    : "btn btn-sm btn-site-danger d-inline-flex align-items-center gap-2";
  const button = element("button", classes);
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(element("i", "fa-solid fa-trash"));
  if (!iconOnly) {
    button.append(document.createTextNode("Remove section"));
  }

  button.addEventListener("click", action);
  return button;
}

function undoButton(label, action) {
  return headerIconButton(label, "fa-solid fa-rotate-left", action);
}

function headerIconButton(label, iconClass, action) {
  const button = element("button", "editor-icon-button editor-interactive-surface d-inline-grid");
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(element("i", iconClass));
  button.addEventListener("click", action);
  return button;
}

function openMappingDialog(group, { guiSlot = null } = {}) {
  state.mappingGroup = group;
  state.mappingGuiSlot = guiSlot;
  const spec = mappingSpec(group, { guiSlot });
  state.mappingTemplates = spec.templates && guiSlot === null ? mappingTemplates(group) : [];
  elements.mappingEyebrow.textContent = spec.eyebrow;
  elements.mappingDescriptionCopy.textContent = spec.descriptionCopy;
  elements.mappingParent.textContent = spec.parentLabel || group.path.map(labelForKey).join(" / ");
  elements.mappingDescription.hidden = false;
  elements.mappingTitle.textContent = spec.title;
  elements.mappingKeyLabel.textContent = spec.keyLabel || mappingKeyLabel(group.keyType);
  elements.mappingKey.value = "";
  elements.mappingKey.setCustomValidity("");
  configureMappingKeyInput(elements.mappingKey, group.keyType, group.key);
  elements.mappingTemplate.replaceChildren();
  if (state.mappingTemplates.length) {
    elements.mappingTemplate.append(selectOption(spec.blankLabel, ""));
  }

  for (const template of state.mappingTemplates) {
    elements.mappingTemplate.append(selectOption(`Duplicate “${labelForKey(template.key)}”`, template.key));
  }

  elements.mappingTemplateField.hidden = state.mappingTemplates.length === 0;
  elements.mappingShapeField.hidden = state.mappingGroup.valueType?.typeName !== "any";
  elements.mappingShape.value = "text";
  const creationHelp = state.mappingGuiSlot !== null
    ? `The new button will use inventory slot ${state.mappingGuiSlot}. You can change its position in the complete button settings afterward.`
    : state.mappingTemplates.length
      ? spec.templateHelp
      : spec.blankHelp || "The new entry begins with an editable value that you can change immediately afterward.";
  elements.mappingHint.textContent = [spec.keyHelp || mappingKeyHelp(group.keyType), creationHelp]
    .filter(Boolean)
    .join(" ");
  elements.mappingSubmit.querySelector("span").textContent = spec.submitLabel;
  elements.mappingSubmit.querySelector("i").className = "fa-solid fa-plus me-2";
  elements.mappingDialog.showModal();
  elements.mappingKey.focus();
}

function addMappingEntry(event) {
  event.preventDefault();

  if (!elements.mappingKey.reportValidity()) {
    return;
  }

  const key = elements.mappingKey.value.trim();
  const path = [...state.mappingGroup.path, key];
  const spec = mappingSpec(state.mappingGroup, { entryKey: key, guiSlot: state.mappingGuiSlot });

  if (!key) {
    return elements.mappingKey.focus();
  }

  if (spec.keyValidation === "condition" && !(spec.conditional && key === "else")) {
    const problem = expressionProblem(key, "condition");

    if (problem) {
      elements.mappingKey.setCustomValidity(problem);
      elements.mappingKey.reportValidity();
      return;
    }
  }

  if (state.session.document.index.byPath.has(pathKey(path))) {
    elements.mappingKey.setCustomValidity("An entry with this name already exists in this section.");
    elements.mappingKey.reportValidity();
    return;
  }

  elements.mappingKey.setCustomValidity("");

  try {
    const guiSlot = state.mappingGuiSlot;
    const template = state.mappingTemplates.find((entry) => entry.key === elements.mappingTemplate.value);

    if (spec.conditional) {
      insertDocumentConditionalValue(
        state.session.document,
        path,
        template?.source ?? initialMappingValue(state.mappingGroup.valueType)
      );
    } else if (template) {
      insertDocumentValue(state.session.document, path, template.source);
    } else {
      insertMappingStarter(state.session.document, path, spec.starter, state.mappingGroup.valueType);
    }

    state.session.exported = false;
    elements.mappingDialog.close();

    if (guiSlot !== null) {
      setGuiPreviewExpanded(false, { restoreFocus: false });
    }

    refreshAfterMutation(path, { reveal: true });
    announce(spec.announcements.added, false, "Setting added");
  } catch (error) {
    announce(error.message, true);
  }
}

function insertMappingStarter(document, path, starter, valueType) {
  if (starter?.kind === "source") {
    insertDocumentValue(document, path, starter.source);
  } else if (starter?.kind === "fields") {
    insertDocumentMapping(document, path, starter.fields);
  } else if (starter?.kind === "tree") {
    insertDocumentMappingTree(document, path, starter.fields);
  } else {
    insertDocumentValue(document, path, initialMappingValue(valueType));
  }
}

function initialMappingValue(type) {
  if (type?.typeName !== "any") {
    return initialValueForType(type);
  }

  if (elements.mappingShape.value === "mapping") {
    return "{}";
  }

  if (elements.mappingShape.value === "list") {
    return "[]";
  }

  if (elements.mappingShape.value === "boolean") {
    return "false";
  }

  if (elements.mappingShape.value === "number") {
    return "0";
  }

  return '""';
}

function canAddMappingEntry(group) {
  return Boolean(group.valueType);
}

function isConditionalOutputGroup(group) {
  return isConditionMappingGroup(group) && group.keyType.allowFallback;
}

function isConditionMappingGroup(group) {
  return group?.keyType?.kind === "expression" && group.keyType.language === "condition";
}

function isConditionalOutputPath(groupPath) {
  const visit = (owners) => {
    for (const owner of owners ?? []) {
      if (samePath(owner.path ?? [], groupPath)) {
        return isConditionalOutputGroup(owner);
      }

      const nested = visit(owner.groups);

      if (nested !== null) {
        return nested;
      }
    }

    return null;
  };

  return visit(state.sections) ?? false;
}

function mappingTemplates(group) {
  return state.session.document.index.entries.filter((entry) =>
    entry.path.length === group.path.length + 1
      && group.path.every((segment, index) => entry.path[index] === segment)
      && !/(?:^|\s)&[A-Za-z0-9_-]+/.test(entry.source)
  );
}

function selectOption(label, value) {
  const node = element("option", "", label);
  node.value = value;
  return node;
}

async function openPreview() {
  if (!state.workspace) {
    return;
  }

  if (sourceEditor?.hasDraftChanges()) {
    announce("Apply or discard the pending code changes before reviewing.", true, "Code changes pending");
    return;
  }

  try {
    setBusy(true, "Preparing review…");
    elements.previewName.textContent = state.workspace.name;
    const changedSessions = state.workspace.files.filter(fileSessionHasChanges);
    const previewSession = changedSessions.includes(state.session) ? state.session : changedSessions[0];
    elements.previewFile.replaceChildren(...changedSessions.map((session) =>
      selectOption(
        `${session.fileName}${session.created ? " · new" : session.document.changes.size ? ` · ${pluralize(session.document.changes.size, "change")}` : ""}`,
        session.fileName
      )
    ));
    elements.previewFile.value = previewSession?.fileName ?? "";
    elements.previewFileField.hidden = changedSessions.length < 2;
    elements.previewSourceDetails.hidden = changedSessions.length === 0;
    if (previewSession) {
      await renderPreviewSource();
    }

    const changes = [
      ...workspaceFileChanges(state.workspace).map((change) => ({ ...change, fileName: change.path })),
      ...state.workspace.files.flatMap((session) =>
        describeChanges(session.document).map((change) => ({ ...change, fileName: session.fileName }))
      )
    ];
    elements.previewChangesEmpty.hidden = changes.length > 0;
    elements.previewChanges.replaceChildren(...changes.map((change) => {
      const card = element("article", "editor-review-change editor-ghost-card rounded-3 p-3");
      const heading = element("div", "d-flex flex-wrap align-items-center gap-2");
      heading.append(
        element("span", "editor-pill fw-bold text-nowrap editor-review-change-kind d-inline-flex align-items-center", change.kind),
        element(
          "strong",
          "editor-small-heading",
          change.kind === "File" || change.kind === "Schematic"
            ? change.path
            : state.workspace.files.length > 1 ? `${change.fileName} → ${change.path}` : change.path
        )
      );
      card.append(heading, reviewChangeSummary(change.summary));
      return card;
    }));

    const warnings = await collectWorkspaceWarnings(changedSessions);
    elements.previewWarningsPanel.hidden = warnings.length === 0;
    elements.previewWarnings.replaceChildren(...warnings.map((warning) =>
      element("li", "", state.workspace.files.length > 1 ? `${warning.fileName}: ${warning.message}` : warning.message)
    ));
    elements.previewDialog.showModal();
  } catch (error) {
    announce(error.message, true);
  } finally {
    setBusy(false);
  }
}

function reviewChangeSummary(summary) {
  const paragraph = element("p", "mb-0 mt-1");

  for (const part of Array.isArray(summary) ? summary : [summary]) {
    paragraph.append(typeof part === "string"
      ? document.createTextNode(part)
      : element("code", "", part.value));
  }

  return paragraph;
}

async function renderPreviewSource() {
  const path = elements.previewFile.value || state.session?.fileName;
  const session = state.workspace?.files.find((candidate) => candidate.fileName === path);

  if (!session || !fileSessionHasChanges(session)) {
    return;
  }

  const editor = await loadPreviewSourceEditor();
  editor.setSource(session.document.currentText, {
    highlightedLines: changedSourceLineNumbers(session.document, { wholeFile: session.created })
  });
  if (elements.previewSourceDetails.open) {
    window.requestAnimationFrame(() => editor.requestMeasure());
  }
}

async function collectWorkspaceWarnings(sessions = state.workspace.files) {
  const analyses = await Promise.all(sessions.map(async (session) => ({
    session,
    schema: session === state.session ? state.schema : await schemaForFile(session.fileName, session.document.index)
  })));
  const warnings = [];

  for (const { session, schema } of analyses) {
    const sections = session === state.session
      ? state.sections
      : buildFormStructure(session.document.index, schema?.schema);
    warnings.push(...session.document.warnings.map((message) => ({ fileName: session.fileName, message })));
    warnings.push(...semanticWarnings({
      index: session.document.index,
      schemaId: schema?.id,
      sections
    }).map((message) => ({ fileName: session.fileName, message })));
    warnings.push(...undefinedMessageMacroWarnings(
      session.document.index,
      messageMacroContext(
        state.workspace,
        session,
        state.defaultLanguageOptions,
        state.defaultConfigOptions
      )
    ).map((message) => ({ fileName: session.fileName, message })));
    warnings.push(...workspaceRelationships(state.workspace, session).warnings.map((message) => ({
      fileName: session.fileName,
      message
    })));
  }

  return warnings;
}

async function saveCurrentWorkspace() {
  if (!state.workspace || state.workspace.sourceKind === "example"
    || editorBusy || state.saving || state.downloadingRecovery) {
    return;
  }

  renderSessionExpiry();
  const remoteIssue = remoteWorkspaceIssue();

  if (remoteIssue) {
    announce(remoteIssue.message, true, remoteIssue.title);
    return;
  }

  const unfinishedRows = state.workspace.files.reduce(
    (count, session) => count + (directMappingDrafts.get(session)?.size ?? 0),
    0
  );

  if (unfinishedRows) {
    const action = state.remoteSession ? "saving" : "downloading";
    announce(`Complete or cancel ${pluralize(unfinishedRows, "unfinished item row")} before ${action}.`, true);
    return;
  }

  if (sourceEditor?.hasDraftChanges()) {
    announce(`Apply the pending code changes before ${state.remoteSession ? "saving" : "downloading"}.`, true, "Code changes pending");
    return;
  }

  const remoteSave = Boolean(state.remoteSession);

  try {
    if (remoteSave) {
      saveOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (elements.previewDialog.open) {
        elements.previewDialog.close();
      }

      setSaving(true, "Checking configs…");
    } else {
      setBusy(true, "Checking configs…");
    }

    const changedSessions = state.workspace.files.filter(fileSessionHasChanges);
    const warnings = await collectWorkspaceWarnings(changedSessions);
    const action = state.remoteSession ? "save to the server" : "download";

    if (warnings.length && !window.confirm(`${pluralize(warnings.length, "warning")} still need review in the changed configs. ${action[0].toLocaleUpperCase("en-US")}${action.slice(1)} anyway?`)) {
      return;
    }

    if (state.remoteSession) {
      const remoteSession = state.remoteSession;
      setSavingProgress("Preparing and encrypting configs…");
      const artifact = await workspaceDownloadArtifact(state.workspace);
      const bytes = new Uint8Array(await artifact.blob.arrayBuffer());
      setSavingProgress("Waiting for your Minecraft server to validate and apply the changes…");
      const revision = await remoteSession.save(bytes, state.workspace.remoteRevision);
      await clearRemoteDraft(state.draftRecovery, { session: true });
      acceptRemoteWorkspaceSave(state.workspace, bytes, revision);
      renderWorkspaceFiles();
      renderStatus();
      announce("The server applied the edited configs.", false, "Server configs saved");
      return;
    }

    const name = await downloadWorkspace(state.workspace);
    renderStatus();
    announce(`Downloaded ${name}.`, false, "Download ready");
  } catch (error) {
    if (remoteSave) {
      syncUploadedRemoteRevision();
    }

    announce(error.message, true);
  } finally {
    if (remoteSave) {
      setSaving(false);
      if (state.remoteSession) {
        handleRemoteSnapshot(state.remoteSession);
      }
    } else {
      setBusy(false);
    }
  }
}

function syncUploadedRemoteRevision() {
  const revision = state.remoteSession?.baseRevision;

  if (!state.workspace?.remoteContract
    || !Number.isSafeInteger(revision)
    || revision <= state.workspace.remoteRevision) {
    return;
  }

  state.workspace.remoteRevision = revision;
}

async function downloadOriginalFile() {
  if (!state.workspace) {
    return;
  }

  try {
    setBusy(true, "Preparing original backup…");
    const name = await downloadOriginalWorkspace(state.workspace);
    announce(`Downloaded ${name} without editor changes.`, false, "Download ready");
  } catch (error) {
    announce(error.message, true);
  } finally {
    setBusy(false);
  }
}

function renderStatus() {
  const summary = workspaceChangeSummary(state.workspace);
  const remoteIssue = remoteWorkspaceIssue();

  if (remoteIssue) {
    elements.changeStatus.textContent = remoteIssue.status;
  } else if (summary.changes) {
    elements.changeStatus.textContent = `${pluralize(summary.changes, "change")} in ${pluralize(summary.files, "file")} ready to ${state.remoteSession ? "save" : "download"}`;
  } else if (state.remoteSession?.snapshot?.state === "applied") {
    elements.changeStatus.textContent = "Saved to server";
  } else {
    elements.changeStatus.textContent = "No changes yet";
  }

  elements.workspace.inert = Boolean(remoteIssue?.locksEditor && remoteIssue.key !== "expired");
  elements.changeStatus.classList.toggle("has-changes", summary.changes > 0 && !remoteIssue);
  renderSaveAction();
  renderExpiredWorkspace();

  if (!remoteIssue?.locksEditor) {
    scheduleRemoteDraftSave();
  }
}

function renderSessionExpiry({ warn = true } = {}) {
  const snapshot = state.remoteSession?.snapshot;
  const available = Boolean(snapshot && state.workspace?.remoteContract);
  elements.sessionTimes.forEach((element) => element.hidden = !available);

  if (!available) {
    return;
  }

  const closed = ["cancelled", "conflicted"].includes(snapshot.state);
  const remaining = Math.max(0, Math.ceil((snapshot.expiresAt - Date.now()) / 1_000));

  if (!closed && (remaining === 0 || snapshot.state === "expired")) {
    state.remoteExpired = true;
  }

  const label = closed ? "Session closed" : state.remoteExpired
    ? "Session expired"
    : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")} left`;
  elements.sessionTimes.forEach((element) => {
    element.textContent = label;
    element.classList.toggle("text-warning", !closed && remaining <= 600);
    element.setAttribute("aria-label", closed || state.remoteExpired ? label : `Server session time remaining: ${label}`);
  });

  if (closed || state.remoteExpired) {
    handleRemoteSnapshot(state.remoteSession);

    if (state.remoteIssueKey === (closed ? snapshot.state : "expired")) {
      window.clearInterval(sessionExpiryTimer);
      sessionExpiryTimer = 0;
    }

    return;
  }

  if (!warn) {
    return;
  }

  const warning = SESSION_EXPIRY_WARNINGS.findLast((minutes) => remaining <= minutes * 60);
  if (!warning || (sessionExpiryWarning && warning >= sessionExpiryWarning)) {
    return;
  }

  sessionExpiryWarning = warning;
  showSiteToast({
    container: elements.toastContainer,
    title: "Session expires soon",
    message: `Your editor session expires within ${warning} ${warning === 1 ? "minute" : "minutes"}. Save finished changes to the server or download a backup of your unsaved work.`,
    kind: "is-warning",
    delay: 10_000,
    replace: true
  });
}

function renderExpiredWorkspace() {
  const expired = remoteWorkspaceIssue()?.key === "expired";
  elements.sectionActions.inert = expired;
  elements.guiPreview.inert = expired;
  elements.outpostPageActions.inert = expired;
  // Custom pickers can create new choices when a readonly input receives focus
  elements.form.inert = expired;
  sourceEditor?.setReadOnly(expired);

  [elements.addSchematic, elements.replaceSchematic, elements.removeSchematic].forEach((button) => {
    button.disabled = expired;
  });

  if (!expired) {
    return;
  }

  state.recoveryCodeDraft ??= sourceEditor?.draftForRecovery() ?? null;
  elements.form.querySelectorAll("input, textarea, select, button").forEach((control) => {
    if (control.matches("textarea, input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=color])")) {
      control.readOnly = true;
    } else {
      control.disabled = true;
    }
  });
}

async function downloadRecoveryBackup() {
  if (!state.remoteSession || !state.workspace || editorBusy || state.downloadingRecovery || state.saving) {
    return;
  }

  state.downloadingRecovery = true;
  elements.recoveryButtons.forEach((button) => button.disabled = true);
  renderSaveAction();

  try {
    const codeDraft = state.recoveryCodeDraft ?? sourceEditor?.draftForRecovery() ?? null;
    await downloadWorkspaceRecovery(state.workspace, codeDraft);
    elements.expiredDialog.close();
    announce("Downloaded your work for manual recovery. Nothing was saved to the server.", false, "Backup downloaded");
  } catch (error) {
    announce(`Your backup could not be downloaded: ${error.message}`, true, "Backup unavailable");
  } finally {
    state.downloadingRecovery = false;
    elements.recoveryButtons.forEach((button) => button.disabled = state.saving);
    renderSaveAction();
  }
}

function remoteWorkspaceIssue() {
  const snapshot = state.remoteSession?.snapshot;
  const workspace = state.workspace;

  if (!snapshot || !workspace?.remoteContract) {
    return null;
  }

  const terminal = {
    cancelled: {
      status: "Server session cancelled",
      message: "This server editor session was cancelled. Ask the server to create a new editor link.",
      title: "Server session cancelled"
    },
    expired: {
      status: "Server session expired",
      message: "Your session expired. Your unsaved work is still available in this tab. Download it before closing or refreshing.",
      title: "Server session expired"
    },
    conflicted: {
      status: "Server files changed",
      message: "The server files changed outside this editor. Editing has been disabled. Create a new editor link to continue.",
      title: "Server configs changed"
    }
  }[state.remoteExpired ? "expired" : snapshot.state];

  if (terminal) {
    return { ...terminal, key: state.remoteExpired ? "expired" : snapshot.state, terminal: true, locksEditor: true };
  }

  if (snapshot.resultRevision !== workspace.remoteRevision) {
    return {
      key: `revision:${snapshot.resultRevision}`,
      status: "Newer server changes available",
      message: "Another editor saved newer changes. Editing has been disabled. Reopen the server editor link to continue.",
      title: "Open configs are out of date",
      terminal: false,
      locksEditor: true
    };
  }

  if (snapshot.state === "applying") {
    return {
      key: `applying:${snapshot.resultRevision}`,
      status: "Server is applying changes",
      message: "The Minecraft server is applying this revision. Saving will resume when it finishes.",
      title: "Server is applying changes",
      terminal: false,
      locksEditor: false
    };
  }

  return null;
}

function handleRemoteSnapshot(remoteSession) {
  if (state.remoteSession !== remoteSession || document.body.classList.contains("editor-is-busy")) {
    return;
  }

  const issue = remoteWorkspaceIssue();
  renderStatus();

  if (!issue || issue.key === state.remoteIssueKey) {
    return;
  }

  state.remoteIssueKey = issue.key;

  if (issue.key === "expired") {
    for (const dialog of document.querySelectorAll("dialog[open]")) {
      dialog.close();
    }
    Dropdown.getInstance(elements.saveMenuToggle)?.hide();
    setEditorNavigationDrawerOpen(false, { restoreFocus: false });
    setGuiPreviewExpanded(false, { restoreFocus: false });
    elements.expiredDialog.showModal();
  } else {
    announce(issue.message, true, issue.title);
  }

  if (!issue.locksEditor) {
    return;
  }

  const recovery = state.draftRecovery;
  state.draftRecovery = null;
  void clearRemoteDraft(recovery, { session: issue.terminal });

  if (!issue.terminal) {
    return;
  }

  forgetRemoteEditorLink();
  remoteSession.close();
}

function setBusy(busy, message = "") {
  editorBusy = busy;
  document.body.classList.toggle("editor-is-busy", busy);
  document.body.setAttribute("aria-busy", String(busy));
  elements.navigationToggle.disabled = busy;
  renderSaveAction();

  if (busy && message) {
    elements.changeStatus.textContent = message;
  } else if (!busy && state.workspace) {
    renderStatus();
  }
}

function setSaving(saving, message = "") {
  state.saving = saving;
  elements.saveOverlay.hidden = !saving;
  elements.shell.inert = saving;
  elements.recoveryButtons.forEach((button) => button.disabled = saving || state.downloadingRecovery);
  setBusy(saving, message);

  if (saving) {
    setSavingProgress(message);
    elements.saveStatus.focus();
    return;
  }

  const openerDialog = saveOpener?.closest("dialog");
  const focusTarget = saveOpener?.isConnected
    && !saveOpener.disabled
    && (!openerDialog || openerDialog.open)
    ? saveOpener
    : elements.sectionTitle;
  saveOpener = null;
  focusTarget?.focus();
}

function setSavingProgress(message) {
  elements.saveProgress.textContent = message;
  elements.changeStatus.textContent = message;
}

function confirmDraftRecovery(savedAt) {
  elements.confirmationMessage.textContent = `Unsaved changes from ${formatDate(savedAt, { timeSeparator: " " })} were found on this device. Restore them, or discard them and open the configs currently running on your Minecraft server.`;
  elements.confirmationDialog.returnValue = "";

  return new Promise((resolve) => {
    const preventAccidentalDismissal = (event) => {
      event.preventDefault();
    };
    elements.confirmationDialog.addEventListener("close", () => {
      elements.confirmationDialog.removeEventListener("cancel", preventAccidentalDismissal);
      resolve(elements.confirmationDialog.returnValue === "confirm");
    }, { once: true });
    elements.confirmationDialog.addEventListener("cancel", preventAccidentalDismissal);
    elements.confirmationDialog.showModal();
    elements.confirmationConfirm.focus();
  });
}

async function openRemoteWorkspace() {
  let link;

  try {
    link = await takeRemoteEditorLink();
  } catch (error) {
    announce(error.message, true);
    finishRemoteSessionBootstrap();
    return;
  }

  if (!link) {
    finishRemoteSessionBootstrap();
    return;
  }

  const remoteSession = new RemoteEditorSession(link, {
    onSnapshot() {
      handleRemoteSnapshot(remoteSession);
    }
  });
  const draftRecovery = createRemoteDraftRecovery(link);

  try {
    announce("Opening encrypted configs from your KingdomsX server…", false, "Opening server configs");
    setBusy(true, "Opening encrypted server configs…");
    const artifact = await remoteSession.open();
    let workspace = await openWorkspaceArtifact(artifact);
    let draft = null;

    try {
      draft = await draftRecovery?.load({
        remoteRevision: artifact.remoteRevision,
        expiresAt: remoteSession.snapshot?.expiresAt
      });
    } catch (error) {
      announce(error.message, true, "Local draft unavailable");
    }

    if (draft) {
      const restore = await confirmDraftRecovery(draft.updatedAt);

      if (restore) {
        try {
          workspace = await restoreRemoteWorkspaceDraft(workspace, {
            name: draft.archiveName,
            bytes: draft.archiveBytes
          });
          if (workspace.files.some((session) => session.fileName === draft.activePath)) {
            workspace.activePath = draft.activePath;
          }
        } catch (error) {
          await clearRemoteDraft(draftRecovery);
          draft = null;
          announce(`The local draft could not be restored: ${error.message}`, true, "Local draft discarded");
        }
      } else {
        await clearRemoteDraft(draftRecovery);
        draft = null;
      }
    }

    await loadWorkspace(workspace, { remoteSession, draftRecovery });

    if (draft?.codeDraft) {
      const session = workspace.files.find((candidate) => candidate.fileName === draft.codeDraft.fileName);

      if (session) {
        if (session !== state.session) {
          await activateWorkspaceFile(session.fileName);
        }

        const editor = await loadSourceEditor();
        await setEditorMode("source", { focus: false });
        editor.restoreDraft(session, draft.codeDraft.source);
      }
    }

    if (link.persistenceAvailable === false) {
      announce(
        "The configs opened, but this browser could not save the private session link. Keep the original console link because reloading this tab will not restore the session.",
        true,
        "Reload recovery unavailable"
      );
    } else {
      announce(
        draft
          ? "Restored unsaved configs from this device."
          : "Opened encrypted configs from your KingdomsX server.",
        false,
        draft ? "Local draft restored" : "Server configs opened"
      );
    }
  } catch (error) {
    remoteSession.close();

    if ([404, 410].includes(error?.status)
      || ["cancelled", "expired", "conflicted"].includes(remoteSession.snapshot?.state)) {
      await clearRemoteDraft(draftRecovery, { session: true });
      forgetRemoteEditorLink();
    }

    announce(error.message, true);
  } finally {
    setBusy(false);
    finishRemoteSessionBootstrap();
    renderSessionExpiry();
  }
}

function finishRemoteSessionBootstrap() {
  delete document.documentElement.dataset.editorSessionPending;
}

function scheduleRemoteDraftSave() {
  if (!state.draftRecovery || !state.remoteSession || !state.workspace) {
    return;
  }

  window.clearTimeout(remoteDraftSaveTimer);
  const sequence = ++remoteDraftSequence;
  remoteDraftSaveTimer = window.setTimeout(() => queueRemoteDraftSave(sequence), REMOTE_DRAFT_SAVE_DELAY_MS);
}

function flushRemoteDraftSave() {
  if (!state.draftRecovery || !state.remoteSession || !state.workspace) {
    return;
  }

  window.clearTimeout(remoteDraftSaveTimer);
  queueRemoteDraftSave(remoteDraftSequence);
}

function queueRemoteDraftSave(sequence) {
  remoteDraftWrite = remoteDraftWrite
    .catch(() => {})
    .then(() => persistRemoteDraft(sequence))
    .catch((error) => {
      if (remoteDraftErrorReported) {
        return;
      }

      remoteDraftErrorReported = true;
      announce(`Local draft recovery is unavailable: ${error.message}`, true, "Draft recovery unavailable");
    });
  return remoteDraftWrite;
}

async function persistRemoteDraft(sequence) {
  const recovery = state.draftRecovery;
  const remoteSession = state.remoteSession;
  const workspace = state.workspace;

  if (!recovery || !remoteSession || !workspace) {
    return;
  }

  const codeDraft = sourceEditor?.draftForRecovery() ?? null;

  if (!workspaceHasUnexportedChanges(workspace) && !codeDraft) {
    await recovery.clear();
    return;
  }

  const artifact = await workspaceDownloadArtifact(workspace);
  const archiveBytes = new Uint8Array(await artifact.blob.arrayBuffer());

  if (sequence !== remoteDraftSequence
    || recovery !== state.draftRecovery
    || remoteSession !== state.remoteSession
    || workspace !== state.workspace) {
    return;
  }

  await recovery.save({
    remoteRevision: workspace.remoteRevision,
    expiresAt: remoteSession.snapshot?.expiresAt,
    archiveName: artifact.name,
    archiveBytes,
    activePath: state.session?.fileName,
    editorMode: state.editorMode,
    codeDraft
  });
  remoteDraftErrorReported = false;
}

async function clearRemoteDraft(recovery, { session = false } = {}) {
  if (!recovery) {
    return;
  }

  window.clearTimeout(remoteDraftSaveTimer);
  remoteDraftSequence += 1;

  try {
    remoteDraftWrite = remoteDraftWrite
      .catch(() => {})
      .then(() => session ? recovery.clearSession() : recovery.clear());
    await remoteDraftWrite;
  } catch (error) {
    if (!remoteDraftErrorReported) {
      remoteDraftErrorReported = true;
      announce(`The local draft could not be removed: ${error.message}`, true, "Draft cleanup unavailable");
    }
  }
}

openRemoteWorkspace();

function pluralize(count, word) {
  return `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;
}

function displaySettingPath(path = []) {
  return Array.isArray(path) ? path.join(" → ") : String(path ?? "");
}

function button(label, iconClass, className) {
  const node = element("button", className);
  node.type = "button";
  node.append(element("i", iconClass), document.createTextNode(label));
  return node;
}

function element(tagName, className = "", text = "") {
  const node = document.createElement(tagName);

  if (className) {
    node.className = className;
  }

  if (text) {
    node.textContent = text;
  }

  return node;
}

function appendSemanticBadges(container, owner) {
  const visibleSyntax = owner.syntax && owner.syntax.showBadge !== false ? owner.syntax : null;

  if (!visibleSyntax && !owner.annotations?.length) {
    return;
  }

  const badges = element("span", "editor-semantic-badges d-inline-flex flex-wrap align-items-center gap-1 ms-2");

  if (visibleSyntax) {
    badges.append(semanticBadge(visibleSyntax.label, visibleSyntax.kind));
  }

  for (const annotation of owner.annotations ?? []) {
    const badge = semanticBadge(annotation.label, annotation.id);
    badge.title = annotation.description;
    badges.append(badge);
  }

  container.append(badges);
}

function inheritancePolicyText(annotations = []) {
  if (!annotations.length) {
    return "";
  }

  return `Inheritance rules: ${annotations.map((annotation) => annotation.label).join(", ")}. ${annotations.map((annotation) => annotation.description).join(" ")}`;
}

function semanticBadge(label, kind) {
  return element("span", `editor-pill fw-bold text-nowrap editor-badge editor-badge--syntax editor-badge--${kind} d-inline-flex align-items-center`, label);
}

function announce(message, error = false, title = error ? "Action failed" : "Update complete") {
  showSiteToast({
    container: elements.toastContainer,
    title,
    message,
    kind: error ? "is-error" : "is-success",
    delay: 5000,
    replace: true
  });
}
