// M5.6: normalizes a pasted Google Drive share link into a canonical
// webViewLink and the underlying file id. Accepts the two share-link
// shapes Drive actually produces ("/file/d/{id}/view..." for a single
// file, "?id={id}" for a folder/legacy link) — pure and unit-testable,
// same "parse, don't just store the raw string" approach the rest of the
// codebase takes with external URLs.
const FILE_D_PATTERN = /^https:\/\/drive\.google\.com\/file\/d\/([^/]+)/;
const OPEN_ID_PATTERN = /^https:\/\/drive\.google\.com\/open\?id=([^&]+)/;

export interface ParsedDriveLink {
  fileId: string;
  canonicalUrl: string;
}

export function parseDriveLink(url: string): ParsedDriveLink {
  const trimmed = url.trim();
  const match = FILE_D_PATTERN.exec(trimmed) ?? OPEN_ID_PATTERN.exec(trimmed);
  if (!match) {
    throw new Error(
      "That doesn't look like a Google Drive share link (expected drive.google.com/file/d/... or drive.google.com/open?id=...)",
    );
  }
  const fileId = match[1]!;
  return { fileId, canonicalUrl: `https://drive.google.com/file/d/${fileId}/view` };
}
