#!/bin/sh
set -eu

if [ "${1-}" = "zellij" ] && { [ ! -t 0 ] || [ ! -t 1 ]; }; then
    printf '\033[38;2;195;64;67mERROR:\033[0m %s\n' \
        'Zellij requires an interactive terminal.' \
        'Run: docker run --rm -it ghcr.io/jay-madden/dots/shell:latest' \
        'To run without a terminal, pass a command after the image name.' >&2
    exit 1
fi

exec "$@"
