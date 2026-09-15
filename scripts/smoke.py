#!/usr/bin/env python3
"""Render private JSON test cases; never log URLs, keys, or report text."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--endpoint', required=True)
parser.add_argument('--key-file', required=True)
parser.add_argument('--cases', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--tunnel', action='store_true', help='Local SSH tunnel only: set forwarded HTTPS header')
args = parser.parse_args()
os.umask(0o077)
out = Path(args.output)
out.mkdir(parents=True, exist_ok=True)
headers = {'x-api-key': Path(args.key_file).read_text().strip()}
if args.tunnel:
    headers['x-forwarded-proto'] = 'https'
results = []
for case in json.loads(Path(args.cases).read_text()):
    name = case['name']
    if not re.fullmatch(r'[a-zA-Z0-9_-]+', name):
        raise ValueError('Test names must be safe filenames')
    options = {'url': case['url'], 'emulateScreenMedia': 'false', 'scrollPage': 'true',
               'pdf.format': 'A4', **case.get('options', {})}
    started = time.monotonic()
    result = {'name': name}
    try:
        request = urllib.request.Request(args.endpoint + '?' + urllib.parse.urlencode(options), headers=headers)
        with urllib.request.urlopen(request, timeout=26) as response:
            data = response.read()
            result['status'] = response.status
        result['seconds'] = round(time.monotonic() - started, 2)
        assert data.startswith(b'%PDF-'), 'Response is not a PDF'
        pdf = out / (name + '.pdf')
        pdf.write_bytes(data)
        info = subprocess.check_output(['pdfinfo', str(pdf)], text=True)
        result['pages'] = int(next(line.split(':')[1] for line in info.splitlines() if line.startswith('Pages:')))
        subprocess.run(['pdftotext', str(pdf), str(out / (name + '.txt'))], check=True)
        text = (out / (name + '.txt')).read_text()
        for expected in case.get('expected_text', []):
            assert expected in text, 'Expected report content missing'
        for unexpected in case.get('absent_text', []):
            assert unexpected not in text, 'Unexpected report content present'
        assert result['seconds'] < 25, 'Exceeds Rails read timeout'
        result['bytes'] = len(data)
        result['passed'] = True
    except Exception as error:
        result.update(passed=False, error_type=type(error).__name__)
        if isinstance(error, urllib.error.HTTPError):
            result['status'] = error.code
    results.append(result)
    print(json.dumps(result), flush=True)
    (out / 'summary.json').write_text(json.dumps(results, indent=2) + '\n')
raise SystemExit(0 if all(result['passed'] for result in results) else 1)
