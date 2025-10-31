# If you come from bash you might have to change your $PATH.
# export PATH=$HOME/bin:/usr/local/bin:$PATH

# Path to your oh-my-zsh installation.
export ZSH="$HOME/.oh-my-zsh"

#Add dotnet to $PATH
export PATH="/usr/local/share/dotnet:$PATH"

# Add dotnet tools to path
export PATH="$PATH:$HOME/.dotnet/tools"

#Add GO to $PATH
export PATH="$PATH:/usr/local/go/bin"

# Add nvm to path
export NVM_DIR="$([ -z "${XDG_CONFIG_HOME-}" ] && printf %s "${HOME}/.nvm" || printf %s "${XDG_CONFIG_HOME}/nvm")"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" # This loads nvm

# Run onefetch when we navigate to a new repo
LAST_REPO=""
cd() { 
    builtin cd "$@";
    git rev-parse 2>/dev/null;

    if [ $? -eq 0 ]; then
        if [ "$LAST_REPO" != $(basename $(git rev-parse --show-toplevel)) ]; then
        onefetch
        LAST_REPO=$(basename $(git rev-parse --show-toplevel))
        fi
    fi
}


# Add vscode to PATH
export PATH="$PATH:/Applications/Visual Studio Code.app/Contents/Resources/app/bin"
alias code="/Applications/Visual\ Studio\ Code.app/Contents/Resources/app/bin/code"

# zsh-vim configs
ZVM_VI_INSERT_ESCAPE_BINDKEY=jj

# Set name of the theme to load --- if set to "random", it will
# load a random theme each time oh-my-zsh is loaded, in which case,
# to know which specific one was loaded, run: echo $RANDOM_THEME
# See https://github.com/ohmyzsh/ohmyzsh/wiki/Themes
# ZSH_THEME="spaceship"

# Enable kubernetes support in prompt
# SPACESHIP_KUBECTL_SHOW=true
# SPACESHIP_KUBECTL_CONTEXT_SHOW=true
# SPACESHIP_KUBECTL_VERSION_SHOW=false

# Initialize starship prompt
eval "$(starship init zsh)"
export STARSHIP_CONFIG="$HOME/.config/zsh/starship.toml"


# Set list of themes to pick from when loading at random
# Setting this variable when ZSH_THEME=random will cause zsh to load
# a theme from this variable instead of looking in $ZSH/themes/
# If set to an empty array, this variable will have no effect.
# ZSH_THEME_RANDOM_CANDIDATES=( "robbyrussell" "agnoster" )

# Uncomment the following line to use case-sensitive completion.
# CASE_SENSITIVE="true"

# Uncomment the following line to use hyphen-insensitive completion.
# Case-sensitive completion must be off. _ and - will be interchangeable.
# HYPHEN_INSENSITIVE="true"

# Uncomment one of the following lines to change the auto-update behavior
# zstyle ':omz:update' mode disabled  # disable automatic updates
# zstyle ':omz:update' mode auto      # update automatically without asking
# zstyle ':omz:update' mode reminder  # just remind me to update when it's time

# Uncomment the following line to change how often to auto-update (in days).
# zstyle ':omz:update' frequency 13

# Uncomment the following line if pasting URLs and other text is messed up.
# DISABLE_MAGIC_FUNCTIONS="true"

# Uncomment the following line to disable colors in ls.
# DISABLE_LS_COLORS="true"

# Uncomment the following line to disable auto-setting terminal title.
# DISABLE_AUTO_TITLE="true"

# Uncomment the following line to enable command auto-correction.
# ENABLE_CORRECTION="true"

# Uncomment the following line to display red dots whilst waiting for completion.
# You can also set it to another string to have that shown instead of the default red dots.
# e.g. COMPLETION_WAITING_DOTS="%F{yellow}waiting...%f"
# Caution: this setting can cause issues with multiline prompts in zsh < 5.7.1 (see #5765)
COMPLETION_WAITING_DOTS="true"

# Uncomment the following line if you want to disable marking untracked files
# under VCS as dirty. This makes repository status check for large repositories
# much, much faster.
# DISABLE_UNTRACKED_FILES_DIRTY="true"

# Uncomment the following line if you want to change the command execution time
# stamp shown in the history command output.
# You can set one of the optional three formats:
# "mm/dd/yyyy"|"dd.mm.yyyy"|"yyyy-mm-dd"
# or set a custom format using the strftime function format specifications,
# see 'man strftime' for details.
# HIST_STAMPS="mm/dd/yyyy"

# Would you like to use another custom folder than $ZSH/custom?
# ZSH_CUSTOM=/path/to/new-custom-folder

# Which plugins would you like to load?
# Standard plugins can be found in $ZSH/plugins/
# Custom plugins may be added to $ZSH_CUSTOM/plugins/
# Example format: plugins=(rails git textmate ruby lighthouse)
# Add wisely, as too many plugins slow down shell startup.
plugins=(
    git
    dotnet
    fzf-tab
    zsh-autosuggestions
    zsh-vi-mode
    zsh-syntax-highlighting
)

# Setup completions
fpath+=${ZSH_CUSTOM:-${ZSH:-~/.oh-my-zsh}/custom}/plugins/zsh-completions/src
autoload -U compinit && compinit
source $ZSH/oh-my-zsh.sh

# User configuration


# Setup atuin
eval "$(atuin init zsh)"

# export MANPATH="/usr/local/man:$MANPATH"

