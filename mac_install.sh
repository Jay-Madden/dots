#!/usr/bin/env bash

set -euo pipefail

info() {
    printf '\033[1;34mINFO\033[0m %s\n' "$*"
}

error() {
    printf '\033[1;31mERROR\033[0m %s\n' "$*" >&2
}

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
config_home="${XDG_CONFIG_HOME:-$HOME/.config}"
zshenv="$HOME/.zshenv"

if [[ "$repo_dir" != "$config_home" ]]; then
    error "This repository must be installed at $config_home."
    error "Current repository path: $repo_dir"
    exit 1
fi

brew_bin="/opt/homebrew/bin/brew"
if [[ ! -x "$brew_bin" ]]; then
    info "Homebrew was not found. Installing it now."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

if [[ ! -x "$brew_bin" ]]; then
    error "Homebrew installation completed, but brew could not be found."
    exit 1
fi

"$brew_bin" bundle --file "$repo_dir/Brewfile"

if [[ ${XDG_CONFIG_HOME:-} == "$repo_dir" && ${ZDOTDIR:-} == "$repo_dir/zsh" ]]; then
    info "The dots environment is already configured."
else
    cat >> "$zshenv" <<'EOF'

# BEGIN dots bootstrap
export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
export ZDOTDIR="${ZDOTDIR:-$XDG_CONFIG_HOME/zsh}"
source "$ZDOTDIR/.zshenv"
# END dots bootstrap
EOF
    info "Configured $zshenv to load the repository zsh configuration."
fi

source "$zshenv"
info "Installation complete. Start a new shell with: exec zsh"
