export function normalizeProjectPickerText(value: string): string {
  return String(value || "")
    .toLocaleLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function filterProjectPickerOptions(projectNames: readonly string[], query: string): string[] {
  const clean = normalizeProjectPickerText(query);
  const tokens = clean.split(" ").filter(Boolean);
  return [...new Map(projectNames
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => [normalizeProjectPickerText(name), name]))
    .values()]
    .filter((name) => {
      const normalizedName = normalizeProjectPickerText(name);
      return tokens.every((token) => normalizedName.includes(token));
    })
    .sort((left, right) => left.localeCompare(right));
}

export function projectPickerCreationError(projectNames: readonly string[], value: string): string {
  const name = String(value || "").replace(/\s+/g, " ").trim();
  if (!name) return "Enter a project name to create it.";
  const key = normalizeProjectPickerText(name);
  if (projectNames.some((project) => normalizeProjectPickerText(project) === key)) {
    return `Project already exists: ${name}`;
  }
  return "";
}
