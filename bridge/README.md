# Semester OS local bridge

Run `npm run bridge` with `SEMESTER_VAULT` set to your normal folder, for example PowerShell:

`$env:SEMESTER_VAULT='C:\Users\me\Semester Vault'; npm run bridge`

The bridge binds to `127.0.0.1` only, serves PDF files only from that vault, and never uploads originals. The library uses `/api/resources` and `/api/file`; PDF.js/browser PDF rendering handles viewing and page navigation. `pdfinfo` is optional and adds page counts when installed.
