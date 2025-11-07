use std/util "path add"

# Initialize XDG variables
$env.XDG_CONFIG_HOME = $"($env.HOME)/.config"
$env.XDG_DATA_HOME = $"($env.HOME)/.local/share"

# Setup neovim as the preferred editor
let editor = "nvim"
$env.EDITOR = $editor
$env.config.buffer_editor = $editor

# Configure vim mode
$env.config.edit_mode = 'vi'
$env.config.cursor_shape = {
    vi_insert: line
    vi_normal: block
    emacs: line
}

$env.LS_COLORS = (vivid generate snazzy)

# Set up wezterm
$env.WEZTERM_CONFIG_DIR = $"($env.HOME)/.config/wezterm"
$env.WEZTERM_CONFIG_FILE = $"($env.HOME)/.config/wezterm/wezterm.lua"

# Add homebrew to PATH
path add /opt/homebrew/bin

# Add GO to PATH
path add /usr/local/go/bin

# Add krew to PATH
let krew_root = ($env.KREW_ROOT? | default ($env.HOME | path join ".krew"))
path add ($krew_root | path join "bin")

# Setup atuin
mkdir ($nu.data-dir | path join "vendor/autoload")
# atuin init nu | save -f ($nu.data-dir | path join "vendor/autoload/atuin.nu")
source ./modules/atuin.nu

# Setup zoxide
mkdir ($nu.data-dir | path join "vendor/autoload")
zoxide init nushell | save -f ($nu.data-dir | path join "vendor/autoload/zoxide.nu")

# Setup starship
mkdir ($nu.data-dir | path join "vendor/autoload")
starship init nu | save -f ($nu.data-dir | path join "vendor/autoload/starship.nu")
