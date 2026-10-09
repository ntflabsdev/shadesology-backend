# Backend Services

This folder contains adapter wrappers for every external service.
Each adapter has a `sandbox` / `live` switch controlled by an env var.

| File | Service | Switch env var |
|---|---|---|
| `s3.js` | Amazon S3 (dual-bucket) | `AWS_*` vars present/absent |
| `email.js` | Amazon SES (transactional email) | `SES_MODE=sandbox\|live` |
| `orderNotifications.js` | Queued order confirmations, lifecycle, tracking, and customer-request emails | `SES_*` + Redis/BullMQ |
| `hubspot.js` | HubSpot CRM + consent-gated marketing subscriptions | `HUBSPOT_MODE=sandbox\|live` |
| `financing.js` | Financing payment estimates, hosted application URL, signed callback validation | `FINANCING_MODE=sandbox\|live` |
| `chat.js` | Business-hours status and live/offline routing decision for support messages | `CHAT_BUSINESS_TIMEZONE` |
| `leadRouting.js` | Admin-configurable lead recipient selection | Lead routing rules + `LEADS_NOTIFY_EMAIL` fallback |

## Email routing rule

| Type | Route through |
|---|---|
| Order confirmations, status updates, password reset, quote status, lead notifications, onboarding sequences, review requests, maintenance reminders, internal alerts | **`email.js` → Amazon SES** |
| Newsletter, welcome flow, abandoned cart/quote recovery, campaigns, post-purchase marketing | **HubSpot Marketing Email** (configured in Prompt 1.22) |

Never mix these — sending marketing through SES pollutes your sender reputation and sending transactional through HubSpot can delay critical customer messages.

## Order communications and customer requests

- Order confirmations/status changes and shipment tracking messages are queued to the `email` BullMQ queue; `emailWorker` delivers them through the SES adapter with retry/backoff.
- Quote prices are stored in cents; conversion normalizes them to the dollar-valued Order model so checkout, email, account views, and exports use the same units.
- The confirmation includes each order line's locked options, SKU, quantities, and surcharge detail. Shipping status notifications include carrier, tracking URL/number, and estimated delivery when supplied by staff.
- Staff order management is available at `/admin/orders`; production can download the complete option snapshot as CSV. Marking an order shipped requires a tracking number.
- Customers can request cancellation before production/shipment begins and request a return after delivery. Cancellation requests for made-to-order items close when production starts; made-to-order returns are reviewed case-by-case. Requests are recorded and staff-reviewed; a request does not automatically cancel an order or issue a refund. Staff handle refunds through the existing refund workflow.
- Signed-in customers can submit requests in `/account/orders`; guest customers can track and submit a request through `/support/orders` using the order number and email.

## Financing and leasing

- Payment estimates are available on product, category, cart, and checkout pages; they are estimates and do not constitute credit approval or an order payment.
- Scheduled offers are managed at `/admin/financing-offers` and are returned only when active and within their configured start/end times and amount range. Enter lender disclosures verbatim.
- The current GreenSky integration is a configurable hosted-application handoff, not a lender-specific API implementation. Confirm the lender-provided hosted URL parameters, callback signature convention, return behavior, and terms before enabling live mode.
- Configure `FINANCING_MODE`, `FINANCING_MERCHANT_ID`, `FINANCING_APPLICATION_URL_SANDBOX` / `FINANCING_APPLICATION_URL_LIVE`, and `FINANCING_WEBHOOK_SECRET` in the backend environment. Keep merchant credentials and callback secrets server-side.
- The return page displays status recorded by the signed provider callback; a browser redirect cannot approve an application. Reported approval is informational and does not create, settle, or mark an order paid. Checkout continues to use its configured card/bank-transfer payment methods.
- When the provider handoff is not configured or financing options cannot be loaded, customers retain the static payment estimate and see a clear unavailable message. Commercial lease inquiries are recorded locally and queued to the configured staff email.

## Support, documents, and lead capture

- Contact, service, dealer, installer, and chat requests are stored in the `leads` collection before notification/autoresponder queueing. Quote and warranty-registration requests are first stored in their dedicated collections; notification failures are logged without removing those records.
- Configure recipient rules at `/admin/leads` by enquiry type, product, and region. Most-specific matching rules win; unmatched enquiries use `LEADS_NOTIFY_EMAIL` (then SES reply/from address). Chat applies `CHAT_BUSINESS_HOURS_NOTIFY_EMAIL` or `CHAT_OFFLINE_NOTIFY_EMAIL` based on the configured `CHAT_BUSINESS_TIMEZONE` business schedule, and includes sanitized page/cart context in the agent notification.
- Chat messages remain available outside business hours and are routed as offline messages. `CHAT_PROVIDER` identifies the intended vendor, but the deployment still needs a vendor-specific widget/API integration if live vendor chat is required; credentials alone do not activate that external SDK.
- Service photos are limited to supported image formats and 10 MB per image, uploaded to the private S3 bucket, and accessible to staff only through short-lived signed links in the admin lead queue.
- FAQ search uses the published, active FAQ store and returns tagged results; FAQ JSON-LD includes only records configured with `includeInSchema`. Public manuals respect effective/expiry dates and display version history and product/model associations. Gated resources do not expose their private file URLs in public API responses.
- Warranty registration persists the product model and installation date in `warranty_registrations` and routes a support notification after persistence.
- Commercial project enquiries use `POST /api/content/commercial/enquiries`; they are stored in the `commercial` lead queue with a commercial flag before SES notification and HubSpot sync. They do not appear in the consumer queue. Configure a separate recipient rule for `commercial_project`.
- Project drawings and plans use `POST /api/content/commercial/upload-url`, upload directly to the private S3 bucket, and are available only to staff through short-lived signed links. Up to ten files (100 MB each) are accepted; file metadata is checked again before the lead is stored.
- HubSpot commercial lead sync uses the shared retryable CRM worker, sets `shadesology_commercial_flag`, associates the company when supplied, and creates a deal in `HUBSPOT_COMMERCIAL_PIPELINE_ID` at `HUBSPOT_COMMERCIAL_STAGE_ID`. Run `npm run hubspot:setup` to provision integration properties and configure those pipeline/stage IDs in the backend environment.

