---
name: Package Firewall tsx constraint
description: The workspace Package Firewall blocks newer tsx tarballs; the working lockfile uses the cached 4.22.4 release.
---

When dependency installation fails on `tsx`, do not bypass the Package Firewall or force the newest release. The workspace can resolve and install the cached `tsx@4.22.4`; align the catalog and the `@esbuild-kit/esm-loader` override to that exact version before regenerating the lockfile offline.

**Why:** The registry returned HTTP 403 for newer `tsx` tarballs, while the four artifact workflows only need the already-cached toolchain and continue to run correctly with `4.22.4`.

**How to apply:** Check the lockfile and local pnpm store first, keep `tsx` pinned to the available safe version, run `pnpm install --offline --ignore-scripts`, then restart all affected artifact workflows and inspect their startup logs.