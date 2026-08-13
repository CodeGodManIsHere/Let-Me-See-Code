# Privacy statement

Let Me See Code has no server component and sends no captures, browsing history, analytics or telemetry. ZIP creation and download happen locally through Chrome.

Capture begins only after the user presses a capture button. The selected tab is pinned by ID for that run. Closing the popup or switching tabs/windows does not broaden or retarget access. Deep capture uses Chrome's debugger API, so Chrome shows its standard debugging notice until completion, cancellation or failure.

Fast and Max can issue same-origin GET requests to preserve browser-exposed resources and discover sitemap, router and public WordPress route metadata. Max rejects action-style, payment, account, subscription and token-bearing routes before automatic navigation. The safe interaction explorer excludes forms, links, destructive controls, purchase actions, authentication actions and submission-like controls, and restores reversible controls after recording their revealed state. It does not fill or submit forms.

The extension applies best-effort redaction to passwords, recognized secrets, authentication-header values, cookie values, secret URL parameters, JSON secret keys, framework/application state and POST bodies. It may record cookie names and flags, header type/length/SHA-256 fingerprints, CSRF field fingerprints, and password-field attributes, but not reusable cookie/header/CSRF values or passwords. The dedicated form-validation inventory records constraints, validity flags, labels and relationships without reading entered control values. Aggregate key counts and pointer heatmaps never include actual keys, typed text or clipboard content. Password-manager values, browser-autofill values, client keys and authentication credentials are intentionally not collected. No automatic redactor can recognize every sensitive value in ordinary page text or application records; inspect each archive before sharing it.

Fast and Max can also preserve bounded OPFS/WebSQL content, SSE/WebRTC messages, graphics buffers/shaders, source-map content and ordinary application data exposed to the captured page. Textual payloads receive best-effort secret redaction; binary payloads cannot be reliably classified. Collector manifests state size/count limits and omissions.

Local extension storage contains settings, capture timing history, the complete activity logs for the two newest capture tasks, and current/last capture status. It is not uploaded or shared. Cancelling a run discards the unfinished local archive stream.

The extension does not grant rights to reproduce third-party source code, media, trademarks or content.
