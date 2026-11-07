#!/bin/sh
set -eu
image="${1:-archiver:local}"
digest="$(docker image inspect "$image" --format '{{index .RepoDigests 0}}')"
id="$(docker image inspect "$image" --format '{{.Id}}')"
node --input-type=module -e "
import { readFileSync, writeFileSync } from 'node:fs';
const file = 'docs/dependency-inventory.json';
const inventory = JSON.parse(readFileSync(file, 'utf8'));
inventory.images = [{ name: process.argv[1], dockerfile: 'Dockerfile', digest: process.argv[2], imageId: process.argv[3] }];
writeFileSync(file, JSON.stringify(inventory, null, 2) + '\n');
" "$image" "${digest:-$id}" "$id"
echo "recorded ${digest:-$id}"
