interface PluginRegistry {
  getPlugin?: (id: string) => unknown;
}

interface FolderNavigator {
  revealFolderPath: (path: string) => Promise<void> | void;
}

/** Mobile can use Duo; desktop retains its original File Focus integration. */
export async function revealInFileFocus(
  registry: PluginRegistry | undefined,
  resolveFolderPath: () => Promise<string>,
  isMobile: boolean
): Promise<string | null> {
  const candidates = isMobile
    ? [["fjg-file-focus-duo", "FJG File Focus Duo"], ["fjg-file-focus", "FJG File Focus"]]
    : [["fjg-file-focus", "FJG File Focus"]];
  for (const [id, name] of candidates) {
    const plugin = registry?.getPlugin?.(id) as Partial<FolderNavigator> | undefined;
    if (typeof plugin?.revealFolderPath !== "function") continue;
    const path = await resolveFolderPath();
    await plugin.revealFolderPath(path);
    return name;
  }
  // Do not create an attachments folder if no compatible navigator is enabled.
  return null;
}
