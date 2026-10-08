/** Compact exact revision for immutable strings and scalar geometry. Keeps one
 * snapshot, without hashing or serializing image payloads on reactive updates. */
export function createValueRevision() {
  let previous: readonly unknown[] = [], revision = 0;
  return (values: readonly unknown[]): number => {
    if (values.length !== previous.length || values.some((value, index) => !Object.is(value, previous[index]))) {
      previous = [...values]; revision++;
    }
    return revision;
  };
}
