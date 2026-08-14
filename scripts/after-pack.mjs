import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

export default async function stageCuaSdk(context) {
  if (context.electronPlatformName !== "darwin") return;
  const source = path.join(context.packager.projectDir, "build/cua-sdk");
  const destination = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    "Contents/Resources/cua-sdk",
  );
  await rm(destination, { recursive: true, force: true });
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, dereference: true });
}