# You may need to manually set your language environment
# export LANG=en_US.UTF-8

# Preferred editor for local and remote sessions
# if [[ -n $SSH_CONNECTION ]]; then
#   export EDITOR='vim'
# else
#   export EDITOR='mvim'
# fi

#Compilation flags
# export ARCHFLAGS="-arch x86_64"

# Export config repo to '.config'
export XDG_CONFIG_HOME="$HOME/.config"

# Set zsh-autosuggestions color style
ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE='fg=23'

# Set personal aliases, overriding those provided by oh-my-zsh libs,
# plugins, and themes. Aliases can be placed here, though oh-my-zsh
# users are encouraged to define aliases within the ZSH_CUSTOM folder.
# For a full list of active aliases, run `alias`.
#
# Example aliases
# alias zshconfig="mate ~/.zshrc"
# alias ohmyzsh="mate ~/.oh-my-zsh"

# Unbind execute mode 
bindkey -a -r ':'
# Immediately show completions
bindkey '\t' menu-complete

# Command Aliases

# Bat config
export BAT_THEME="1337"
alias cat='bat --paging=never'

alias ls='exa'
alias c='clear'
alias python='python3'
alias h='atuin history list'
alias cd='z'
alias cdi='zi'
alias lg='lazygit'

# neovim aliases
alias ovim='/usr/bin/vim'
vim() {
    local current_dir=$(pwd -P)
    local resumed=0

    local job_lines=("${(@f)$(jobs -l)}")
    for job_line in "${job_lines[@]}"; do
        if ! [[ "$job_line" =~ "([Ss]uspended|[Ii]nterrupted|[Rr]unning)" ]]; then
            continue
        fi

        # Extract PID from job_line using zsh match[]
        if [[ "$job_line" =~ '\[[0-9]+\][[:space:]]+.[[:space:]]+([0-9]+)' ]]; then
            local job_pid="${match[1]}"
            echo "Found job_pid: $job_pid"
        else
            continue
        fi

        if [ -z "$job_pid" ] || ! kill -0 "$job_pid" 2>/dev/null; then
            continue
        fi

        local job_cwd=$(lsof -a -p $job_pid -d cwd | awk 'NR==2 {print $9}')

        if [ -z "$job_cwd" ]; then
            continue
        fi

        # Extract job number from the line
        if [[ "$job_line" =~ "^\[([-1-9]+)\]" ]]; then
            local job_num="${match[1]}"
        else
            continue
        fi

        echo "job_cwd: $job_cwd, current_dir: $current_dir, job_num: $job_num"
        if [ "$job_cwd" = "$current_dir" ]; then
            fg %"$job_num" 2>/dev/null
            resumed=1
            break
        fi
    done 
    
    # If no matching suspended job was found, start a new nvim
    if [ $resumed -eq 0 ]; then
        echo "All variables: resumed=$resumed, current_dir=$current_dir"
        nvim "$@"
    fi
}

# Kubernetes aliases
alias k='kubectl'
source <(kubectl completion zsh)

# Simple cluster selector
alias cs="export KUBECONFIG=\$(fd 'cluster-.*' $HOME/.kube | fzf)"

export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"

if type eza >/dev/null 2>&1; then
    alias ls='eza -alg --icons --color=always --group-directories-first'
    alias ll='eza -aliSgh --icons --color=always --group-directories-first'
    alias lt='eza -@alT --icons --color=always'
    alias lr='eza -alg --icons --sort=modified --color=always --group-directories-first'
else
    alias l='ls -alh --group-directories-first'
    alias ll='ls -al --group-directories-first'
    alias lr='ls -ltrh --group-directories-first'
fi

# Load zoxide
eval "$(zoxide init zsh)"

# Remove the annoying common prefix tabbing
setopt menucomplete

# Configure default completion styles for fzf-tab
# # disable sort when completing `git checkout`
zstyle ':completion:*:git-checkout:*' sort false
# NOTE: don't use escape sequences (like '%F{red}%d%f') here, fzf-tab will ignore them
zstyle ':completion:*:descriptions' format '[%d]'
# force zsh not to show completion menu, which allows fzf-tab to capture the unambiguous prefix
zstyle ':completion:*' menu no
# preview directory's content with eza when completing cd
zstyle ':fzf-tab:complete:cd:*' fzf-preview 'eza -1 --color=always $realpath'
# set list-colors to enable filename colorizing
zstyle ':completion:*' list-colors ${(s.:.)LS_COLORS}
# custom fzf flags
# NOTE: fzf-tab does not follow FZF_DEFAULT_OPTS by default
zstyle ':fzf-tab:*' fzf-flags --bind=tab:accept --style minimal --bind 'focus:transform-header:file --brief {}'
# # Enable tmux popup
zstyle ':fzf-tab:*' fzf-command ftb-tmux-popup

export EDITOR="nvim"

# Setup wezterm config file
export WEZTERM_CONFIG_DIR="$HOME/.config/wezterm"
export WEZTERM_CONFIG_FILE="$HOME/.config/wezterm/wezterm.lua"

export PATH="$HOME/.local/bin:$PATH"

export PATH="$HOME/.yarn/bin:$HOME/.config/yarn/global/node_modules/.bin:$PATH"

export PATH="$HOME/go/bin:$PATH"

# Add krew to path
export PATH="${KREW_ROOT:-$HOME/.krew}/bin:$PATH"

export GPG_TTY=$(tty)
