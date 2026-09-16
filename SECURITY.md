# Security policy

## Supported versions

Only the latest release receives fixes.

## Reporting a vulnerability

Please report security issues privately through GitHub's
[private vulnerability reporting](https://github.com/CR0CKER/logseq-epub-export/security/advisories/new)
rather than a public issue. Include the Logseq version, the graph type (file or
DB) and the steps to reproduce.

## Scope

The plugin runs inside Logseq's plugin sandbox. It reads the open graph through
the plugin API, reads image files from the graph's `assets/` folder (paths are
checked so nothing outside it is read), and writes one EPUB file, either into the graph's
`assets/storages/logseq-epub-export/` folder or into a folder you picked. It makes
no network requests. Graph content is escaped before it is written into the
EPUB's XHTML.
