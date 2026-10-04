import { createSourceDocument, documentBytes } from "./yaml-source.js";

export function createFileSession(fileName, bytes, example = false) {
  return {
    fileName,
    originalFileName: fileName,
    downloadName: editedFileName(fileName),
    document: createSourceDocument(fileName, bytes),
    created: false,
    example,
    exported: false
  };
}

export function fileSessionHasChanges(session) {
  return Boolean(session && (
    session.created
      || session.originalFileName !== session.fileName
      || session.document?.changes.size
  ));
}

export function renameFileSession(session, fileName) {
  session.fileName = fileName;
  session.downloadName = editedFileName(fileName);
  session.document.fileName = fileName;
  session.exported = false;
}

export function fileSessionBlob(session) {
  return new Blob([documentBytes(session.document)], { type: "text/yaml;charset=utf-8" });
}

function editedFileName(fileName) {
  return fileName.replace(/(\.ya?ml)$/i, "-edited$1");
}
