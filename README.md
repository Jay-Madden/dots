# My dotfiles

Personal configuration files.

## macOS install

```bash
git clone --recursive https://github.com/Jay-Madden/dots "${XDG_CONFIG_HOME:-$HOME/.config}"
cd "${XDG_CONFIG_HOME:-$HOME/.config}"
./mac_install.sh
exec zsh
```

The script installs Homebrew if needed, applies `Brewfile`, and configures `~/.zshenv`.