## Installer network and portal

- Applicants register/sign in first, then submit an installer application through `POST /api/installers/apply`. Applications use the shared `ApprovalRequest` workflow; approval activates the linked installer profile, grants the installer role, and queues approval/onboarding emails. Insurance expiry is required and expired applications cannot be approved or receive new leads.
- Installer license/insurance files use `POST /api/installers/application-upload-url`, are uploaded directly to the private S3 bucket, and are verified by object metadata before their keys are attached to the application. Staff download files through `/admin/installers/applications/:id/documents/:index`, which generates a five-minute signed URL.
- Public search is `GET /api/installers/search?postcode=...` or `?q=...`. Postcode coverage uses normalized rules; city/state search is fuzzy. Radius overlap and distance sorting (`sort=distance&lat=...&lng=...`) require coordinates supplied on coverage rules and the search. Ranking order uses the staff-managed `rankingScore`; `sort=ranking` is the default.
- Quote and service-request leads remain in the central `leads` collection and are offered one at a time to an eligible installer. The installer sees a redacted preview before accepting; only the assigned installer can accept, decline, update that job, or edit their coverage. Declining offers the lead to the next eligible installer. Customer contact details are returned only after acceptance.
- Technical document access checks the installer's product certifications both in the portal and on the shared document-download endpoint. Staff manage certification product types and ranking on `/admin/installers`; lead-flow totals and response rates are available from `/admin/installers/lead-flow`.
- Third-party referral handoff is configured per region with `GET/PUT /admin/installers/referrals`. Turning a region off is an admin action: set `enabled` to `false`; no code or deployment change is needed. Public referral clicks are counted by `POST /api/installers/referrals/:region/click`. Queue delayed onboarding emails in production with Redis/BullMQ enabled.

## S3 bucket rules

- **Public bucket** (`S3_BUCKET_PUBLIC`): CMS media, product images. Files served directly via `S3_PUBLIC_BASE_URL`. Block Public Access should be **OFF**.
- **Private bucket** (`S3_BUCKET_PRIVATE`): Customer photos, drawings, gated documents, quote PDFs, production exports. Block Public Access **ON**. Files served **only** via short-lived signed URLs generated after an access check.

Quote attachments are uploaded to the private bucket under the `quotes/pending` prefix. The API verifies each uploaded object before linking it to the quote; staff access uses short-lived signed download URLs. Quote validity is configured with `QUOTE_EXPIRY_DAYS` (default 30), and the pre-expiry reminder window with `QUOTE_FOLLOWUP_DAYS` (default 3).

Browser uploads use short-lived S3 presigned POST policies that bind the content type and enforce a server-selected maximum object size. Configure the private bucket CORS policy for only the deployed frontend origins, `POST`, and required headers; do not enable public read access on the private bucket.

## Queue pattern

All outbound calls (email, CRM sync) must go through a BullMQ queue for retry:

```js
const { getQueue } = require('../queues');
await getQueue('email').add('send', { to, subject, html, text });
```

Never call `email.send()` directly in a request handler for customer-facing emails — use the queue so failures are automatically retried.

## Inspiration, project gallery, and video library

- Published inspiration images, projects/case studies, and hosted videos are served from `/api/inspiration`, `/api/projects`, and `/api/videos`. The configured editorial source (`EDITORIAL_CONTENT_SOURCE`) selects Payload CMS or the Mongoose content models.
- Staff manage Payload-backed records in the Content group in Payload Admin. Mongoose-backed staff CRUD endpoints are `/admin/inspiration-items`, `/admin/projects`, and `/admin/videos`; all are protected by the shared staff-role guard.
- The bulk inspiration uploader is `/admin/inspiration`. It uploads image files through the existing Payload Media collection (which generates resized renditions), then persists tagged records in the configured editorial source.
- Videos are references, not uploads: only an HTTPS YouTube, Vimeo, or Wistia video URL is required. The database stores that URL and the public library, product pages, and guide/resource pages fetch and embed the saved record. Optional title, category, thumbnail, chapter, transcript, caption, and product links enrich it.
- Project records can include before/after images, segment/product links, installer attribution, quantified metrics, energy-savings notes, and case-study content. The public project detail page supports browser print-to-PDF.
