---
name: Re-registering artifacts after fresh import
description: A GitHub-imported project can contain valid artifact.toml files on disk with no workflows and an empty listArtifacts() — the artifact registry is separate from the files on disk.
---

The artifact registry (workflows, `listArtifacts()`) is populated by explicit registration calls, not by scanning disk for `artifact.toml` files. An imported repo can have complete, valid `.replit-artifact/artifact.toml` files with no corresponding workflows and an empty `listArtifacts()`.

`createArtifact()` can't be used to fix this since it refuses existing directories (`ARTIFACT_DIR_EXISTS`). Registration can instead be triggered as a side effect of `verifyAndReplaceArtifactToml()` — round-tripping the existing toml content (no changes needed) through that call registers the artifact and creates its workflow(s).

**How to apply:** if workflows are missing/unrecognized despite artifact.toml files existing on disk, and `listArtifacts()` returns empty or is missing that artifact, use the `verifyAndReplaceArtifactToml` round-trip to register it before trying to start workflows.
