---
name: Bunny Storage provider
description: Current media storage provider and the preserved migration path back to Backblaze B2
---

The primary media storage provider is Bunny Storage Zone via its Edge Storage
API. Uploads and deletes use direct HTTP requests authenticated with the
Storage Zone password in `AccessKey`; public delivery uses the Bunny CDN
hostname. The previous S3-compatible Backblaze B2 adapter is preserved as
legacy reference code rather than being part of the active runtime.

**Why:** Temporary B2 payment limitations require Bunny Storage to be the
active origin while keeping a low-friction path back to B2 later.

**How to apply:** Keep active storage configuration limited to
`BUNNY_STORAGE_ZONE`, `BUNNY_STORAGE_PASSWORD`, and `BUNNY_CDN_HOSTNAME`.