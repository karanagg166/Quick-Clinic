/** Private operator files: never follow links, overwrite outputs or log values. */
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  readSync,
  writeFileSync,
  fsyncSync,
  lstatSync,
  unlinkSync,
} from "node:fs";
import { dirname, isAbsolute } from "node:path";

function privateOwned(stat: { uid: number; mode: number }) {
  if (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) {
    throw new Error("Private operator file permissions required.");
  }
}

export function readMedicalReleaseFile(path: string, maxBytes = 65536): string {
  if (!isAbsolute(path)) throw new Error("Absolute operator file path required.");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    privateOwned(stat);
    if (!stat.isFile() || stat.size < 1 || stat.size > maxBytes)
      throw new Error("Invalid operator file.");
    // Bounded reads also protect against a file growing after fstat.
    const bytes = Buffer.alloc(maxBytes + 1);
    let used = 0;
    // readFileSync would allocate the entire file after a concurrent growth.
    while (used <= maxBytes) {
      const length = readSync(fd, bytes, used, bytes.length - used, null);
      if (!length) break;
      used += length;
    }
    if (used < 1 || used > maxBytes) throw new Error("Invalid operator file.");
    return bytes.subarray(0, used).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

export function requireMedicalReleaseDestination(path: string): void {
  if (!isAbsolute(path)) throw new Error("Absolute operator file path required.");
  const parent = lstatSync(dirname(path));
  privateOwned(parent);
  if (!parent.isDirectory() || parent.isSymbolicLink())
    throw new Error("Private output directory required.");
  try {
    lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error("Operator output already exists.");
}

export function writeMedicalReleaseFile(path: string, value: unknown): void {
  requireMedicalReleaseDestination(path);
  const encoded = JSON.stringify(value) + "\n";
  if (Buffer.byteLength(encoded) > 65536) throw new Error("Invalid operator output.");
  const fd = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  let complete = false;
  try {
    writeFileSync(fd, encoded, "utf8");
    fsyncSync(fd);
    complete = true;
  } finally {
    closeSync(fd);
    if (!complete) unlinkSync(path);
  }
}
