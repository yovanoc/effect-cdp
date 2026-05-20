export function emitJSDoc(item: {
  readonly description?: string;
  readonly deprecated?: boolean;
  readonly experimental?: boolean;
}): string {
  const tags: Array<string> = [];

  if (item.deprecated === true) {
    tags.push("@deprecated");
  }

  if (item.experimental === true) {
    tags.push("@experimental");
  }

  if (tags.length === 0) {
    return "";
  }

  const description = item.description?.trim();
  return description === undefined || description.length === 0
    ? `/** ${tags.join(" ")} */`
    : `/** ${tags.join(" ")} ${description} */`;
}
