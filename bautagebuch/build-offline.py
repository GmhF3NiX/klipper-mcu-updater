#!/usr/bin/env python3
"""Baut aus bautagebuch.html eine eigenständige Offline-Datei (bautagebuch-offline.html)."""
from pathlib import Path

here = Path(__file__).parent
page = (here / 'bautagebuch.html').read_text(encoding='utf-8')
shim = (here / 'offline-shim.js').read_text(encoding='utf-8')

split = page.index('<style>')
head, body = page[:split], page[split:]
head = head.replace('<title>Bautagebuch EG</title>', '<title>Bautagebuch EG (offline)</title>')

out = f'''<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#06080a">
{head.strip()}
<style>[hidden]{{display:none!important}}img{{max-width:100%}}body{{margin:0}}</style>
<script>
{shim}
</script>
</head>
<body>
{body.strip()}
</body>
</html>
'''
(here / 'bautagebuch-offline.html').write_text(out, encoding='utf-8')
print('geschrieben:', here / 'bautagebuch-offline.html', f'({len(out) // 1024} KB)')
