/** Middle-ellipsis truncation for import filenames in the batch log. */
export function truncateFilename(name: string, maxLen = 22): string {
  if (name.length <= maxLen) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot) : '';
  const base = dot > 0 ? name.slice(0, dot) : name;
  const budget = maxLen - ext.length - 1;
  if (budget < 4) return `${name.slice(0, maxLen - 1)}…`;
  const head = Math.ceil(budget * 0.45);
  const tail = budget - head;
  return `${base.slice(0, head)}…${base.slice(-tail)}${ext}`;
}
