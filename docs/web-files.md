# Files, PDFs and picture uploads on the website (web phase 5)

A browser has no app folders and no share sheet. Three phone-only packages are swapped on the web build (`mobile/metro.config.js`, files in
`mobile/src/web/shims/`), only for the app's own code:

| Package | On the website |
|---|---|
| `expo-file-system` (File, Directory, Paths) | files are kept in memory as Blobs; `File.upload` sends a picked file to its signed storage address; `File.downloadFileAsync` fetches a file |
| `expo-file-system/legacy` (upload with progress) | an XMLHttpRequest upload with a progress number and Cancel |
| `expo-sharing` | "share" = the browser **downloads** the file with its name (PDF invoice, booking receipt, table bill, chat picture, owner sheet) |

So the invoice, the booking receipt, the table bill and exports download as normal files; the phone app is unchanged.

`fileSize(uri)` (utils/common/fileUpload.js) is a Promise on the website (a browser can only measure a picked file by reading it); its five callers
now write `await fileSize(uri)`, which is identical on the phone.

## Needed on the server side before pictures can be uploaded from a website
The browser PUTs the picture **straight to the storage bucket** (Cloudflare R2) with a signed address. The bucket must allow that website:
**R2 bucket > Settings > CORS policy**: allow origins `https://*.vivyaan.co.in` (and `http://localhost:8081` while testing), methods `PUT, GET, HEAD`,
allowed headers `*` (at least `Content-Type`). Without it the browser blocks the upload and the app says "Upload failed".

## Not covered here (later phases)
Voice notes and the camera (browser permissions), owner PDF printing (`expo-print`), rider proof photos (rider phase).

## Test list (browser, logged in as a customer)
1. Orders > an invoice > Download / View: a PDF downloads named `invoice-<no>.pdf`.
2. A table booking receipt and a table bill: the same, as PDFs.
3. Chat with the shop: attach a picture: it uploads and shows (needs the bucket CORS above). Save a picture from the chat: it downloads.
4. Account > profile picture / a complaint photo: picks, uploads, shows.
