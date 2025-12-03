use std/util "path add"

# Initialize XDG variables
$env.XDG_CONFIG_HOME = $"($env.HOME)/.config"
$env.XDG_DATA_HOME = $"($env.HOME)/.local/share"

# Setup neovim as the preferred editor
let editor = "nvim"
$env.EDITOR = $editor
$env.config.buffer_editor = $editor
alias vim = nvim

$env.config.show_banner = false

# Configure vim mode
$env.config.edit_mode = 'vi'
$env.config.cursor_shape = {
    vi_insert: line
    vi_normal: block
    emacs: line
}

$env.LS_COLORS = (vivid generate catppuccin-macchiato)

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

# $env.CARAPACE_BRIDGES = 'zsh,fish,bash,inshellisense' # optional
# mkdir ($nu.data-dir | path join "vendor/autoload")
# carapace _carapace nushell | save -f ($nu.data-dir | path join "vendor/autoload/carapace.nu")
# $env.config.menus ++= [
#    {
#     name: completion_menu
#     only_buffer_difference: false   # Search is done on the text written after activating the menu
#     marker: ""                      # Indicator that appears with the menu is active
#     type: {
#       layout: columnar              # Type of menu
#       columns: 1                    # Number of columns where the options are displayed
#       col_padding: 2                # Padding between columns
#     }
#     style: {
#       text: green                   # Text style
#       selected_text: green_reverse  # Text style for selected option
#       description_text: yellow      # Text style for description
#     }
#   }
# ]
# $env.config.completions.external.enable = true
#
# $env.config.completions.external.completer = {|spans|
#   echo "hi"
#   let expanded_alias = scope aliases | where name == $spans.0 | get 0?.expansion?
#
#   let spans = if $expanded_alias != null  {
#     $spans | skip 1 | prepend ($expanded_alias | split row " " | take 1)
#   } else {
#     $spans
#   }
#
#   let completions = try { ^carapace $spans.0 nushell ...$spans } catch { "[]" }
#   let completions = $completions | from json
#
#   if ($completions | length) == 1 {
#     $completions
#   } else if ($completions | length) > 0 {
#     let width = $completions | get display? | str length | math max
#
#     let formatted = (
#       $completions
#       | each {
#         (
#           $"(ansi --escape ($in.style? | default { fg: green }))($in.display? | default "" | fill -w $width)(ansi reset)  " ++
#           $"(ansi --escape ($in.style? | default { fg: yellow }))($in.description? | default "")(ansi reset)"
#         )
#       }
#       | str join "\n"
#     )
#
#     let result = $formatted | try { fzf --ansi --bind 'enter:become(echo {n})' --bind 'tab:become(echo {n})' }
#
#     if $result != null {
#       [($completions | get ($result | into int))]
#     } else {
#       [{ value: "" }]
#     }
#   } else {
#     null
#   }
# }
#
# $env.config.keybindings ++= [
#   {
#     name: completion_menu
#     modifier: none
#     keycode: tab
#     mode: [emacs, vi_normal, vi_insert]
#     event: {
#       until: [
#         { send: menu name: completion_menu }
#         { send: enter }
#       ]
#     }
#   }
# ]

$env.PATH = ($env.PATH | split row (char esep) | where { $in != "/Users/jcox/.config/carapace/bin" } | prepend "/Users/jcox/.config/carapace/bin")

def --env get-env [name] { $env | get $name }
def --env set-env [name, value] { load-env { $name: $value } }
def --env unset-env [name] { hide-env $name }

let carapace_completer = {|spans|
  load-env {
    CARAPACE_SHELL_BUILTINS: (help commands | where category != "" | get name | each { split row " " | first } | uniq  | str join "\n")
    CARAPACE_SHELL_FUNCTIONS: (help commands | where category == "" | get name | each { split row " " | first } | uniq  | str join "\n")
  }
  return [{ value: "bark" }]

  # if the current command is an alias, get it's expansion
  let expanded_alias = (scope aliases | where name == $spans.0 | $in.0?.expansion?)

  # overwrite
  let spans = (if $expanded_alias != null  {
    # put the first word of the expanded alias first in the span
    $spans | skip 1 | prepend ($expanded_alias | split row " " | take 1)
  } else {
    $spans | skip 1 | prepend ($spans.0)
  })

  let completions = try { ^carapace $spans.0 nushell ...$spans } catch { '["hi"]' }
  let completions = $completions | from json

  return $completions
}

mut current = (($env | default {} config).config | default {} completions)
$current.completions = ($current.completions | default {} external)
$current.completions.external = ($current.completions.external
| default true enable
# backwards compatible workaround for default, see nushell #15654
| upsert completer { if $in == null { $carapace_completer } else { $in } })

$env.config = $current

# Setup starship
mkdir ($nu.data-dir | path join "vendor/autoload")
starship init nu | save -f ($nu.data-dir | path join "vendor/autoload/starship.nu")
$env.STARSHIP_SHELL = "nu"
$env.PROMPT_INDICATOR_VI_INSERT = ""
$env.PROMPT_INDICATOR_VI_NORMAL = ""
$env.PROMPT_MULTILINE_INDICATOR = "::: "
