/** Check IFCDC name drift against the document-backed name; never rewrite historical drafts. */
export function grantOrganizationNameWarnings(content: string, legalName: string | undefined): string[] {
  if (!legalName) return [];
  const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
  const expected = normalize(legalName);
  const names = content.match(/Imperial\s+Foundation\s+Community\s+Development\s+(?:Center|Corporation)\b/gi) ?? [];
  return names.some((name) => !expected.includes(normalize(name)))
    ? ["The narrative uses an IFCDC organization name that conflicts with the verified legal name. Correct it against the supporting document before approval."] : [];
}
