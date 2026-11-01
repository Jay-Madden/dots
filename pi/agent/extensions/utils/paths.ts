import { isAbsolute, relative, resolve, sep } from "node:path";

export function isWithinDirectory(file: string, directory: string): boolean {
  const relativePath = relative(resolve(directory), resolve(file));
  return relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath));
}
