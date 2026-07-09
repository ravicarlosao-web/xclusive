---
name: Xclusive KYC flow
description: Creator verification flow — 6 steps, live camera only, mock auto-approval
---

Route: /tornar-criador (FullscreenProtectedRoute — no AppLayout sidebar)
Entry points: profile.tsx "Tornar-se Criador" button (pessoal only), AppLayout.tsx sidebar callout (pessoal only)

**Steps:** intro → personal → document → selfie → liveness → review → success

**Camera component:** artifacts/xclusive/src/components/shared/CameraCapture.tsx
- Uses getUserMedia({ video: { facingMode: { ideal: ... } } }) — never file input
- Props: facingMode ('user'|'environment'), overlay ('document'|'face'|'face-document'|'none'), manualMode, captureSignal
- Stream cleanup: tracks stopped on capture, retake, and unmount
- Overlays: CSS mask-based vignette + bordered guide rectangle/oval
- Error states: 'denied' (browser blocked), 'not-found' (no camera), 'general'

**Liveness check:** 3 challenges sequential — first auto (2.5s timer), 2 and 3 require user button press. After final challenge, captureSignal increments → CameraCapture auto-captures via manualMode+captureSignal pattern.

**Age gate:** enforced in personal step validatePersonal() — calculateAge(dob) < 18 blocks progression.

**Mock auto-approval:** isMockMode check gates updateTipoConta('criador') — production does NOT auto-promote (submission queued for review).

**updateTipoConta:** defined in AuthContext — updates mock localStorage store + in-memory mockUser state + invalidates /api/auth/me query. Production path: invalidation only (backend webhook would set it).

**Why live camera only:** KYC requirement is to detect real documents and real presence. Gallery photos bypass liveness checks.
